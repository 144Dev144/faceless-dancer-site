import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { Buffer } from "buffer";
import { resolveProviderForAddress } from "./walletConnection";

type PaymentStatus = "Preparing wallet payment" | "Opening wallet" | "Confirming payment";

function ensureBrowserBuffer(): void {
  // Solana's browser bundle still expects Node's Buffer global when it
  // serializes transactions. Keep this compatibility setup local to the
  // payment module instead of requiring every page to polyfill Node globals.
  const browserGlobal = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
  if (!browserGlobal.Buffer) browserGlobal.Buffer = Buffer;
}

function withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    task.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function normalizeTransactionSignature(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Uint8Array) return bs58.encode(value);
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) {
    return bs58.encode(Uint8Array.from(value as number[]));
  }
  if (value && typeof value === "object" && "signature" in value) {
    return normalizeTransactionSignature((value as { signature?: unknown }).signature);
  }
  throw new Error("The wallet did not return a Solana transaction signature.");
}

function paymentErrorDetails(error: unknown): Record<string, unknown> {
  const details: Record<string, unknown> = {
    type: Object.prototype.toString.call(error),
    string: (() => {
      try { return String(error); } catch { return "[unstringifiable]"; }
    })(),
  };
  if (error && (typeof error === "object" || typeof error === "function")) {
    const candidate = error as Record<string, unknown>;
    for (const key of ["name", "message", "code", "reason", "data", "logs", "stack", "cause"]) {
      try {
        const value = candidate[key];
        if (typeof value === "undefined") continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
          details[key] = value;
        } else if (key === "stack" || key === "cause") {
          details[key] = String(value);
        } else {
          try { details[key] = JSON.parse(JSON.stringify(value)); } catch { details[key] = String(value); }
        }
      } catch (readError) {
        details[key] = `[Unable to read: ${readError instanceof Error ? readError.message : String(readError)}]`;
      }
    }
    try {
      details.ownProperties = Object.getOwnPropertyNames(error);
    } catch {
      details.ownProperties = [];
    }
  }
  return details;
}

function transactionDetails(transaction: Transaction): Record<string, unknown> {
  return {
    instructionCount: transaction.instructions.length,
    instructions: transaction.instructions.map((instruction) => ({
      programId: instruction.programId.toBase58(),
      keyCount: instruction.keys.length,
      dataBytes: instruction.data.length,
    })),
    feePayer: transaction.feePayer?.toBase58(),
    recentBlockhash: transaction.recentBlockhash,
  };
}

function providerDetails(provider: { isPhantom?: boolean; isSolflare?: boolean; isBackpack?: boolean; isMetaMask?: boolean; isConnected?: boolean }): Record<string, unknown> {
  return {
    isPhantom: provider.isPhantom === true,
    isSolflare: provider.isSolflare === true,
    isBackpack: provider.isBackpack === true,
    isMetaMask: provider.isMetaMask === true,
    isConnected: provider.isConnected,
  };
}

export async function signRemoteGenerationPayment(input: {
  walletAddress: string;
  paymentMessage: string;
  onStatus?: (status: string) => void;
}): Promise<string> {
  input.onStatus?.("Opening wallet");
  const provider = await resolveProviderForAddress(input.walletAddress, "signMessage");
  if (!provider?.signMessage) {
    throw new Error("The authenticated wallet could not be resolved for remote-generation authorization. Reconnect the selected wallet and try again.");
  }
  const signed = await provider.signMessage(new TextEncoder().encode(input.paymentMessage), "utf8");
  return bs58.encode(signed.signature);
}

const configuredNetwork = (import.meta.env.VITE_SOLANA_NETWORK as string | undefined)?.trim() || "devnet";
const configuredRpcUrl = (import.meta.env.VITE_SOLANA_RPC_URL as string | undefined)?.trim();
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export async function sendRemoteGenerationPayment(input: {
  walletAddress: string;
  recipientAddress: string;
  tokenMint: string;
  tokenDecimals: number;
  network: "devnet" | "mainnet-beta";
  amountAtomic: string;
  paymentReference: string;
  onStatus?: (status: PaymentStatus) => void;
}): Promise<string> {
  ensureBrowserBuffer();
  const {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountIdempotentInstruction,
    createTransferCheckedInstruction,
    getAssociatedTokenAddress,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
  } = await import("@solana/spl-token");
  input.onStatus?.("Preparing wallet payment");
  const provider = await resolveProviderForAddress(input.walletAddress, "sendTransaction");
  if (!provider) {
    throw new Error("The connected wallet cannot send Solana transactions from this browser.");
  }
  if (configuredNetwork !== input.network) {
    throw new Error(`Wallet payment is configured for ${configuredNetwork}, but this payment requires ${input.network}.`);
  }

  const rpcUrl = configuredRpcUrl || (input.network === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com");
  const connection = new Connection(rpcUrl, "confirmed");
  const payer = new PublicKey(input.walletAddress);
  const recipient = new PublicKey(input.recipientAddress);
  const mint = new PublicKey(input.tokenMint);
  const mintAccount = await withTimeout(
    connection.getAccountInfo(mint, "confirmed"),
    15_000,
    "The Solana RPC did not respond while checking the payment token.",
  );
  if (!mintAccount) throw new Error("The payment token mint could not be found on Solana.");
  const tokenProgramId = mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : mintAccount.owner.equals(TOKEN_PROGRAM_ID)
      ? TOKEN_PROGRAM_ID
      : (() => { throw new Error("The payment token uses an unsupported Solana token program."); })();
  const sourceTokenAccount = await getAssociatedTokenAddress(mint, payer, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
  const destinationTokenAccount = await getAssociatedTokenAddress(mint, recipient, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
  const latestBlockhash = await withTimeout(
    connection.getLatestBlockhash("confirmed"),
    15_000,
    "The Solana RPC did not respond while preparing the payment.",
  );
  const memo = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [],
    data: new TextEncoder().encode(input.paymentReference) as unknown as any,
  });
  const transaction = new Transaction({
    feePayer: payer,
    recentBlockhash: latestBlockhash.blockhash,
  }).add(
    createAssociatedTokenAccountIdempotentInstruction(payer, destinationTokenAccount, recipient, mint, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID),
    createTransferCheckedInstruction(
      sourceTokenAccount,
      mint,
      destinationTokenAccount,
      payer,
      BigInt(input.amountAtomic),
      input.tokenDecimals,
      [],
      tokenProgramId,
    ),
    memo,
  );

  input.onStatus?.("Opening wallet");
  let signature: string;
  try {
    if (provider.signAndSendTransaction) {
      signature = normalizeTransactionSignature(await provider.signAndSendTransaction(transaction));
    } else if (provider.sendTransaction) {
      signature = normalizeTransactionSignature(await provider.sendTransaction(transaction, connection));
    } else if (provider.signTransaction) {
      const signed = await provider.signTransaction(transaction) as { serialize?: () => Uint8Array };
      if (typeof signed?.serialize !== "function") throw new Error("The wallet did not return a signed Solana transaction.");
      signature = await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" });
    } else {
      throw new Error("The connected wallet cannot send Solana transactions from this browser.");
    }
  } catch (error) {
    console.error("[remote-payment] FACELESS wallet submission failed", {
      network: input.network,
      walletAddress: input.walletAddress,
      recipientAddress: input.recipientAddress,
      tokenMint: input.tokenMint,
      tokenDecimals: input.tokenDecimals,
      amountAtomic: input.amountAtomic,
      paymentReference: input.paymentReference,
      provider: providerDetails(provider),
      transaction: transactionDetails(transaction),
      error: paymentErrorDetails(error),
    });
    throw error;
  }
  input.onStatus?.("Confirming payment");
  try {
    await connection.confirmTransaction({
      signature,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    }, "confirmed");
  } catch (error) {
    console.error("[remote-payment] FACELESS wallet confirmation failed", {
      signature,
      network: input.network,
      paymentReference: input.paymentReference,
      error: paymentErrorDetails(error),
    });
    // The wallet already returned a broadcast signature. Let the launch
    // server verify or reconcile it even if this RPC confirmation attempt
    // expired or used a stale blockhash.
  }
  return signature;
}

export async function sendRemoteGenerationSolPayment(input: {
  walletAddress: string;
  recipientAddress: string;
  network: "devnet" | "mainnet-beta";
  amountAtomic: string;
  paymentReference: string;
  onStatus?: (status: PaymentStatus) => void;
}): Promise<string> {
  ensureBrowserBuffer();
  input.onStatus?.("Preparing wallet payment");
  const provider = await resolveProviderForAddress(input.walletAddress, "sendTransaction");
  if (!provider) throw new Error("The connected wallet cannot send Solana transactions from this browser.");
  if (configuredNetwork !== input.network) throw new Error(`Wallet payment is configured for ${configuredNetwork}, but this payment requires ${input.network}.`);

  const lamports = BigInt(input.amountAtomic);
  if (lamports <= 0n || lamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("The SOL payment amount is outside the supported range.");
  const rpcUrl = configuredRpcUrl || (input.network === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : "https://api.devnet.solana.com");
  const connection = new Connection(rpcUrl, "confirmed");
  const payer = new PublicKey(input.walletAddress);
  const recipient = new PublicKey(input.recipientAddress);
  const latestBlockhash = await withTimeout(connection.getLatestBlockhash("confirmed"), 15_000, "The Solana RPC did not respond while preparing the payment.");
  const memo = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [],
    data: new TextEncoder().encode(input.paymentReference) as unknown as any,
  });
  const transaction = new Transaction({ feePayer: payer, recentBlockhash: latestBlockhash.blockhash }).add(
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: recipient, lamports: Number(lamports) }),
    memo,
  );

  input.onStatus?.("Opening wallet");
  let signature: string;
  try {
    if (provider.signAndSendTransaction) {
      signature = normalizeTransactionSignature(await provider.signAndSendTransaction(transaction));
    } else if (provider.sendTransaction) {
      signature = normalizeTransactionSignature(await provider.sendTransaction(transaction, connection));
    } else if (provider.signTransaction) {
      const signed = await provider.signTransaction(transaction) as { serialize?: () => Uint8Array };
      if (typeof signed?.serialize !== "function") throw new Error("The wallet did not return a signed Solana transaction.");
      signature = await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" });
    } else {
      throw new Error("The connected wallet cannot send Solana transactions from this browser.");
    }
  } catch (error) {
    console.error("[remote-payment] SOL wallet submission failed", {
      network: input.network,
      walletAddress: input.walletAddress,
      recipientAddress: input.recipientAddress,
      amountAtomic: input.amountAtomic,
      paymentReference: input.paymentReference,
      provider: providerDetails(provider),
      transaction: transactionDetails(transaction),
      error: paymentErrorDetails(error),
    });
    throw error;
  }
  input.onStatus?.("Confirming payment");
  try {
    await connection.confirmTransaction({ signature, blockhash: latestBlockhash.blockhash, lastValidBlockHeight: latestBlockhash.lastValidBlockHeight }, "confirmed");
  } catch (error) {
    console.error("[remote-payment] SOL wallet confirmation failed", {
      signature,
      network: input.network,
      paymentReference: input.paymentReference,
      error: paymentErrorDetails(error),
    });
    // The wallet already returned a broadcast signature. Let the launch
    // server verify or reconcile it even if this RPC confirmation attempt
    // expired or used a stale blockhash.
  }
  return signature;
}

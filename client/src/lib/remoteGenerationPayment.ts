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
    createAssociatedTokenAccountIdempotentInstruction,
    createTransferCheckedInstruction,
    getAssociatedTokenAddress,
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
  const sourceTokenAccount = await getAssociatedTokenAddress(mint, payer);
  const destinationTokenAccount = await getAssociatedTokenAddress(mint, recipient);
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
    createAssociatedTokenAccountIdempotentInstruction(payer, destinationTokenAccount, recipient, mint),
    createTransferCheckedInstruction(
      sourceTokenAccount,
      mint,
      destinationTokenAccount,
      payer,
      BigInt(input.amountAtomic),
      input.tokenDecimals,
    ),
    memo,
  );

  input.onStatus?.("Opening wallet");
  let signature: string;
  if (provider.sendTransaction) {
    signature = normalizeTransactionSignature(await provider.sendTransaction(transaction, connection));
  } else if (provider.signAndSendTransaction) {
    signature = normalizeTransactionSignature(await provider.signAndSendTransaction(transaction, { preflightCommitment: "confirmed" }));
  } else if (provider.signTransaction) {
    const signed = await provider.signTransaction(transaction) as { serialize?: () => Uint8Array };
    if (typeof signed?.serialize !== "function") throw new Error("The wallet did not return a signed Solana transaction.");
    signature = await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" });
  } else {
    throw new Error("The connected wallet cannot send Solana transactions from this browser.");
  }
  input.onStatus?.("Confirming payment");
  await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }, "confirmed");
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
  if (provider.sendTransaction) {
    signature = normalizeTransactionSignature(await provider.sendTransaction(transaction, connection));
  } else if (provider.signAndSendTransaction) {
    signature = normalizeTransactionSignature(await provider.signAndSendTransaction(transaction, { preflightCommitment: "confirmed" }));
  } else if (provider.signTransaction) {
    const signed = await provider.signTransaction(transaction) as { serialize?: () => Uint8Array };
    if (typeof signed?.serialize !== "function") throw new Error("The wallet did not return a signed Solana transaction.");
    signature = await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" });
  } else {
    throw new Error("The connected wallet cannot send Solana transactions from this browser.");
  }
  input.onStatus?.("Confirming payment");
  await connection.confirmTransaction({ signature, blockhash: latestBlockhash.blockhash, lastValidBlockHeight: latestBlockhash.lastValidBlockHeight }, "confirmed");
  return signature;
}

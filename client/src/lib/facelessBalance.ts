import { Connection, PublicKey } from "@solana/web3.js";
import { FACELESS_TOKEN_DECIMALS, FACELESS_TOKEN_MINT } from "./facelessPrice";

const configuredNetwork = (import.meta.env.VITE_SOLANA_NETWORK as string | undefined)?.trim() || "devnet";
const configuredRpcUrl = (import.meta.env.VITE_SOLANA_RPC_URL as string | undefined)?.trim();

export interface FaceLESSWalletBalance {
  amountAtomic: string;
  tokenDecimals: number;
  tokenMint: string;
  network: string;
  fetchedAt: string;
}

function defaultRpcUrl(): string {
  return configuredNetwork === "mainnet-beta"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com";
}

export async function fetchFaceLESSWalletBalance(
  walletAddress: string,
  tokenMintAddress = FACELESS_TOKEN_MINT,
  tokenDecimals = FACELESS_TOKEN_DECIMALS,
): Promise<FaceLESSWalletBalance> {
  const connection = new Connection(configuredRpcUrl || defaultRpcUrl(), "confirmed");
  const owner = new PublicKey(walletAddress);
  const mint = new PublicKey(tokenMintAddress);
  const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint }, "confirmed");
  const amountAtomic = accounts.value.reduce((total, account) => {
    const parsed = account.account.data.parsed as {
      info?: { tokenAmount?: { amount?: string } };
    };
    const amount = parsed.info?.tokenAmount?.amount;
    return amount ? total + BigInt(amount) : total;
  }, 0n);

  return {
    amountAtomic: amountAtomic.toString(),
    tokenDecimals,
    tokenMint: tokenMintAddress,
    network: configuredNetwork,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchSolWalletBalance(walletAddress: string): Promise<FaceLESSWalletBalance> {
  const connection = new Connection(configuredRpcUrl || defaultRpcUrl(), "confirmed");
  const owner = new PublicKey(walletAddress);
  const amountAtomic = await connection.getBalance(owner, "confirmed");
  return {
    amountAtomic: String(amountAtomic),
    tokenDecimals: 9,
    tokenMint: "SOL",
    network: configuredNetwork,
    fetchedAt: new Date().toISOString(),
  };
}

import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { FACELESS_TOKEN_DECIMALS, FACELESS_TOKEN_MINT } from "./facelessPrice";

const configuredNetwork = (import.meta.env.VITE_SOLANA_NETWORK as string | undefined)?.trim() || "devnet";
const configuredRpcUrl = (import.meta.env.VITE_SOLANA_RPC_URL as string | undefined)?.trim();
const configuredSecondaryRpcUrl = (import.meta.env.SECONDARY_RPC_NODE as string | undefined)?.trim();
const configuredTertiaryRpcUrl = (import.meta.env.TERTIARY_RPC_NODE as string | undefined)?.trim();

export interface BalanceNetworkConfig {
  network: "devnet" | "mainnet-beta";
  rpcUrl: string;
}

export interface FaceLESSWalletBalance {
  amountAtomic: string;
  tokenDecimals: number;
  tokenMint: string;
  network: string;
  fetchedAt: string;
}

function defaultRpcUrl(network: "devnet" | "mainnet-beta"): string {
  return network === "mainnet-beta"
    ? "https://api.mainnet-beta.solana.com"
    : "https://api.devnet.solana.com";
}

function resolveNetworkConfig(config?: BalanceNetworkConfig, rpcUrlOverride?: string): BalanceNetworkConfig {
  const network = config?.network ?? configuredNetwork as "devnet" | "mainnet-beta";
  return {
    network,
    rpcUrl: rpcUrlOverride || configuredRpcUrl || config?.rpcUrl || defaultRpcUrl(network),
  };
}

function balanceRpcUrls(config: BalanceNetworkConfig | undefined): string[] {
  const network = config?.network ?? configuredNetwork as "devnet" | "mainnet-beta";
  return [...new Set([
    configuredTertiaryRpcUrl,
    configuredSecondaryRpcUrl,
    configuredRpcUrl,
    config?.rpcUrl,
    defaultRpcUrl(network),
  ].filter((url): url is string => Boolean(url)))];
}

export async function fetchFaceLESSWalletBalance(
  walletAddress: string,
  tokenMintAddress = FACELESS_TOKEN_MINT,
  tokenDecimals = FACELESS_TOKEN_DECIMALS,
  config?: BalanceNetworkConfig,
): Promise<FaceLESSWalletBalance> {
  const owner = new PublicKey(walletAddress);
  const mint = new PublicKey(tokenMintAddress);
  let lastError: unknown = null;

  for (const rpcUrl of balanceRpcUrls(config)) {
    const networkConfig = resolveNetworkConfig(config, rpcUrl);
    const connection = new Connection(networkConfig.rpcUrl, "confirmed");
    const tokenAccountAddress = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);
    try {
      const balance = await connection.getTokenAccountBalance(tokenAccountAddress, "confirmed");
      return {
        amountAtomic: balance.value.amount,
        tokenDecimals,
        tokenMint: tokenMintAddress,
        network: networkConfig.network,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (String(error).toLowerCase().includes("could not find account")) {
        return {
          amountAtomic: "0",
          tokenDecimals,
          tokenMint: tokenMintAddress,
          network: networkConfig.network,
          fetchedAt: new Date().toISOString(),
        };
      }
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("FACELESS Token-2022 balance lookup failed on all configured RPC nodes.");
}

export async function fetchSolWalletBalance(walletAddress: string, config?: BalanceNetworkConfig): Promise<FaceLESSWalletBalance> {
  const networkConfig = resolveNetworkConfig(config);
  const connection = new Connection(networkConfig.rpcUrl, "confirmed");
  const owner = new PublicKey(walletAddress);
  const amountAtomic = await connection.getBalance(owner, "confirmed");
  return {
    amountAtomic: String(amountAtomic),
    tokenDecimals: 9,
    tokenMint: "SOL",
    network: networkConfig.network,
    fetchedAt: new Date().toISOString(),
  };
}

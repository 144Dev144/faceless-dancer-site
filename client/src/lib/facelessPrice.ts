export const DEFAULT_FACELESS_TOKEN_MINT = "RNpE75BGjNfZ6EwUhkDfiPaTxDaPWiGssfb1Wo9pump";
const DEFAULT_PRICE_API_BASE_URL = "https://api.dexscreener.com";
const DEFAULT_BASE_PRICE_USD = 0.1;
const DEFAULT_BASE_DURATION_SECONDS = 30;
const DEFAULT_BASE_INFERENCE_STEPS = 8;
export const DEFAULT_FACELESS_TOKEN_DECIMALS = 9;
const DEFAULT_SLIPPAGE_BPS = 300;

interface TokenPair {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string };
  priceUsd?: string | null;
  liquidity?: { usd?: number | null } | null;
  volume?: { h24?: number | null } | null;
}

export interface LiveFaceLESSPrice {
  tokenMint: string;
  priceUsd: number;
  pairAddress: string;
  fetchedAt: string;
  source: string;
}

export interface LiveMusicCost extends LiveFaceLESSPrice {
  priceUsdForGeneration: number;
  amountAtomic: string;
  tokenDecimals: number;
}

export const FACELESS_TOKEN_MINT = (import.meta.env.VITE_FACELESS_PRICE_TOKEN_MINT as string | undefined)?.trim() || DEFAULT_FACELESS_TOKEN_MINT;
const apiBaseUrl = (import.meta.env.VITE_FACELESS_PRICE_API_BASE_URL as string | undefined)?.trim() || DEFAULT_PRICE_API_BASE_URL;
export const FACELESS_TOKEN_DECIMALS = Number(import.meta.env.VITE_FACELESS_TOKEN_DECIMALS ?? DEFAULT_FACELESS_TOKEN_DECIMALS);
const tokenMint = FACELESS_TOKEN_MINT;
const tokenDecimals = FACELESS_TOKEN_DECIMALS;
const basePriceUsd = Number(import.meta.env.VITE_MUSIC_BASE_PRICE_USD ?? DEFAULT_BASE_PRICE_USD);
const baseDurationSeconds = Number(import.meta.env.VITE_MUSIC_BASE_DURATION_SECONDS ?? DEFAULT_BASE_DURATION_SECONDS);
const baseInferenceSteps = Number(import.meta.env.VITE_MUSIC_BASE_INFERENCE_STEPS ?? DEFAULT_BASE_INFERENCE_STEPS);
const slippageBps = Number(import.meta.env.VITE_PAYMENT_SLIPPAGE_BPS ?? DEFAULT_SLIPPAGE_BPS);

function roundMoney(value: number): number {
  return Math.max(0.01, Math.round(value * 100) / 100);
}

function choosePair(pairs: TokenPair[]): TokenPair | null {
  return pairs
    .filter((pair) => pair.chainId === "solana")
    .filter((pair) => pair.baseToken?.address === tokenMint)
    .filter((pair) => Number.isFinite(Number(pair.priceUsd)) && Number(pair.priceUsd) > 0)
    .sort((left, right) => {
      const liquidityDelta = Number(right.liquidity?.usd ?? 0) - Number(left.liquidity?.usd ?? 0);
      if (liquidityDelta !== 0) return liquidityDelta;
      return Number(right.volume?.h24 ?? 0) - Number(left.volume?.h24 ?? 0);
    })[0] ?? null;
}

export async function fetchFaceLESSMarketPrice(): Promise<LiveFaceLESSPrice> {
  const endpoints = [
    `${apiBaseUrl}/token-pairs/v1/solana/${encodeURIComponent(tokenMint)}`,
    `${apiBaseUrl}/tokens/v1/solana/${encodeURIComponent(tokenMint)}`,
  ];
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, { headers: { Accept: "application/json" } });
    if (!response.ok) continue;
    const pairs = await response.json() as TokenPair[];
    const pair = choosePair(Array.isArray(pairs) ? pairs : []);
    if (!pair?.pairAddress || !pair.priceUsd) continue;
    return {
      tokenMint,
      priceUsd: Number(pair.priceUsd),
      pairAddress: pair.pairAddress,
      fetchedAt: new Date().toISOString(),
      source: endpoint,
    };
  }
  throw new Error("No live FACELESS market pair is available");
}

export function calculateLiveMusicCost(
  marketPrice: LiveFaceLESSPrice,
  durationSeconds: number,
  inferenceSteps: number,
): LiveMusicCost {
  const durationFactor = Math.max(1, durationSeconds / baseDurationSeconds);
  const stepsFactor = Math.max(1, inferenceSteps / baseInferenceSteps);
  const priceUsdForGeneration = roundMoney(basePriceUsd * durationFactor * stepsFactor);
  const rawAtomic = priceUsdForGeneration / marketPrice.priceUsd * (10 ** tokenDecimals) * (1 + slippageBps / 10_000);
  if (!Number.isFinite(rawAtomic) || rawAtomic <= 0 || rawAtomic > Number.MAX_SAFE_INTEGER) {
    throw new Error("FACELESS cost is outside the supported payment range");
  }
  return {
    ...marketPrice,
    priceUsdForGeneration,
    amountAtomic: String(Math.max(1, Math.ceil(rawAtomic))),
    tokenDecimals,
  };
}

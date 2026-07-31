import { Connection, PublicKey } from "@solana/web3.js";
import type { RemoteGenerationRequest, RemotePricingConfig, RemotePricingQuote } from "./api";

const PUMP_BONDING_CURVE_DISCRIMINATOR = Uint8Array.from([
  0x17, 0xb7, 0xf8, 0x37, 0x60, 0xd8, 0xac, 0x60,
]);
const PYTH_RECEIVER_PROGRAM_ID = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
const LAMPORTS_PER_SOL = 1_000_000_000;

export interface RemoteMarketPrice {
  tokenMint: string;
  facelessPriceUsd: number;
  solPriceUsd: number;
  pairAddress: string;
  fetchedAt: string;
  expiresAt: string;
  source: string;
}

export function createFreeMarketPrice(config: RemotePricingConfig, source: "free-signature" | "holder-free" = "free-signature"): RemoteMarketPrice {
  const fetchedAt = new Date().toISOString();
  return {
    tokenMint: config.market.tokenMint,
    facelessPriceUsd: 1,
    solPriceUsd: 1,
    pairAddress: "",
    fetchedAt,
    expiresAt: new Date(Date.now() + config.market.maxAgeSeconds * 1000).toISOString(),
    source,
  };
}

function bytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new Error("On-chain pricing returned an unreadable account");
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("SOL/USD Pyth feed id is invalid");
  return Uint8Array.from(value.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}

function readU64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

function readI64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(offset, true);
}

function readI32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(offset, true);
}

function parsePythPrice(data: Uint8Array, expectedFeedId: string, maxAgeSeconds: number): { priceUsd: number; publishTime: number } {
  if (data.length < 125) throw new Error("SOL/USD Pyth account is too short");
  const variant = data[40];
  const messageOffset = variant === 1 ? 41 : variant === 0 ? 42 : -1;
  if (messageOffset < 0 || messageOffset + 84 > data.length) throw new Error("SOL/USD Pyth account has an unexpected layout");
  if (!sameBytes(data.slice(messageOffset, messageOffset + 32), hexToBytes(expectedFeedId))) throw new Error("SOL/USD Pyth account is for a different feed");

  const price = readI64(data, messageOffset + 32);
  const exponent = readI32(data, messageOffset + 48);
  const publishTime = Number(readI64(data, messageOffset + 52));
  const priceUsd = Number(price) * 10 ** exponent;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error("SOL/USD Pyth price is invalid");
  if (!Number.isFinite(publishTime) || publishTime <= 0 || nowSeconds - publishTime > maxAgeSeconds) throw new Error("SOL/USD Pyth price is stale");
  return { priceUsd, publishTime };
}

function parsePumpCurvePrice(data: Uint8Array, tokenDecimals: number): number {
  if (data.length < 49 || !sameBytes(data.slice(0, 8), PUMP_BONDING_CURVE_DISCRIMINATOR)) throw new Error("FACELESS Pump bonding curve account has an unexpected layout");
  if (data[48] === 1) throw new Error("FACELESS market has graduated; its pool price source must be configured");
  const virtualTokenReserves = Number(readU64(data, 8)) / 10 ** tokenDecimals;
  const virtualSolReserves = Number(readU64(data, 16)) / LAMPORTS_PER_SOL;
  const price = virtualSolReserves / virtualTokenReserves;
  if (!Number.isFinite(price) || price <= 0) throw new Error("FACELESS Pump bonding curve price is invalid");
  return price;
}

export async function fetchOnChainMarketPrice(config: RemotePricingConfig): Promise<RemoteMarketPrice> {
  const rpcUrl = (import.meta.env.VITE_FACELESS_PRICE_RPC_URL as string | undefined)?.trim() || "https://solana-rpc.publicnode.com";
  const connection = new Connection(rpcUrl, "confirmed");
  const [curveAccount, solUsdAccount] = await connection.getMultipleAccountsInfo([
    new PublicKey(config.market.bondingCurveAccount),
    new PublicKey(config.market.solUsdFeedAccount),
  ], "confirmed");
  if (!curveAccount || curveAccount.owner.toBase58() !== config.market.pumpProgramId) throw new Error("FACELESS Pump bonding curve account is unavailable");
  if (!solUsdAccount || solUsdAccount.owner.toBase58() !== PYTH_RECEIVER_PROGRAM_ID) throw new Error("SOL/USD Pyth account is unavailable");

  const solUsd = parsePythPrice(bytes(solUsdAccount.data), config.market.solUsdFeedId, config.market.maxAgeSeconds);
  const facelessSolPrice = parsePumpCurvePrice(bytes(curveAccount.data), config.market.tokenDecimals);
  return {
    tokenMint: config.market.tokenMint,
    facelessPriceUsd: facelessSolPrice * solUsd.priceUsd,
    solPriceUsd: solUsd.priceUsd,
    pairAddress: config.market.bondingCurveAccount,
    fetchedAt: new Date(solUsd.publishTime * 1000).toISOString(),
    expiresAt: new Date((solUsd.publishTime + config.market.maxAgeSeconds) * 1000).toISOString(),
    source: "onchain:pump-bonding-curve+pyth-sol-usd",
  };
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function decimalFraction(value: number): { numerator: bigint; denominator: bigint } {
  if (!Number.isFinite(value) || value <= 0) throw new Error("On-chain token price is invalid");
  const [coefficient, exponentText] = value.toString().toLowerCase().split("e");
  const exponent = exponentText ? Number(exponentText) : 0;
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = BigInt(`${whole}${fraction}`);
  const scale = fraction.length - exponent;
  return scale >= 0
    ? { numerator: digits, denominator: 10n ** BigInt(scale) }
    : { numerator: digits * (10n ** BigInt(-scale)), denominator: 1n };
}

function atomicAmount(priceUsd: number, tokenPriceUsd: number, decimals: number, slippageBps: number): string {
  if (priceUsd === 0) return "0";
  const price = decimalFraction(priceUsd);
  const tokenPrice = decimalFraction(tokenPriceUsd);
  const numerator = price.numerator
    * tokenPrice.denominator
    * (10n ** BigInt(decimals))
    * BigInt(10_000 + slippageBps);
  const denominator = price.denominator * tokenPrice.numerator * 10_000n;
  const amount = (numerator + denominator - 1n) / denominator;
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Payment amount is outside the supported range");
  return amount.toString();
}

export function holderFreeForRequest(config: RemotePricingConfig, request: RemoteGenerationRequest): boolean {
  switch (request.parameters.task_type) {
    case "extract": return config.settings.extractionFreeForHolders;
    case "voice_change": return config.settings.voiceChangeFreeForHolders;
    case "transition_chain": return config.settings.transitionFreeForHolders;
    case "rhythm_beats": return config.settings.rhythmBeatsFreeForHolders;
    default: return config.settings.musicFreeForHolders;
  }
}

export function calculateRemotePricing(
  config: RemotePricingConfig,
  request: RemoteGenerationRequest,
  market: RemoteMarketPrice,
  options: { freeForHolder?: boolean } = {},
): RemotePricingQuote {
  const parameters = request.parameters;
  const taskType = parameters.task_type === "extract" ? "extract" : parameters.task_type === "voice_change" ? "voice_change" : parameters.task_type === "transition_chain" ? "transition_chain" : parameters.task_type === "rhythm_beats" ? "rhythm_beats" : "text2music";
  const transitionPlan = taskType === "transition_chain" && parameters.transition_plan && typeof parameters.transition_plan === "object" ? parameters.transition_plan as { transitionClips?: Array<{ startSeconds: number; endSeconds: number }> } : undefined;
  const transitionStageCount = transitionPlan?.transitionClips?.length ?? 1;
  const transitionSeconds = transitionPlan?.transitionClips?.reduce((sum, clip) => sum + Math.max(0, clip.endSeconds - clip.startSeconds), 0) ?? 0;
  const duration = taskType === "transition_chain" ? transitionSeconds : positiveNumber(parameters.audio_duration ?? parameters.source_duration_seconds, config.defaults.musicDurationSeconds);
  const defaultSteps = taskType === "extract" || taskType === "rhythm_beats" ? config.defaults.extractionInferenceSteps : taskType === "voice_change" ? config.defaults.voiceChangeInferenceSteps : taskType === "transition_chain" ? config.defaults.transitionInferenceSteps : config.defaults.musicInferenceSteps;
  const configuredSteps = taskType === "voice_change" ? parameters.diffusion_steps : parameters.inference_steps;
  const steps = Math.max(1, Math.round(positiveNumber(configuredSteps, defaultSteps)));
  const currency = request.paymentCurrency ?? "FACELESS";
  const isSol = currency === "SOL";
  const settings = config.settings;
  const basePriceMicros = taskType === "extract"
    ? (isSol ? settings.solExtractionBasePriceUsdMicros : settings.facelessExtractionBasePriceUsdMicros)
    : taskType === "voice_change"
      ? (isSol ? settings.solVoiceChangeBasePriceUsdMicros : settings.facelessVoiceChangeBasePriceUsdMicros)
      : taskType === "transition_chain"
        ? (isSol ? settings.solTransitionBasePriceUsdMicros : settings.facelessTransitionBasePriceUsdMicros)
        : taskType === "rhythm_beats"
          ? (isSol ? settings.solRhythmBeatsBasePriceUsdMicros : settings.facelessRhythmBeatsBasePriceUsdMicros)
        : (isSol ? settings.solBasePriceUsdMicros : settings.facelessBasePriceUsdMicros);
  const stepRateMicros = taskType === "extract"
    ? (isSol ? settings.solExtractionAdditionalStepPriceUsdMicros : settings.facelessExtractionAdditionalStepPriceUsdMicros)
    : taskType === "voice_change"
      ? (isSol ? settings.solVoiceChangeAdditionalStepPriceUsdMicros : settings.facelessVoiceChangeAdditionalStepPriceUsdMicros)
      : taskType === "transition_chain"
        ? (isSol ? settings.solTransitionAdditionalStepPriceUsdMicros : settings.facelessTransitionAdditionalStepPriceUsdMicros)
        : taskType === "rhythm_beats"
          ? (isSol ? settings.solRhythmBeatsAdditionalStepPriceUsdMicros : settings.facelessRhythmBeatsAdditionalStepPriceUsdMicros)
        : (isSol ? settings.solGenerationAdditionalStepPriceUsdMicros : settings.facelessGenerationAdditionalStepPriceUsdMicros);
  const durationRateMicros = taskType === "extract"
    ? (isSol ? settings.solExtractionSourceSecondPriceUsdMicros : settings.facelessExtractionSourceSecondPriceUsdMicros)
    : taskType === "voice_change"
      ? (isSol ? settings.solVoiceChangeSourceSecondPriceUsdMicros : settings.facelessVoiceChangeSourceSecondPriceUsdMicros)
      : taskType === "transition_chain"
        ? (isSol ? settings.solTransitionSecondPriceUsdMicros : settings.facelessTransitionSecondPriceUsdMicros)
        : taskType === "rhythm_beats"
          ? (isSol ? settings.solRhythmBeatsSourceSecondPriceUsdMicros : settings.facelessRhythmBeatsSourceSecondPriceUsdMicros)
        : (isSol ? settings.solGenerationAdditionalSecondPriceUsdMicros : settings.facelessGenerationAdditionalSecondPriceUsdMicros);
  const sourceDurationSeconds = taskType === "extract" || taskType === "voice_change" || taskType === "rhythm_beats" ? nonNegativeNumber(request.inputs.find((input) => input.role === (taskType === "voice_change" ? "song" : input.role))?.durationSeconds ?? parameters.source_duration_seconds) : 0;
  if ((taskType === "extract" || taskType === "voice_change" || taskType === "rhythm_beats") && durationRateMicros > 0 && sourceDurationSeconds <= 0) throw new Error(`${taskType === "voice_change" ? "Voice Change song" : taskType === "rhythm_beats" ? "Rhythm Beats source" : "Extraction source"} duration is required for the configured per-second price`);
  const additionalDurationSeconds = taskType === "transition_chain" ? transitionSeconds * transitionStageCount : taskType === "extract" || taskType === "voice_change" || taskType === "rhythm_beats" ? sourceDurationSeconds : Math.max(0, duration - config.defaults.musicDurationSeconds);
  const stemCount = taskType === "rhythm_beats" ? (parameters.stem_mode === "selected" && Array.isArray(parameters.selected_stems) ? parameters.selected_stems.length : 12) : 0;
  const baseChargeMicros = basePriceMicros * (taskType === "transition_chain" ? transitionStageCount : 1);
  const calculatedPriceMicros = baseChargeMicros
    + Math.max(0, steps - defaultSteps) * stepRateMicros * (taskType === "transition_chain" ? transitionStageCount : 1)
    + Math.round(additionalDurationSeconds * durationRateMicros)
    + (taskType === "rhythm_beats" ? Math.max(0, stemCount - positiveNumber(config.defaults.rhythmBeatsBaseStemCount, 5)) * (isSol ? settings.solRhythmBeatsAdditionalStemPriceUsdMicros : settings.facelessRhythmBeatsAdditionalStemPriceUsdMicros) : 0);
  const freeSignature = config.paymentMode === "free-signature";
  const holderFree = options.freeForHolder === true;
  const billablePriceMicros = holderFree ? Math.max(0, calculatedPriceMicros - baseChargeMicros) : calculatedPriceMicros;
  const priceUsd = freeSignature ? 0 : billablePriceMicros / 1_000_000;
  const tokenPriceUsd = isSol ? market.solPriceUsd : market.facelessPriceUsd;
  const token = config.currencies[currency];
  return {
    currency,
    network: config.network,
    tokenMint: token.tokenMint,
    tokenDecimals: token.tokenDecimals,
    basePriceUsd: basePriceMicros / 1_000_000,
    priceUsd,
    priceUsdCents: Math.ceil(priceUsd * 100),
    tokenPriceUsd,
    amountAtomic: atomicAmount(priceUsd, tokenPriceUsd, token.tokenDecimals, config.slippageBps),
    priceSource: freeSignature ? "free-signature" : holderFree ? "holder-free" : market.source,
    pairAddress: freeSignature || billablePriceMicros === 0 ? "" : market.pairAddress,
    fetchedAt: market.fetchedAt,
    expiresAt: market.expiresAt,
  };
}

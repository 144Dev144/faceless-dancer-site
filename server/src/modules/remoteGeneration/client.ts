import { env } from "../../config/env.js";

export interface RemoteGenerationInput {
  role: string;
  sourceUrl: string;
  mimeType: string;
  fileName?: string;
  sha256?: string;
  sizeBytes?: number;
  durationSeconds?: number;
}

export type RemotePaymentCurrency = "FACELESS" | "SOL";

export interface RemoteGenerationMetadata {
  title: string;
  reanalysisOfJobId?: string;
}

export interface RemoteGenerationRequest {
  runtime: "ace-step" | "voice-change" | "rhythm-beats";
  modelRevision: string;
  inputs: RemoteGenerationInput[];
  priority: "low" | "standard" | "high";
  paymentCurrency?: RemotePaymentCurrency;
  metadata?: RemoteGenerationMetadata;
  parameters: Record<string, unknown>;
}

export interface RemotePricingQuote {
  currency: RemotePaymentCurrency;
  network: "devnet" | "mainnet-beta";
  tokenMint: string;
  tokenDecimals: number;
  basePriceUsd: number;
  priceUsd: number;
  priceUsdCents: number;
  tokenPriceUsd: number;
  amountAtomic: string;
  priceSource: string;
  pairAddress: string;
  fetchedAt: string;
  expiresAt: string;
}

export interface RemotePricingConfig {
  network: "devnet" | "mainnet-beta";
  paymentMode: "mock" | "solana" | "test-solana" | "free-signature";
  currencies: Record<RemotePaymentCurrency, { tokenMint: string; tokenDecimals: number }>;
  settings: {
    facelessBasePriceUsdMicros: number;
    solBasePriceUsdMicros: number;
    facelessExtractionBasePriceUsdMicros: number;
    solExtractionBasePriceUsdMicros: number;
    facelessGenerationAdditionalStepPriceUsdMicros: number;
    solGenerationAdditionalStepPriceUsdMicros: number;
    facelessGenerationAdditionalSecondPriceUsdMicros: number;
    solGenerationAdditionalSecondPriceUsdMicros: number;
    facelessExtractionAdditionalStepPriceUsdMicros: number;
    solExtractionAdditionalStepPriceUsdMicros: number;
    facelessExtractionSourceSecondPriceUsdMicros: number;
    solExtractionSourceSecondPriceUsdMicros: number;
    facelessVoiceChangeBasePriceUsdMicros: number;
    solVoiceChangeBasePriceUsdMicros: number;
    facelessVoiceChangeAdditionalStepPriceUsdMicros: number;
    solVoiceChangeAdditionalStepPriceUsdMicros: number;
    facelessVoiceChangeSourceSecondPriceUsdMicros: number;
    solVoiceChangeSourceSecondPriceUsdMicros: number;
    facelessRhythmBeatsBasePriceUsdMicros: number;
    solRhythmBeatsBasePriceUsdMicros: number;
    facelessRhythmBeatsAdditionalStemPriceUsdMicros: number;
    solRhythmBeatsAdditionalStemPriceUsdMicros: number;
    facelessRhythmBeatsAdditionalStepPriceUsdMicros: number;
    solRhythmBeatsAdditionalStepPriceUsdMicros: number;
    facelessRhythmBeatsSourceSecondPriceUsdMicros: number;
    solRhythmBeatsSourceSecondPriceUsdMicros: number;
    musicFreeForHolders: boolean;
    extractionFreeForHolders: boolean;
    voiceChangeFreeForHolders: boolean;
    transitionFreeForHolders: boolean;
    rhythmBeatsFreeForHolders: boolean;
    updatedAt: string;
  };
  defaults: {
    musicDurationSeconds: number;
    musicInferenceSteps: number;
    extractionInferenceSteps: number;
    voiceChangeInferenceSteps: number;
    transitionInferenceSteps: number;
    rhythmBeatsInferenceSteps: number;
    rhythmBeatsBaseStemCount: number;
  };
  slippageBps: number;
  market: {
    source: "pump-bonding-curve";
    rpcUrl: string;
    tokenMint: string;
    tokenDecimals: number;
    pumpProgramId: string;
    bondingCurveAccount: string;
    solUsdFeedId: string;
    solUsdFeedAccount: string;
    solUsdFeedShard: number;
    maxAgeSeconds: number;
  };
}

export interface RemoteAvailability {
  available: boolean;
  priority: RemoteGenerationRequest["priority"];
  availableGpu: number | null;
  source: "mock" | "local" | "salad";
  message: string;
}

export interface PaymentIntent {
  id: string;
  userId: string;
  walletAddress: string;
  runtime: "ace-step" | "voice-change" | "rhythm-beats";
  requestHash: string;
  currency: RemotePaymentCurrency;
  tokenMint: string;
  tokenDecimals: number;
  network: "devnet" | "mainnet-beta";
  amountAtomic: string;
  amountUsdCents: number;
  tokenPriceUsd: number;
  priceExpiresAt: string;
  recipientAddress: string;
  paymentReference: string;
  paymentMode: "token-transfer" | "free-signature";
  holderFree: boolean;
  status: string;
  transactionSignature?: string;
  expiresAt: string;
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
  refund?: PaymentRefund;
}

export interface PaymentRefund {
  id: string;
  status: string;
  transactionSignature?: string;
  updatedAt: string;
}

export class LaunchServerRequestError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `Launch server request failed (${status})`);
    this.name = "LaunchServerRequestError";
  }
}

export interface RemoteArtifact {
  id: string;
  jobId: string;
  role: "audio" | "preview" | "metadata" | "waveform" | "chart";
  variant?: string;
  objectPath: string;
  publicUrl?: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface RemoteJobEvent {
  id: string;
  jobId: string;
  fromStatus?: string;
  toStatus: string;
  message?: string;
  providerJobId?: string;
  attempt: number;
  createdAt: string;
}

export interface RemoteJobProgress {
  status: string;
  phase: string;
  progress: number | null;
  completedSteps: number | null;
  totalSteps: number | null;
  stage?: string;
  stageIndex?: number;
  stageCount?: number;
  stageKind?: string;
  message?: string;
  updatedAt: string;
}

export interface RemoteJob {
  id: string;
  userId: string;
  paymentIntentId: string;
  runtime: "ace-step" | "voice-change" | "rhythm-beats";
  modelRevision: string;
  requestHash: string;
  request: RemoteGenerationRequest;
  status: string;
  providerJobId?: string;
  attemptCount: number;
  errorCode?: string;
  errorMessage?: string;
  progress?: RemoteJobProgress;
  createdAt: string;
  updatedAt: string;
  artifacts: RemoteArtifact[];
  events: RemoteJobEvent[];
}

export interface RemoteJobHistoryPage {
  jobs: RemoteJob[];
  nextCursor?: string;
}

export interface RemoteRewardSubmission {
  id: string;
  userId: string;
  walletAddress: string;
  jobId: string;
  generationTitle: string;
  postLink: string;
  status: "pending" | "approved" | "rejected";
  rejectionReason?: string;
  audioUrl: string;
  audioMimeType: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface RemoteGenerationHealth {
  ok: boolean;
  enabled: boolean;
  launchServer?: Record<string, unknown>;
  error?: string;
}

export class LaunchServerClient {
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${env.launchServerUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Launch-Internal-Token": env.LAUNCH_SERVER_INTERNAL_TOKEN,
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new LaunchServerRequestError(response.status, body as Record<string, unknown>);
    }
    return response.json() as Promise<T>;
  }

  async health(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/health/ready");
  }

  async createPaymentIntent(input: { userId: string; walletAddress: string; request: RemoteGenerationRequest }): Promise<PaymentIntent> {
    return this.request<PaymentIntent>("/v1/payment-intents", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async price(request: RemoteGenerationRequest): Promise<RemotePricingQuote> {
    return this.request<RemotePricingQuote>("/v1/pricing", { method: "POST", body: JSON.stringify({ request }) });
  }

  async pricingConfig(): Promise<RemotePricingConfig> {
    return this.request<RemotePricingConfig>("/v1/pricing/config");
  }

  async availability(request: Pick<RemoteGenerationRequest, "priority" | "runtime">): Promise<RemoteAvailability> {
    return this.request<RemoteAvailability>("/v1/availability", { method: "POST", body: JSON.stringify(request) });
  }

  async verifyPayment(input: { paymentIntentId: string; userId: string; transactionSignature: string }): Promise<PaymentIntent> {
    return this.request<PaymentIntent>(`/v1/payment-intents/${encodeURIComponent(input.paymentIntentId)}/verify`, {
      method: "POST",
      body: JSON.stringify({ userId: input.userId, transactionSignature: input.transactionSignature }),
    });
  }

  async getPaymentIntent(input: { paymentIntentId: string; userId: string }): Promise<PaymentIntent> {
    return this.request<PaymentIntent>(`/v1/payment-intents/${encodeURIComponent(input.paymentIntentId)}?userId=${encodeURIComponent(input.userId)}`);
  }

  async createJob(input: { userId: string; paymentIntentId: string; request: RemoteGenerationRequest }): Promise<RemoteJob> {
    return this.request<RemoteJob>("/v1/jobs", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getJob(jobId: string): Promise<RemoteJob> {
    return this.request<RemoteJob>(`/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  async listJobs(userId: string, input: { limit?: number; cursor?: string; activeOnly?: boolean; knownJobIds?: string[]; runtime?: RemoteGenerationRequest["runtime"] } = {}): Promise<RemoteJobHistoryPage> {
    const params = new URLSearchParams({ limit: String(input.limit ?? 50) });
    if (input.cursor) params.set("cursor", input.cursor);
    if (input.activeOnly) params.set("active", "true");
    if (input.knownJobIds?.length) params.set("knownIds", input.knownJobIds.join(","));
    if (input.runtime) params.set("runtime", input.runtime);
    return this.request<RemoteJobHistoryPage>(`/v1/users/${encodeURIComponent(userId)}/jobs?${params.toString()}`);
  }

  async createRewardSubmission(input: { userId: string; jobId: string; postLink: string }): Promise<RemoteRewardSubmission> {
    return this.request<RemoteRewardSubmission>(`/v1/users/${encodeURIComponent(input.userId)}/jobs/${encodeURIComponent(input.jobId)}/reward-submissions`, {
      method: "POST",
      body: JSON.stringify({ postLink: input.postLink }),
    });
  }

  async listRewardSubmissions(userId: string, limit = 50): Promise<RemoteRewardSubmission[]> {
    return this.request<RemoteRewardSubmission[]>(`/v1/users/${encodeURIComponent(userId)}/reward-submissions?limit=${encodeURIComponent(String(limit))}`);
  }

  async appealRewardSubmission(input: { userId: string; id: string; postLink: string }): Promise<RemoteRewardSubmission> {
    return this.request<RemoteRewardSubmission>(`/v1/users/${encodeURIComponent(input.userId)}/reward-submissions/${encodeURIComponent(input.id)}/appeal`, {
      method: "POST",
      body: JSON.stringify({ postLink: input.postLink }),
    });
  }
}

export const launchServerClient = new LaunchServerClient();

const API_BASE = "/api";

export interface SiteSettings {
  twitterUrl: string;
  showTwitter: boolean;
  youtubeUrl: string;
  showYoutube: boolean;
  showYoutubeEmbed: boolean;
  youtubeLiveChannelId: string;
  telegramUrl: string;
  showTelegram: boolean;
  dexscreenerUrl: string;
  showDexscreener: boolean;
  pumpFunUrl: string;
  autotransitionGithubUrl: string;
  tokenAddress: string;
}

export interface PublicScheduleSlot {
  submission_id: string;
  title: string;
  status: string;
  starts_at: string;
  ends_at: string;
}

export interface LibraryFile {
  id: string;
  itemId: string;
  role: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string;
  path: string;
  publicUrl: string | null;
  sha256: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface LibraryCreator {
  displayName: string | null;
  creatorSlug: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  publicKey: string | null;
}

export interface LibraryItem {
  id: string;
  ownerId: string | null;
  visibility: string;
  status: string;
  kind: string;
  title: string;
  description: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  sourceLineage: Record<string, unknown>;
  license: string | null;
  attribution: string | null;
  createdAt: string;
  updatedAt: string;
  files: LibraryFile[];
  creator: LibraryCreator | null;
}

export interface PublicLibraryPage {
  items: LibraryItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  summary: {
    items: number;
    creators: number;
    playable: number;
    artwork: number;
  };
}

export interface CreatorProfile {
  displayName: string | null;
  creatorSlug: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
}

export interface AuthSessionResponse {
  authenticated: boolean;
  publicKey: string;
  isHolder: boolean;
  isAdmin: boolean;
  creatorProfile: CreatorProfile;
}

export interface CreatorPublishTokenRecord {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface RemoteGenerationInput {
  id?: string;
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
  runtime: "ace-step" | "voice-change" | "rhythm-beats" | "avatar";
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

export interface RemotePaymentSettings {
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
  facelessTransitionBasePriceUsdMicros: number;
  solTransitionBasePriceUsdMicros: number;
  facelessTransitionAdditionalStepPriceUsdMicros: number;
  solTransitionAdditionalStepPriceUsdMicros: number;
  facelessTransitionSecondPriceUsdMicros: number;
  solTransitionSecondPriceUsdMicros: number;
  facelessRhythmBeatsBasePriceUsdMicros: number;
  solRhythmBeatsBasePriceUsdMicros: number;
  facelessRhythmBeatsAdditionalStemPriceUsdMicros: number;
  solRhythmBeatsAdditionalStemPriceUsdMicros: number;
  facelessRhythmBeatsAdditionalStepPriceUsdMicros: number;
  solRhythmBeatsAdditionalStepPriceUsdMicros: number;
  facelessRhythmBeatsSourceSecondPriceUsdMicros: number;
  solRhythmBeatsSourceSecondPriceUsdMicros: number;
  facelessAvatarBasePriceUsdMicros: number;
  solAvatarBasePriceUsdMicros: number;
  musicFreeForHolders: boolean;
  extractionFreeForHolders: boolean;
  voiceChangeFreeForHolders: boolean;
  transitionFreeForHolders: boolean;
  rhythmBeatsFreeForHolders: boolean;
  avatarFreeForHolders: boolean;
  updatedAt: string;
}

export interface RemotePricingConfig {
  network: "devnet" | "mainnet-beta";
  paymentMode: "mock" | "solana" | "test-solana" | "free-signature";
  currencies: Record<RemotePaymentCurrency, { tokenMint: string; tokenDecimals: number }>;
  settings: RemotePaymentSettings;
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

export interface RemotePaymentIntent {
  id: string;
  userId: string;
  walletAddress: string;
  runtime: "ace-step" | "voice-change" | "rhythm-beats" | "avatar";
  requestHash: string;
  currency: RemotePaymentCurrency;
  tokenMint: string;
  tokenDecimals: number;
  network: "devnet" | "mainnet-beta";
  amountAtomic: string;
  verifiedAmountAtomic?: string;
  amountUsdCents: number;
  tokenPriceUsd: number;
  priceExpiresAt: string;
  recipientAddress: string;
  paymentReference: string;
  paymentMode: "token-transfer" | "free-signature";
  holderFree: boolean;
  paymentMessage?: string;
  status: string;
  transactionSignature?: string;
  expiresAt: string;
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
  refund?: {
    id: string;
    status: string;
    transactionSignature?: string;
    updatedAt: string;
  };
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
  runtime: "ace-step" | "voice-change" | "rhythm-beats" | "avatar";
  modelRevision: string;
  requestHash: string;
  request: RemoteGenerationRequest;
  status: string;
  providerJobId?: string;
  workerInstanceId?: string;
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
  launchServer?: {
    ok?: boolean;
    persistence?: string;
    salad?: string;
    bunny?: string;
    payments?: string;
  };
  error?: string;
}

export type SupportIssueType = "bug_report" | "refund_request" | "general_support";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error ?? `Request failed (${response.status})`);
    Object.assign(error, { status: response.status, body });
    throw error;
  }

  return response.json();
}

export const api = {
  nonce: (publicKey: string) => apiFetch<{ nonce: string; message: string; expiresAt: string }>("/auth/nonce", {
    method: "POST",
    body: JSON.stringify({ publicKey }),
  }),

  verify: (payload: { publicKey: string; nonce: string; message: string; signature: string }) =>
    apiFetch<AuthSessionResponse>("/auth/verify", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  me: () => apiFetch<AuthSessionResponse>("/auth/me"),

  refresh: () => apiFetch<{ refreshed: boolean }>("/auth/refresh", { method: "POST" }),

  logout: () => apiFetch<{ loggedOut: boolean }>("/auth/logout", { method: "POST" }),

  saveCreatorProfile: (payload: { displayName?: string | null; creatorSlug?: string | null; bio?: string | null }) =>
    apiFetch<AuthSessionResponse>("/auth/profile", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  uploadCreatorProfileMedia: async (kind: "avatar" | "banner", file: File) => {
    const formData = new FormData();
    formData.set("kind", kind);
    formData.set("file", file);

    const response = await fetch(`${API_BASE}/auth/profile/media`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `Upload failed (${response.status})`);
    }

    return response.json() as Promise<AuthSessionResponse>;
  },

  creatorPublishTokens: () => apiFetch<{ tokens: CreatorPublishTokenRecord[] }>("/auth/publish-tokens"),

  createCreatorPublishToken: (name: string) =>
    apiFetch<{ token: string; record: CreatorPublishTokenRecord }>("/auth/publish-tokens", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  revokeCreatorPublishToken: (tokenId: string) =>
    apiFetch<{ revoked: boolean }>(`/auth/publish-tokens/${encodeURIComponent(tokenId)}/revoke`, {
      method: "POST",
    }),

  createSubmission: (payload: { title: string; notes?: string; desiredStart: string; desiredEnd: string }) =>
    apiFetch<{ submissionId: string; status: string }>("/submissions", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  mySubmissions: () => apiFetch<{ submissions: any[] }>("/submissions/me"),

  siteSettings: () => apiFetch<SiteSettings>("/site-settings"),

  publicSchedule: () => apiFetch<{ slots: PublicScheduleSlot[] }>("/schedule/public"),

  publicLibrary: (params: {
    kind?: string;
    tag?: string;
    search?: string;
    sort?: "newest" | "oldest";
    playable?: boolean;
    artwork?: boolean;
    license?: string;
    limit?: number;
    offset?: number;
  } = {}) => {
    const query = new URLSearchParams();
    if (params.kind) query.set("kind", params.kind);
    if (params.tag) query.set("tag", params.tag);
    if (params.search) query.set("search", params.search);
    if (params.sort) query.set("sort", params.sort);
    if (params.playable) query.set("playable", "true");
    if (params.artwork) query.set("artwork", "true");
    if (params.license) query.set("license", params.license);
    if (params.limit) query.set("limit", String(params.limit));
    if (params.offset) query.set("offset", String(params.offset));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return apiFetch<PublicLibraryPage>(`/library${suffix}`);
  },

  publicLibraryItem: (itemId: string) => apiFetch<{ item: LibraryItem }>(`/library/${encodeURIComponent(itemId)}`),

  upsertOwnedLibraryItem: (payload: {
    visibility: string;
    kind: string;
    title: string;
    description?: string | null;
    tags?: string[];
    metadata: Record<string, unknown>;
    sourceLineage: Record<string, unknown>;
    localId?: string;
    license?: string | null;
    attribution?: string | null;
  }) =>
    apiFetch<{ item: LibraryItem }>("/library/publish/items", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  createDraftLibraryItem: (payload: {
    visibility: string;
    kind: string;
    title: string;
    description?: string | null;
    tags?: string[];
    metadata: Record<string, unknown>;
    sourceLineage: Record<string, unknown>;
    license?: string | null;
    attribution?: string | null;
  }) =>
    apiFetch<{ itemId: string; status: string }>("/library", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  uploadDraftLibraryFile: async (
    itemId: string,
    payload: { role: string; metadata?: Record<string, unknown>; file: File },
  ) => {
    const formData = new FormData();
    formData.set("role", payload.role);
    formData.set("metadata", JSON.stringify(payload.metadata ?? {}));
    formData.set("file", payload.file);

    const response = await fetch(`${API_BASE}/library/publish/items/${encodeURIComponent(itemId)}/files`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `Upload failed (${response.status})`);
    }

    return response.json() as Promise<{ item: LibraryItem }>;
  },

  importInstrumentPackage: async (payload: {
    title: string;
    sfz: File;
    samples: File[];
    itemId?: string;
    license?: string;
    attribution?: string;
  }) => {
    const formData = new FormData();
    formData.set("title", payload.title);
    if (payload.itemId) formData.set("itemId", payload.itemId);
    if (payload.license) formData.set("license", payload.license);
    if (payload.attribution) formData.set("attribution", payload.attribution);
    formData.set("sfz", payload.sfz);
    payload.samples.forEach((sample) => formData.append("samples", sample));

    const response = await fetch(`${API_BASE}/library/publish/instruments/import`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `Instrument import failed (${response.status})`);
    }
    return response.json() as Promise<{ item: LibraryItem; validation: Record<string, unknown> }>;
  },

  copyDraftLibraryFileFromStorage: (itemId: string, payload: {
    role: string;
    metadata?: Record<string, unknown>;
    sourceObjectPath: string;
    mimeType?: string;
    fileName?: string;
  }) =>
    apiFetch<{ item: LibraryItem }>(`/library/publish/items/${encodeURIComponent(itemId)}/files/from-storage`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  clearOwnedLibraryItemFiles: (itemId: string) =>
    apiFetch<{ item: LibraryItem }>(`/library/publish/items/${encodeURIComponent(itemId)}/files`, {
      method: "DELETE",
    }),

  publishDraftLibraryItem: (itemId: string) =>
    apiFetch<{ item: LibraryItem }>(`/library/publish/items/${encodeURIComponent(itemId)}/publish`, {
      method: "POST",
    }),

  revokeOwnedLibraryItem: (itemId: string) =>
    apiFetch<{ item: LibraryItem }>(`/library/publish/items/${encodeURIComponent(itemId)}/revoke`, {
      method: "POST",
    }),

  remoteGenerationHealth: () => apiFetch<RemoteGenerationHealth>("/remote-generation/health"),

  uploadRemoteGenerationSource: async (file: File) => {
    const formData = new FormData();
    formData.set("file", file);

    const response = await fetch(`${API_BASE}/remote-generation/sources`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `Upload failed (${response.status})`);
    }

    return response.json() as Promise<{ input: RemoteGenerationInput }>;
  },

  uploadRemoteGenerationAvatarSource: async (file: File, role: "mesh" | "manifest" | "reference-image") => {
    const formData = new FormData();
    formData.set("file", file);
    formData.set("role", role);
    const response = await fetch(`${API_BASE}/remote-generation/avatar-sources`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `Avatar upload failed (${response.status})`);
    }
    return response.json() as Promise<{ input: RemoteGenerationInput }>;
  },

  remoteGenerationPricing: (request: RemoteGenerationRequest) =>
    apiFetch<RemotePricingQuote>("/remote-generation/pricing", {
      method: "POST",
      body: JSON.stringify({ request }),
    }),

  remoteGenerationPricingConfig: () =>
    apiFetch<RemotePricingConfig>("/remote-generation/pricing-config"),

  remoteGenerationAvailability: (priority: RemoteGenerationRequest["priority"], runtime: RemoteGenerationRequest["runtime"] = "ace-step") =>
    apiFetch<RemoteAvailability>("/remote-generation/availability", {
      method: "POST",
      body: JSON.stringify({ priority, runtime }),
    }),

  createRemotePaymentIntent: (request: RemoteGenerationRequest) =>
    apiFetch<RemotePaymentIntent>("/remote-generation/payment-intents", {
      method: "POST",
      body: JSON.stringify({ request }),
    }),

  verifyRemotePayment: (paymentIntentId: string, transactionSignature: string) =>
    apiFetch<RemotePaymentIntent>(`/remote-generation/payment-intents/${encodeURIComponent(paymentIntentId)}/verify`, {
      method: "POST",
      body: JSON.stringify({ transactionSignature }),
    }),

  remotePaymentIntent: (paymentIntentId: string) =>
    apiFetch<RemotePaymentIntent>(`/remote-generation/payment-intents/${encodeURIComponent(paymentIntentId)}`),

  createRemoteJob: (paymentIntentId: string, request: RemoteGenerationRequest) =>
    apiFetch<RemoteJob>("/remote-generation/jobs", {
      method: "POST",
      body: JSON.stringify({ paymentIntentId, request }),
    }),

  remoteJob: (jobId: string) => apiFetch<RemoteJob>(`/remote-generation/jobs/${encodeURIComponent(jobId)}`),

  remoteChart: (objectPath: string) => apiFetch<unknown>(`/remote-generation/assets/chart?path=${encodeURIComponent(objectPath)}`),

  remoteJobs: (input: number | { limit?: number; cursor?: string; activeOnly?: boolean; knownJobIds?: string[]; runtime?: RemoteGenerationRequest["runtime"] } = 50) => {
    const options = typeof input === "number" ? { limit: input } : input;
    const params = new URLSearchParams({ limit: String(options.limit ?? 50) });
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.activeOnly) params.set("active", "true");
    if (options.knownJobIds?.length) params.set("knownIds", options.knownJobIds.join(","));
    if (options.runtime) params.set("runtime", options.runtime);
    return apiFetch<RemoteJobHistoryPage>(`/remote-generation/jobs?${params.toString()}`);
  },

  createRemoteRewardSubmission: (jobId: string, postLink: string) =>
    apiFetch<RemoteRewardSubmission>(`/remote-generation/jobs/${encodeURIComponent(jobId)}/reward-submission`, {
      method: "POST",
      body: JSON.stringify({ postLink }),
    }),

  remoteRewardSubmissions: (limit = 50) => apiFetch<RemoteRewardSubmission[]>(`/remote-generation/reward-submissions?limit=${encodeURIComponent(String(limit))}`),

  submitSupportRequest: (payload: { email: string; issueType: SupportIssueType; message: string }) =>
    apiFetch<{ submitted: boolean }>("/support", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  appealRemoteRewardSubmission: (submissionId: string, postLink: string) =>
    apiFetch<RemoteRewardSubmission>(`/remote-generation/reward-submissions/${encodeURIComponent(submissionId)}/appeal`, {
      method: "POST",
      body: JSON.stringify({ postLink }),
    }),

  adminSiteSettings: () => apiFetch<SiteSettings>("/site-settings/admin"),

  saveAdminSiteSettings: (payload: SiteSettings) =>
    apiFetch<SiteSettings>("/site-settings/admin", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  adminSubmissions: () => apiFetch<{ submissions: any[] }>("/admin/submissions"),

  adminSubmissionDetail: (submissionId: string) => apiFetch<{ submission: any; assets: any[] }>(`/admin/submissions/${submissionId}`),

  adminSetStatus: (submissionId: string, status: string, rejectionReason?: string) =>
    apiFetch<{ updated: boolean }>(`/admin/submissions/${submissionId}/status`, {
      method: "POST",
      body: JSON.stringify({ status, rejectionReason }),
    }),

  uploadAsset: async (assetType: string, file: File, submissionId?: string) => {
    const formData = new FormData();
    formData.set("assetType", assetType);
    formData.set("file", file);

    const path = submissionId ? `/submissions/${submissionId}/assets` : "/submissions/assets";
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? `Upload failed (${response.status})`);
    }

    return response.json() as Promise<{ submissionId: string; assetId: string; publicUrl: string }>;
  },
};

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
    throw new Error(body.error ?? `Request failed (${response.status})`);
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

  publicLibrary: (params: { kind?: string; tag?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.kind) query.set("kind", params.kind);
    if (params.tag) query.set("tag", params.tag);
    if (params.limit) query.set("limit", String(params.limit));
    if (params.offset) query.set("offset", String(params.offset));
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return apiFetch<{ items: LibraryItem[] }>(`/library${suffix}`);
  },

  publicLibraryItem: (itemId: string) => apiFetch<{ item: LibraryItem }>(`/library/${encodeURIComponent(itemId)}`),

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

export type SessionRole = "user" | "admin";

export interface CreatorProfile {
  displayName: string | null;
  creatorSlug: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
}

export interface SessionPayload {
  userId: string;
  publicKey: string;
  isHolder: boolean;
  isAdmin: boolean;
}

export interface AuthSessionResponse {
  authenticated: true;
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

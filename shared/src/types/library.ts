export type LibraryVisibility = "private" | "unlisted" | "public";

export type LibraryStatus = "draft" | "submitted" | "approved" | "rejected" | "published" | "archived";

export type LibraryKind =
  | "audio"
  | "generation"
  | "transition"
  | "extraction"
  | "stem"
  | "merge"
  | "edit"
  | "instrument"
  | "instrumenttrack"
  | "dataset"
  | "lokr"
  | "rhythm_game"
  | "tool";

export type LibraryFileRole =
  | "audio"
  | "preview"
  | "cover"
  | "metadata"
  | "dataset_manifest"
  | "adapter_weights"
  | "chart"
  | "stem"
  | "project";

export type LibraryStorageProvider = "local" | "bunny";

export interface LibraryFileRecord {
  id: string;
  itemId: string;
  role: LibraryFileRole;
  mimeType: string;
  sizeBytes: number;
  storageProvider: LibraryStorageProvider;
  path: string;
  publicUrl: string | null;
  sha256: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface LibraryItemRecord {
  id: string;
  ownerId: string | null;
  visibility: LibraryVisibility;
  status: LibraryStatus;
  kind: LibraryKind;
  title: string;
  description: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  sourceLineage: Record<string, unknown>;
  license: string | null;
  attribution: string | null;
  createdAt: string;
  updatedAt: string;
  files: LibraryFileRecord[];
}

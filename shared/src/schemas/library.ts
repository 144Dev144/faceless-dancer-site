import { z } from "zod";

export const libraryVisibilitySchema = z.enum(["private", "unlisted", "public"]);

export const libraryStatusSchema = z.enum(["draft", "submitted", "approved", "rejected", "published", "archived"]);

export const libraryKindSchema = z.enum([
  "audio",
  "generation",
  "transition",
  "extraction",
  "stem",
  "merge",
  "edit",
  "instrument",
  "instrumenttrack",
  "dataset",
  "lokr",
  "rhythm_game",
  "tool",
]);

export const libraryFileRoleSchema = z.enum([
  "audio",
  "preview",
  "cover",
  "metadata",
  "dataset_manifest",
  "adapter_weights",
  "chart",
  "stem",
  "project",
]);

export const libraryStorageProviderSchema = z.enum(["local", "bunny"]);

export const libraryJsonObjectSchema = z.record(z.unknown()).default({});

export const createLibraryItemSchema = z.object({
  visibility: libraryVisibilitySchema.default("private"),
  kind: libraryKindSchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(3000).optional(),
  tags: z.array(z.string().trim().min(1).max(48)).max(24).default([]),
  metadata: libraryJsonObjectSchema,
  sourceLineage: libraryJsonObjectSchema,
  license: z.string().trim().max(160).optional(),
  attribution: z.string().trim().max(1000).optional(),
});

export const createLibraryFileSchema = z.object({
  role: libraryFileRoleSchema,
  mimeType: z.string().trim().min(1).max(160),
  sizeBytes: z.coerce.number().int().nonnegative(),
  storageProvider: libraryStorageProviderSchema.default("bunny"),
  path: z.string().trim().min(1).max(2000),
  publicUrl: z.string().url().optional(),
  sha256: z.string().trim().regex(/^[a-fA-F0-9]{64}$/).optional(),
  metadata: libraryJsonObjectSchema,
});

export const libraryListQuerySchema = z.object({
  kind: libraryKindSchema.optional(),
  tag: z.string().trim().min(1).max(48).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

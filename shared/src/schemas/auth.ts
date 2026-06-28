import { z } from "zod";

export const nonceRequestSchema = z.object({
  publicKey: z.string().min(32),
});

export const verifySignatureSchema = z.object({
  publicKey: z.string().min(32),
  nonce: z.string().min(8),
  message: z.string().min(20),
  signature: z.string().min(32),
});

const optionalTrimmedText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable().optional()
  );

export const creatorProfileUpdateSchema = z.object({
  displayName: optionalTrimmedText(80),
  creatorSlug: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/, "Use lowercase letters, numbers, and hyphens")
      .nullable()
      .optional()
  ),
  bio: optionalTrimmedText(1000),
});

export const creatorProfileMediaKindSchema = z.enum(["avatar", "banner"]);

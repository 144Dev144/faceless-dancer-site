import { z } from "zod";

const inputSchema = z.object({
  id: z.string().trim().min(1).max(80).optional(),
  role: z.string().trim().min(1).max(80),
  sourceUrl: z.string().url(),
  mimeType: z.string().trim().min(1).max(160),
  fileName: z.string().trim().min(1).max(240).optional(),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  durationSeconds: z.number().finite().positive().max(86_400).optional(),
});

const metadataSchema = z.object({
  title: z.string().trim().min(1).max(120),
}).optional();

export const remoteGenerationPrioritySchema = z.enum(["low", "standard", "high"]);
export const remotePaymentCurrencySchema = z.enum(["FACELESS", "SOL"]);

export const remoteGenerationRequestSchema = z.object({
  runtime: z.enum(["ace-step", "voice-change"]).default("ace-step"),
  modelRevision: z.string().trim().min(1).max(200).default("ace-step-1.5"),
  inputs: z.array(inputSchema).max(16).default([]),
  priority: remoteGenerationPrioritySchema.default("standard"),
  paymentCurrency: remotePaymentCurrencySchema.optional(),
  metadata: metadataSchema,
  parameters: z.record(z.unknown()).default({}),
}).superRefine((value, context) => {
  const taskType = typeof value.parameters.task_type === "string" ? value.parameters.task_type : "text2music";
  if (taskType === "extract" && value.inputs.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["inputs"], message: "This extraction task requires a source input." });
  }
  if (value.runtime === "voice-change") {
    const roles = new Set(value.inputs.map((input) => input.role));
    if (!roles.has("song") || !roles.has("reference")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["inputs"], message: "Voice Change requires song and reference audio inputs." });
    if (taskType !== "voice_change") context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "task_type"], message: "Voice Change requests must use task_type=voice_change." });
    if ("loudness_optimization" in value.parameters && typeof value.parameters.loudness_optimization !== "boolean") context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "loudness_optimization"], message: "loudness_optimization must be a boolean when provided." });
  }
});

export const verifyPaymentRequestSchema = z.object({
  transactionSignature: z.string().trim().min(20).max(200),
});

export const createJobRequestSchema = z.object({
  paymentIntentId: z.string().uuid(),
  request: remoteGenerationRequestSchema,
});

export const createRewardSubmissionRequestSchema = z.object({
  postLink: z.string().trim().min(1).max(2048),
});

export const appealRewardSubmissionRequestSchema = createRewardSubmissionRequestSchema;

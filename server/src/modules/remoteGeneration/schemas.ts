import { z } from "zod";

const inputSchema = z.object({
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
  runtime: z.literal("ace-step").default("ace-step"),
  modelRevision: z.string().trim().min(1).max(200).default("ace-step-1.5"),
  inputs: z.array(inputSchema).max(16).default([]),
  priority: remoteGenerationPrioritySchema.default("standard"),
  paymentCurrency: remotePaymentCurrencySchema.optional(),
  metadata: metadataSchema,
  parameters: z.record(z.unknown()).default({}),
}).superRefine((value, context) => {
  const taskType = typeof value.parameters.task_type === "string" ? value.parameters.task_type : "text2music";
  if (taskType === "extract" && value.inputs.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["inputs"], message: "This ACE-Step task requires a source input." });
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

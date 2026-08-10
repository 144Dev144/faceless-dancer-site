import { z } from "zod";

export const danceMotionCompositionSegmentSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().trim().min(1).max(160),
  sourceJobId: z.string().uuid().optional(),
  clip: z.record(z.unknown()),
  offsetSeconds: z.number().finite().min(0),
  trimStartSeconds: z.number().finite().min(0),
  trimEndSeconds: z.number().finite().positive(),
});

export const danceMotionCompositionSchema = z.object({
  format: z.literal("faceless-dance-composition"),
  version: z.literal(1),
  title: z.string().trim().min(1).max(160),
  durationSeconds: z.number().finite().positive(),
  segments: z.array(danceMotionCompositionSegmentSchema).min(1).max(128),
  audioSource: z.object({
    url: z.string().url(),
    fileName: z.string().max(240).optional(),
    mimeType: z.string().max(160).optional(),
  }).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

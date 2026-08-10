import { z } from "zod";

export const danceMotionJobIdSchema = z.string().uuid();

export const danceMotionArtifactKindSchema = z.enum([
  "source-video",
  "raw-pose",
  "filtered-pose",
  "depth-resolved-pose",
  "canonical-motion",
  "wireframe-video",
  "diagnostics"
]);

export const danceMotionResultSchema = z.object({
  rawPoseJson: z.string().min(2),
  filteredPoseJson: z.string().min(2).optional(),
  depthResolvedPoseJson: z.string().min(2).optional(),
  canonicalMotionJson: z.string().min(2),
  diagnosticsJson: z.string().min(2)
});

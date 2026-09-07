import { z } from "zod";

const GENERATIVE_DANCE_MAX_DURATION_SECONDS = 12;

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
  reanalysisOfJobId: z.string().uuid().optional(),
}).optional();

export const remoteGenerationPrioritySchema = z.enum(["low", "standard", "high"]);
export const remotePaymentCurrencySchema = z.enum(["FACELESS", "SOL"]);

export const remoteGenerationRequestSchema = z.object({
  runtime: z.enum(["ace-step", "voice-change", "rhythm-beats", "avatar", "flux-image", "wan-animate"]).default("ace-step"),
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
  if (value.runtime === "rhythm-beats") {
    const stems = ["vocals", "backing_vocals", "drums", "bass", "guitar", "keyboard", "percussion", "strings", "synth", "fx", "brass", "woodwinds"];
    if (taskType !== "rhythm_beats") context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "task_type"], message: "Rhythm Beats requests must use task_type=rhythm_beats." });
    if (value.inputs.length !== 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["inputs"], message: "Rhythm Beats requires one source audio input." });
    const mode = value.parameters.stem_mode;
    const selected = value.parameters.selected_stems;
    if (mode !== "all" && mode !== "selected") context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "stem_mode"], message: "Choose all stems or selected stems." });
    if (mode === "selected" && (!Array.isArray(selected) || selected.length < 1 || selected.some((stem) => typeof stem !== "string" || !stems.includes(stem)))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "selected_stems"], message: "Select at least one supported stem." });
  }
  if (value.runtime === "avatar") {
    if (!["avatar", "avatar_reskin", "reskin"].includes(taskType)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "task_type"], message: "Avatar requests must use task_type=avatar or task_type=avatar_reskin." });
    }
    if (taskType === "avatar_reskin" || taskType === "reskin") {
      const roles = new Set(value.inputs.map((input) => input.role));
      const hasCanonicalProfile = ["manifest", "profile", "canonical_profile", "canonical-profile"].some((role) => roles.has(role));
      if (!roles.has("mesh") || !hasCanonicalProfile) context.addIssue({ code: z.ZodIssueCode.custom, path: ["inputs"], message: "Avatar reskin requires mesh and canonical profile inputs." });
    }
  }
  if (value.runtime === "flux-image") {
    if (taskType !== "generative_avatar") context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "task_type"], message: "Flux image requests must use task_type=generative_avatar." });
    if (value.inputs.some((input) => input.role !== "reference-image")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["inputs"], message: "Flux image inputs must be reference images." });
    if (value.inputs.length > 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ["inputs"], message: "Flux image accepts at most one reference image." });
    if (typeof value.parameters.description !== "string" || !value.parameters.description.trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "description"], message: "Flux image requests require a description." });
  }
  if (value.runtime === "wan-animate") {
    if (taskType !== "generative_dance") context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "task_type"], message: "Wan Animate requests must use task_type=generative_dance." });
    const sequence = value.parameters.sequence;
    const inputs = new Map(value.inputs.map((input) => [input.id ?? input.role, input]));
    if (!sequence || typeof sequence !== "object" || Array.isArray(sequence)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "sequence"], message: "Wan Animate requires a sequence payload." });
    } else {
      const candidate = sequence as Record<string, unknown>;
      const segments = Array.isArray(candidate.segments) ? candidate.segments : [];
      const declaredDuration = typeof candidate.durationSeconds === "number" ? candidate.durationSeconds : 0;
      const fps = typeof candidate.fps === "number" ? candidate.fps : 0;
      const maxFrames = typeof candidate.maxFramesPerGeneration === "number" ? candidate.maxFramesPerGeneration : 0;
      if (fps <= 0 || fps > 60) context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "sequence", "fps"], message: "Sequence fps must be between 1 and 60." });
      if (maxFrames < 1 || maxFrames > 81) context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "sequence", "maxFramesPerGeneration"], message: "Sequence maxFramesPerGeneration must be between 1 and 81." });
      if (segments.length < 1 || segments.length > 15) context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "sequence", "segments"], message: "Add between one and fifteen dance segments." });
      if (declaredDuration <= 0 || declaredDuration > GENERATIVE_DANCE_MAX_DURATION_SECONDS + 0.01) context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "sequence", "durationSeconds"], message: `Generative dance sequences cannot exceed ${GENERATIVE_DANCE_MAX_DURATION_SECONDS} seconds.` });
      let maxTimelineEnd = 0;
      for (const [index, raw] of segments.entries()) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "sequence", "segments", index], message: "Each sequence segment must be an object." });
          continue;
        }
        const segment = raw as Record<string, unknown>;
        const inputId = typeof segment.inputId === "string" ? segment.inputId : "";
        const sourceStart = typeof segment.sourceStartSeconds === "number" ? segment.sourceStartSeconds : -1;
        const sourceEnd = typeof segment.sourceEndSeconds === "number" ? segment.sourceEndSeconds : -1;
        const timelineEnd = typeof segment.timelineEndSeconds === "number" ? segment.timelineEndSeconds : -1;
        const windows = Array.isArray(segment.windows) ? segment.windows : [];
        if (!inputs.has(inputId) || inputs.get(inputId)?.role !== "driver") context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "sequence", "segments", index, "inputId"], message: "Each segment must reference a driver input." });
        if (sourceStart < 0 || sourceEnd <= sourceStart) context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "sequence", "segments", index], message: "Each segment needs a positive source time range." });
        maxTimelineEnd = Math.max(maxTimelineEnd, timelineEnd);
        if (!windows.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "sequence", "segments", index, "windows"], message: "Each segment needs at least one generation window." });
        for (const [windowIndex, rawWindow] of windows.entries()) {
          if (!rawWindow || typeof rawWindow !== "object" || Array.isArray(rawWindow)) {
            context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "sequence", "segments", index, "windows", windowIndex], message: "Each generation window must be an object." });
            continue;
          }
          const window = rawWindow as Record<string, unknown>;
          const windowSourceStart = typeof window.sourceStartSeconds === "number" ? window.sourceStartSeconds : -1;
          const windowSourceEnd = typeof window.sourceEndSeconds === "number" ? window.sourceEndSeconds : -1;
          if (windowSourceStart < sourceStart - 0.05 || windowSourceEnd > sourceEnd + 0.05 || windowSourceEnd <= windowSourceStart) {
            context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "sequence", "segments", index, "windows", windowIndex], message: "Generation windows must stay inside their source segment." });
          }
          if (fps > 0 && maxFrames > 0 && (windowSourceEnd - windowSourceStart) > maxFrames / fps + 0.05) {
            context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "sequence", "segments", index, "windows", windowIndex], message: "Each generation window must fit the configured worker window." });
          }
        }
      }
      if (maxTimelineEnd > GENERATIVE_DANCE_MAX_DURATION_SECONDS + 0.01) context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "sequence"], message: `Generative dance sequences cannot exceed ${GENERATIVE_DANCE_MAX_DURATION_SECONDS} seconds.` });
    }
    const hasAvatar = value.inputs.some((input) => input.role === "avatar-reference" || input.role === "reference-image");
    if (!hasAvatar) context.addIssue({ code: z.ZodIssueCode.custom, path: ["inputs"], message: "Wan Animate requires one avatar reference input." });
    if (!value.inputs.some((input) => input.role === "driver")) context.addIssue({ code: z.ZodIssueCode.custom, path: ["inputs"], message: "Wan Animate requires at least one driver video input." });
    const postprocess = value.parameters.postprocess;
    if (postprocess !== undefined) {
      if (!postprocess || typeof postprocess !== "object" || Array.isArray(postprocess)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "postprocess"], message: "Wan Animate postprocess must be an object." });
      } else {
        const options = postprocess as Record<string, unknown>;
        for (const name of ["enhancement_enabled", "motion_interpolation_enabled"]) {
          if (options[name] !== undefined && typeof options[name] !== "boolean") context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "postprocess", name], message: `${name} must be a boolean.` });
        }
        const scale = options.enhancement_scale;
        if (scale !== undefined && (typeof scale !== "number" || !Number.isFinite(scale) || scale < 1 || scale > 4)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "postprocess", "enhancement_scale"], message: "enhancement_scale must be between 1 and 4." });
        const targetFps = options.motion_interpolation_target_fps;
        if (targetFps !== undefined && (typeof targetFps !== "number" || !Number.isInteger(targetFps) || targetFps < 24 || targetFps > 60)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["parameters", "postprocess", "motion_interpolation_target_fps"], message: "motion_interpolation_target_fps must be an integer between 24 and 60." });
      }
    }
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

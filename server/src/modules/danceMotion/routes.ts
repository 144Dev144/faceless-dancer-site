import { promisify } from "node:util";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { danceMotionJobIdSchema, danceMotionResultSchema } from "@faceless/shared";
import { env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import {
  createDanceMotionJob,
  getDanceMotionArtifactPath,
  getDanceMotionJob,
  saveDanceMotionResult,
  updateDanceMotionJob
} from "./jobStore.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.danceMotionMaxUploadBytes,
    fieldSize: env.danceMotionMaxResultBytes,
    fields: 6,
    files: 1
  }
});
const conversionUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.danceMotionMaxResultBytes,
    files: 1
  }
});
const execFileAsync = promisify(execFile);
const requireMotionAuth = env.NODE_ENV === "production"
  ? requireAuth
  : (_req: Parameters<typeof requireAuth>[0], _res: Parameters<typeof requireAuth>[1], next: Parameters<typeof requireAuth>[2]) => next();

router.use(requireMotionAuth);

function parseJobId(value: string): string | null {
  const result = danceMotionJobIdSchema.safeParse(value);
  return result.success ? result.data : null;
}

router.post("/jobs", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "A dance video is required." });
    if (!req.file.mimetype.startsWith("video/")) {
      return res.status(400).json({ error: "Upload a supported video file." });
    }
    const job = await createDanceMotionJob({
      originalFileName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      sourceBuffer: req.file.buffer
    });
    return res.status(201).json({ job });
  } catch (error: unknown) {
    console.error("[dance-motion] upload failed", error);
    return res.status(500).json({ error: "The dance video could not be stored." });
  }
});

router.get("/jobs/:jobId", async (req, res) => {
  const jobId = parseJobId(req.params.jobId);
  if (!jobId) return res.status(400).json({ error: "Invalid motion job id." });
  const job = await getDanceMotionJob(jobId);
  if (!job) return res.status(404).json({ error: "Motion job not found." });
  return res.json({ job });
});

router.patch("/jobs/:jobId", async (req, res) => {
  const jobId = parseJobId(req.params.jobId);
  if (!jobId) return res.status(400).json({ error: "Invalid motion job id." });
  const update = req.body as { status?: string; progress?: number; stage?: string; error?: string };
  const job = await updateDanceMotionJob(jobId, {
    status: update.status === "processing" || update.status === "failed" ? update.status : undefined,
    progress: Number.isFinite(Number(update.progress)) ? Number(update.progress) : undefined,
    stage: typeof update.stage === "string" ? update.stage.slice(0, 240) : undefined,
    error: typeof update.error === "string" ? update.error.slice(0, 500) : undefined
  });
  if (!job) return res.status(404).json({ error: "Motion job not found." });
  return res.json({ job });
});

router.post("/jobs/:jobId/result", upload.single("wireframeVideo"), async (req, res) => {
  const jobId = parseJobId(req.params.jobId);
  if (!jobId) return res.status(400).json({ error: "Invalid motion job id." });
  const parsed = danceMotionResultSchema.safeParse({
    rawPoseJson: req.body.rawPoseJson,
    filteredPoseJson: req.body.filteredPoseJson,
    depthResolvedPoseJson: req.body.depthResolvedPoseJson,
    canonicalMotionJson: req.body.canonicalMotionJson,
    diagnosticsJson: req.body.diagnosticsJson
  });
  if (!parsed.success) {
    console.warn("[dance-motion] result data rejected", {
      fields: Object.fromEntries(Object.entries(req.body ?? {}).map(([key, value]) => [key, typeof value === "string" ? value.length : typeof value])),
      issues: parsed.error.issues.map((issue) => ({ path: issue.path, code: issue.code }))
    });
    return res.status(400).json({ error: "Motion result data is incomplete." });
  }
  try {
    JSON.parse(parsed.data.rawPoseJson);
    JSON.parse(parsed.data.filteredPoseJson ?? parsed.data.rawPoseJson);
    if (parsed.data.depthResolvedPoseJson) JSON.parse(parsed.data.depthResolvedPoseJson);
    JSON.parse(parsed.data.canonicalMotionJson);
    JSON.parse(parsed.data.diagnosticsJson);
    const job = await saveDanceMotionResult({
      jobId,
      ...parsed.data,
      filteredPoseJson: parsed.data.filteredPoseJson ?? parsed.data.rawPoseJson,
      wireframeVideo: req.file ? { buffer: req.file.buffer, contentType: req.file.mimetype } : undefined
    });
    if (!job) return res.status(404).json({ error: "Motion job not found." });
    return res.json({ job });
  } catch (error: unknown) {
    console.error("[dance-motion] result save failed", error);
    return res.status(500).json({ error: "The extracted motion could not be stored." });
  }
});

router.post("/render-mp4", conversionUpload.single("webm"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "A recorded WebM clip is required." });
  const isWebm = req.file.mimetype.includes("webm") || req.file.originalname.toLowerCase().endsWith(".webm");
  if (!isWebm) {
    return res.status(400).json({ error: "Only WebM dance recordings can be converted." });
  }

  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "faceless-dance-export-"));
  const inputPath = path.join(tempDirectory, "dance-clip.webm");
  const outputPath = path.join(tempDirectory, "dance-clip.mp4");
  try {
    await fs.writeFile(inputPath, req.file.buffer);
    await execFileAsync(env.danceMotionFfmpegPath, [
      "-y",
      "-hide_banner",
      "-loglevel", "error",
      "-fflags", "+genpts",
      "-i", inputPath,
      "-map", "0:v:0",
      "-map", "0:a:0",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "160k",
      "-ar", "48000",
      "-movflags", "+faststart",
      "-shortest",
      outputPath
    ], {
      timeout: env.danceMotionConversionTimeoutMs,
      maxBuffer: 2 * 1024 * 1024
    });
    const output = await fs.readFile(outputPath);
    res.type("mp4");
    res.setHeader("Content-Disposition", 'attachment; filename="dance-clip.mp4"');
    return res.send(output);
  } catch (error: unknown) {
    console.error("[dance-motion] MP4 conversion failed", error);
    return res.status(500).json({ error: "The dance clip could not be converted to MP4." });
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});

router.get("/jobs/:jobId/artifacts/:kind", async (req, res) => {
  const jobId = parseJobId(req.params.jobId);
  if (!jobId) return res.status(400).json({ error: "Invalid motion job id." });
  const allowedKinds = new Set(["source-video", "raw-pose", "filtered-pose", "depth-resolved-pose", "canonical-motion", "wireframe-video", "diagnostics"]);
  if (!allowedKinds.has(req.params.kind)) return res.status(404).end();
  const result = await getDanceMotionArtifactPath(jobId, req.params.kind as "source-video" | "raw-pose" | "filtered-pose" | "depth-resolved-pose" | "canonical-motion" | "wireframe-video" | "diagnostics");
  if (!result) return res.status(404).json({ error: "Motion artifact not found." });
  res.type(result.artifact.contentType);
  return res.sendFile(result.path);
});

export const danceMotionRouter = router;

import crypto from "node:crypto";
import path from "node:path";
import multer from "multer";
import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { env } from "../../config/env.js";
import { createId } from "../../utils/crypto.js";
import { buildObjectPath, downloadFromBunny, uploadBufferToBunny } from "../storage/bunnyStorage.js";
import { LaunchServerRequestError, launchServerClient } from "./client.js";
import { appealRewardSubmissionRequestSchema, createJobRequestSchema, createRewardSubmissionRequestSchema, remoteGenerationPrioritySchema, remoteGenerationRequestSchema, verifyPaymentRequestSchema } from "./schemas.js";

const router = Router();
const sourceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.libraryMaxUploadSizeBytes },
});

const supportedAudioMimeAliases = new Set([
  ...env.allowedAudioMime,
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/vnd.wave",
  "audio/flac",
  "audio/x-flac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "application/ogg",
  "audio/opus",
  "audio/aac",
  "audio/webm",
]);

const supportedAudioExtensions = new Set([".aac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".webm"]);
const browserFallbackMimeTypes = new Set(["", "application/octet-stream", "binary/octet-stream"]);

function isSupportedAudioUpload(file: Express.Multer.File): boolean {
  const mimeType = String(file.mimetype || "").trim().toLowerCase();
  if (supportedAudioMimeAliases.has(mimeType)) return true;

  const extension = path.extname(file.originalname || "").toLowerCase();
  return browserFallbackMimeTypes.has(mimeType) && supportedAudioExtensions.has(extension);
}

function safeSourceFileName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return clean.slice(0, 120) || "source-audio";
}

function isRemoteGenerationObjectPath(objectPath: string): boolean {
  return /^remote-generation(?:-[A-Za-z0-9-]+)?\/jobs\/[A-Za-z0-9-]+\/[^/]+(?:\/[^/]+)*$/.test(objectPath)
    && !objectPath.includes("..")
    && !objectPath.includes("\\");
}

function requireEnabled(res: Response): boolean {
  if (env.remoteGenerationEnabled) return true;
  res.status(404).json({ error: "Remote generation is not enabled" });
  return false;
}

function respondRemoteGenerationError(error: unknown, res: Response, fallback: string): void {
  if (error instanceof LaunchServerRequestError) {
    const code = typeof error.body.code === "string" ? error.body.code : undefined;
    const safeProviderError = code === "GENERATION_SERVICE_UNAVAILABLE" || code === "PAYMENT_VERIFICATION_FAILED";
    if (safeProviderError) {
      res.status(error.status).json(error.body);
      return;
    }
    if (error.status < 500) {
      res.status(error.status).json({ error: typeof error.body.error === "string" ? error.body.error : fallback, ...(code ? { code } : {}) });
      return;
    }
  }

  console.error("[remote-generation] request failed", error);
  res.status(503).json({ error: fallback, code: "REMOTE_GENERATION_UNAVAILABLE" });
}

router.get("/assets/audio", async (req, res) => {
  const objectPath = typeof req.query.path === "string" ? req.query.path.trim() : "";
  if (!isRemoteGenerationObjectPath(objectPath)) {
    return res.status(400).json({ error: "Invalid remote audio asset path" });
  }

  try {
    const asset = await downloadFromBunny(objectPath);
    res.setHeader("Content-Type", asset.contentType || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.send(asset.buffer);
  } catch (error) {
    console.error("[remote-generation] audio asset proxy failed", { objectPath, error });
    return res.status(404).json({ error: "Remote audio asset not found" });
  }
});

router.get("/health", async (_req, res) => {
  if (!env.remoteGenerationEnabled) return res.json({ ok: true, enabled: false });
  try {
    const launchServer = await launchServerClient.health();
    return res.json({ ok: true, enabled: true, launchServer });
  } catch (error) {
    console.error("[remote-generation] health check failed", error);
    return res.status(503).json({ ok: false, enabled: true, error: "Remote generation service is temporarily unavailable. Please try again shortly.", code: "REMOTE_GENERATION_UNAVAILABLE" });
  }
});

router.post("/pricing", async (req, res, next) => {
  if (!requireEnabled(res)) return;
  try {
    const request = remoteGenerationRequestSchema.parse(req.body?.request ?? req.body);
    return res.json(await launchServerClient.price(request));
  } catch (error) {
    return respondRemoteGenerationError(error, res, "Generation pricing is temporarily unavailable. Please try again shortly.");
  }
});

router.get("/pricing-config", async (req, res) => {
  if (!requireEnabled(res)) return;
  try {
    return res.json(await launchServerClient.pricingConfig());
  } catch (error) {
    return respondRemoteGenerationError(error, res, "Generation pricing is temporarily unavailable. Please try again shortly.");
  }
});

router.post("/availability", async (req, res, next) => {
  if (!requireEnabled(res)) return;
  try {
    const request = z.object({
      priority: remoteGenerationPrioritySchema,
      runtime: z.enum(["ace-step", "voice-change", "rhythm-beats"]),
    }).parse({
      priority: req.body?.priority ?? "standard",
      runtime: req.body?.runtime ?? "ace-step",
    });
    return res.json(await launchServerClient.availability(request));
  } catch (error) {
    return respondRemoteGenerationError(error, res, "The generation service is temporarily unavailable. Please try again shortly.");
  }
});

router.use(requireAuth);

router.get("/assets/chart", async (req, res) => {
  if (!requireEnabled(res)) return;
  const objectPath = typeof req.query.path === "string" ? req.query.path.trim() : "";
  if (!isRemoteGenerationObjectPath(objectPath)) {
    res.status(400).json({ error: "Invalid remote chart asset path" });
    return;
  }

  try {
    const asset = await downloadFromBunny(objectPath);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(asset.buffer);
  } catch (error) {
    console.error("[remote-generation] chart asset proxy failed", { objectPath, error });
    res.status(404).json({ error: "Remote chart asset not found" });
  }
});

router.post("/sources", sourceUpload.single("file"), async (req, res, next) => {
  if (!requireEnabled(res)) return;
  try {
    if (!req.file) return res.status(400).json({ error: "Choose an audio file first" });
    if (!isSupportedAudioUpload(req.file)) {
      console.warn("[remote-generation] rejected source upload", {
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        extension: path.extname(req.file.originalname || "").toLowerCase(),
      });
      return res.status(400).json({ error: "Only supported audio files can be uploaded" });
    }

    const sourceId = createId();
    const originalName = safeSourceFileName(req.file.originalname || "source-audio");
    const extension = path.extname(originalName);
    const baseName = safeSourceFileName(path.basename(originalName, extension));
    const objectPath = buildObjectPath([
      "remote-generation",
      "sources",
      req.session!.userId,
      `${sourceId}-${baseName}${extension}`,
    ]);
    const uploadResult = await uploadBufferToBunny({
      buffer: req.file.buffer,
      objectPath,
      contentType: req.file.mimetype,
    });

    return res.status(201).json({
      input: {
        role: "source",
        sourceUrl: uploadResult.publicUrl,
        mimeType: req.file.mimetype,
        fileName: req.file.originalname || originalName,
        sha256: crypto.createHash("sha256").update(req.file.buffer).digest("hex"),
        sizeBytes: req.file.size,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/payment-intents", async (req, res, next) => {
  if (!requireEnabled(res)) return;
  try {
    const request = remoteGenerationRequestSchema.parse(req.body?.request ?? req.body);
    const intent = await launchServerClient.createPaymentIntent({
      userId: req.session!.userId,
      walletAddress: req.session!.publicKey,
      request,
    });
    return res.status(201).json(intent);
  } catch (error) {
    return respondRemoteGenerationError(error, res, "The generation service is temporarily unavailable. Please try again shortly.");
  }
});

router.post("/payment-intents/:id/verify", async (req, res, next) => {
  if (!requireEnabled(res)) return;
  try {
    const parsed = verifyPaymentRequestSchema.parse(req.body);
    const intent = await launchServerClient.verifyPayment({
      paymentIntentId: req.params.id,
      userId: req.session!.userId,
      transactionSignature: parsed.transactionSignature,
    });
    return res.json(intent);
  } catch (error) {
    return respondRemoteGenerationError(error, res, "Payment verification could not be completed. Please try again shortly.");
  }
});

router.get("/payment-intents/:id", async (req, res, next) => {
  if (!requireEnabled(res)) return;
  try {
    const intent = await launchServerClient.getPaymentIntent({ paymentIntentId: req.params.id, userId: req.session!.userId });
    if (intent.userId !== req.session!.userId) return res.status(404).json({ error: "Payment intent not found" });
    return res.json(intent);
  } catch (error) {
    return respondRemoteGenerationError(error, res, "Payment status is temporarily unavailable. Please try again shortly.");
  }
});

router.post("/jobs", async (req, res, next) => {
  if (!requireEnabled(res)) return;
  try {
    const parsed = createJobRequestSchema.parse(req.body);
    const job = await launchServerClient.createJob({
      userId: req.session!.userId,
      paymentIntentId: parsed.paymentIntentId,
      request: parsed.request,
    });
    return res.status(201).json(job);
  } catch (error) {
    return respondRemoteGenerationError(error, res, "Your generation could not be queued. Please try again shortly.");
  }
});

router.get("/jobs/:id", async (req, res, next) => {
  if (!requireEnabled(res)) return;
  try {
    const job = await launchServerClient.getJob(req.params.id);
    if (job.userId !== req.session!.userId) return res.status(404).json({ error: "Remote job not found" });
    return res.json(job);
  } catch (error) {
    return respondRemoteGenerationError(error, res, "Generation status is temporarily unavailable. Please try again shortly.");
  }
});

router.get("/jobs", async (req, res, next) => {
  if (!requireEnabled(res)) return;
  try {
    const limitValue = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(limitValue) ? Math.min(Math.max(Math.trunc(limitValue), 1), 50) : 50;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const activeOnly = req.query.active === "true";
    const runtime = typeof req.query.runtime === "string" ? req.query.runtime : undefined;
    const knownJobIds = typeof req.query.knownIds === "string"
      ? [...new Set(req.query.knownIds.split(",").map((id) => id.trim()).filter(Boolean))].slice(0, 100)
      : undefined;
    return res.json(await launchServerClient.listJobs(req.session!.userId, { limit, cursor, activeOnly, knownJobIds, runtime: runtime as "ace-step" | "voice-change" | "rhythm-beats" | undefined }));
  } catch (error) {
    return respondRemoteGenerationError(error, res, "Generation history is temporarily unavailable. Please try again shortly.");
  }
});

router.post("/jobs/:id/reward-submission", async (req, res, next) => {
  if (!requireEnabled(res)) return;
  try {
    const parsed = createRewardSubmissionRequestSchema.parse(req.body);
    return res.status(201).json(await launchServerClient.createRewardSubmission({
      userId: req.session!.userId,
      jobId: req.params.id,
      postLink: parsed.postLink,
    }));
  } catch (error) {
    return respondRemoteGenerationError(error, res, "This generation could not be submitted for reward. Please try again.");
  }
});

router.get("/reward-submissions", async (req, res, next) => {
  if (!requireEnabled(res)) return;
  try {
    const limitValue = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(limitValue) ? Math.min(Math.max(Math.trunc(limitValue), 1), 100) : 50;
    return res.json(await launchServerClient.listRewardSubmissions(req.session!.userId, limit));
  } catch (error) {
    return respondRemoteGenerationError(error, res, "Reward submissions are temporarily unavailable. Please try again shortly.");
  }
});

router.post("/reward-submissions/:id/appeal", async (req, res, next) => {
  if (!requireEnabled(res)) return;
  try {
    const parsed = appealRewardSubmissionRequestSchema.parse(req.body);
    return res.json(await launchServerClient.appealRewardSubmission({
      userId: req.session!.userId,
      id: req.params.id,
      postLink: parsed.postLink,
    }));
  } catch (error) {
    return respondRemoteGenerationError(error, res, "This reward submission could not be appealed. Please try again.");
  }
});

export const remoteGenerationRouter = router;

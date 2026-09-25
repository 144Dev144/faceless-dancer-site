import crypto from "node:crypto";
import path from "node:path";
import multer from "multer";
import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth.js";
import { env } from "../../config/env.js";
import { createId } from "../../utils/crypto.js";
import { buildObjectPath, downloadFromBunny, uploadBufferToBunny } from "../storage/bunnyStorage.js";
import { LaunchServerRequestError, launchServerClient, type RemoteJob } from "./client.js";
import { appealRewardSubmissionRequestSchema, createJobRequestSchema, createRewardSubmissionRequestSchema, createVideoChainRequestSchema, remoteGenerationPrioritySchema, remoteGenerationRequestSchema, verifyPaymentRequestSchema } from "./schemas.js";
import { createVideoChain, type VideoChainParent } from "./videoChainService.js";
import { findRemoteVideoAssetByJob, findRemoteVideoChainById, listRemoteVideoAssets, updateRemoteVideoChainMetadata, upsertRemoteVideoChainAsset, upsertRemoteVideoGenerationAsset, type StoredRemoteVideoAsset } from "./videoAssetStore.js";

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
const supportedVideoMimeAliases = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/ogg"]);
const supportedVideoExtensions = new Set([".mp4", ".webm", ".mov", ".m4v", ".mkv", ".avi"]);
const supportedImageMimeAliases = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const supportedImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const browserFallbackMimeTypes = new Set(["", "application/octet-stream", "binary/octet-stream"]);
const avatarSourceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.libraryMaxUploadSizeBytes },
});
const avatarSourceRoles = new Set(["mesh", "manifest", "reference-image"]);
const avatarSourceExtensions = new Set([".glb", ".gltf", ".json", ".png", ".jpg", ".jpeg", ".webp"]);

function isSupportedAudioUpload(file: Express.Multer.File): boolean {
  const mimeType = String(file.mimetype || "").trim().toLowerCase();
  if (supportedAudioMimeAliases.has(mimeType)) return true;

  const extension = path.extname(file.originalname || "").toLowerCase();
  return browserFallbackMimeTypes.has(mimeType) && supportedAudioExtensions.has(extension);
}

function isSupportedSourceUpload(file: Express.Multer.File): boolean {
  if (isSupportedAudioUpload(file)) return true;
  const mimeType = String(file.mimetype || "").trim().toLowerCase();
  const extension = path.extname(file.originalname || "").toLowerCase();
  if (supportedVideoMimeAliases.has(mimeType) || (browserFallbackMimeTypes.has(mimeType) && supportedVideoExtensions.has(extension))) return true;
  return supportedImageMimeAliases.has(mimeType) || (browserFallbackMimeTypes.has(mimeType) && supportedImageExtensions.has(extension));
}

function safeSourceFileName(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return clean.slice(0, 120) || "source-audio";
}

function isSupportedAvatarSource(file: Express.Multer.File, role: string): boolean {
  if (!avatarSourceRoles.has(role)) return false;
  const extension = path.extname(file.originalname || "").toLowerCase();
  if (!avatarSourceExtensions.has(extension)) return false;
  if (role === "mesh") return extension === ".glb" || extension === ".gltf";
  if (role === "manifest") return extension === ".json";
  return [".png", ".jpg", ".jpeg", ".webp"].includes(extension);
}

function isRemoteGenerationObjectPath(objectPath: string): boolean {
  return /^remote-generation(?:-[A-Za-z0-9-]+)?\/(?:jobs\/[A-Za-z0-9-]+|chains\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+)\/[^/]+(?:\/[^/]+)*$/.test(objectPath)
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

function completedLtxVideoArtifact(job: RemoteJob) {
  if (job.status !== "succeeded") return undefined;
  return job.artifacts.find((artifact) => artifact.role === "preview" && artifact.mimeType.startsWith("video/"))
    ?? job.artifacts.find((artifact) => artifact.mimeType.startsWith("video/"));
}

function ltxLineageParent(job: RemoteJob): VideoChainParent | undefined {
  const rawLineage = job.request.metadata?.videoLineage ?? job.request.parameters.video_lineage;
  if (!rawLineage || typeof rawLineage !== "object" || Array.isArray(rawLineage)) return undefined;
  const lineage = rawLineage as Record<string, unknown>;
  if (lineage.kind !== "create-from-frame" || !lineage.parent || typeof lineage.parent !== "object" || Array.isArray(lineage.parent)) return undefined;
  const rawParent = lineage.parent as Record<string, unknown>;
  if (rawParent.sourceType !== "job" && rawParent.sourceType !== "chain") return undefined;
  if (typeof rawParent.sourceArtifactObjectPath !== "string" || typeof rawParent.frameIndex !== "number" || typeof rawParent.timeSeconds !== "number" || typeof rawParent.frameRate !== "number") return undefined;
  return {
    sourceType: rawParent.sourceType,
    sourceJobId: typeof rawParent.sourceJobId === "string" ? rawParent.sourceJobId : undefined,
    sourceChainId: typeof rawParent.sourceChainId === "string" ? rawParent.sourceChainId : undefined,
    sourceArtifactObjectPath: rawParent.sourceArtifactObjectPath,
    sourceArtifactId: typeof rawParent.sourceArtifactId === "string" ? rawParent.sourceArtifactId : undefined,
    sourceUrl: typeof rawParent.sourceUrl === "string" ? rawParent.sourceUrl : undefined,
    frameIndex: rawParent.frameIndex,
    timeSeconds: rawParent.timeSeconds,
    frameRate: rawParent.frameRate,
  };
}

function ltxTemporalPrefix(job: RemoteJob): { conditioningPrefixFrames: number } | undefined {
  const raw = job.request.parameters.temporal_prefix ?? job.request.parameters.temporalPrefix;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const prefix = raw as Record<string, unknown>;
  const rawFrameCount = prefix.frame_count ?? prefix.frameCount;
  if (typeof rawFrameCount !== "number" || !Number.isInteger(rawFrameCount) || rawFrameCount < 1) return undefined;
  return { conditioningPrefixFrames: rawFrameCount };
}

function chainResponseFromStoredAsset(asset: StoredRemoteVideoAsset) {
  const metadata = asset.metadata;
  return {
    chainId: asset.chainId!,
    title: asset.title,
    objectPath: asset.objectPath,
    publicUrl: asset.publicUrl,
    proxyUrl: asset.proxyUrl ?? `/api/remote-generation/assets/file?path=${encodeURIComponent(asset.objectPath)}`,
    manifestObjectPath: asset.manifestObjectPath!,
    manifestPublicUrl: asset.manifestPublicUrl!,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    sha256: asset.sha256,
    durationSeconds: asset.durationSeconds ?? 0,
    frameRate: asset.frameRate ?? 0,
    audioPreserved: metadata.audioPreserved === true,
    segments: Array.isArray(metadata.segments) ? metadata.segments : [],
  };
}

async function persistCompletedLtxJob(userId: string, job: RemoteJob): Promise<StoredRemoteVideoAsset | null> {
  const artifact = completedLtxVideoArtifact(job);
  if (!artifact) return null;

  const lineage = job.request.metadata?.videoLineage ?? job.request.parameters.video_lineage;
  const duration = typeof job.request.parameters.duration_seconds === "number" ? job.request.parameters.duration_seconds : undefined;
  const frameRate = typeof job.request.parameters.frame_rate === "number" ? job.request.parameters.frame_rate : undefined;
  const rawAsset = await upsertRemoteVideoGenerationAsset({
    ownerUserId: userId,
    job,
    artifact,
    title: typeof job.request.metadata?.title === "string" ? job.request.metadata.title : `Video ${job.id.slice(0, 8)}`,
    durationSeconds: duration,
    frameRate,
    lineage: lineage && typeof lineage === "object" && !Array.isArray(lineage) ? lineage as Record<string, unknown> : undefined,
  });

  const parent = ltxLineageParent(job);
  const prefix = ltxTemporalPrefix(job);
  if (!parent || !prefix || prefix.conditioningPrefixFrames < 1) return rawAsset;
  const existingChain = await findRemoteVideoAssetByJob({ ownerUserId: userId, jobId: job.id, assetKind: "video_chain" });
  if (existingChain) {
    const continuationVideo = {
      objectPath: artifact.objectPath,
      publicUrl: artifact.publicUrl,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
    };
    await updateRemoteVideoChainMetadata({
      ownerUserId: userId,
      appendJobId: job.id,
      prompt: typeof job.request.parameters.prompt === "string" ? job.request.parameters.prompt : undefined,
      continuationVideo,
    });
    return rawAsset;
  }

  if (parent.sourceType === "job") {
    const sourceJob = await launchServerClient.getJob(parent.sourceJobId!);
    if (sourceJob.userId !== userId) throw new Error("The video lineage source belongs to another user.");
    const sourceArtifact = sourceJob.artifacts.find((candidate) => candidate.objectPath === parent.sourceArtifactObjectPath && candidate.mimeType.startsWith("video/"));
    if (!sourceArtifact) throw new Error("The video lineage source artifact is no longer available.");
  } else {
    const sourceChain = await findRemoteVideoChainById({ ownerUserId: userId, chainId: parent.sourceChainId! });
    if (!sourceChain || sourceChain.objectPath !== parent.sourceArtifactObjectPath) throw new Error("The video lineage source chain is no longer available.");
  }

  const chain = await createVideoChain({
    userId,
    title: `${rawAsset.title} chain`,
    frameRate: parent.frameRate,
    parent,
    append: {
      jobId: job.id,
      artifactObjectPath: artifact.objectPath,
      artifactId: artifact.id,
      conditioningPrefixFrames: prefix.conditioningPrefixFrames,
    },
  });
  await upsertRemoteVideoChainAsset({
    ownerUserId: userId,
    appendJobId: job.id,
    title: chain.title,
    prompt: typeof job.request.parameters.prompt === "string" ? job.request.parameters.prompt : undefined,
    continuationVideo: {
      objectPath: artifact.objectPath,
      publicUrl: artifact.publicUrl,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
    },
    parent,
    chain,
  });
  return rawAsset;
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
      runtime: z.enum(["ace-step", "voice-change", "rhythm-beats", "avatar", "flux-image", "wan-animate", "ltx-video", "mulacover"]),
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

router.get("/assets/file", async (req, res) => {
  if (!requireEnabled(res)) return;
  const objectPath = typeof req.query.path === "string" ? req.query.path.trim() : "";
  if (!isRemoteGenerationObjectPath(objectPath)) {
    res.status(400).json({ error: "Invalid remote generation asset path" });
    return;
  }

  try {
    const asset = await downloadFromBunny(objectPath);
    res.setHeader("Content-Type", asset.contentType || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(asset.buffer);
  } catch (error) {
    console.error("[remote-generation] asset proxy failed", { objectPath, error });
    res.status(404).json({ error: "Remote generation asset not found" });
  }
});

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
    if (!req.file) return res.status(400).json({ error: "Choose an audio, video, or image file first" });
    if (!isSupportedSourceUpload(req.file)) {
      console.warn("[remote-generation] rejected source upload", {
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        extension: path.extname(req.file.originalname || "").toLowerCase(),
      });
      return res.status(400).json({ error: "Only supported audio, video, and image files can be uploaded" });
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
        role: req.file.mimetype.toLowerCase().startsWith("video/") || supportedVideoExtensions.has(extension) ? "driver" : "source",
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

router.post("/avatar-sources", avatarSourceUpload.single("file"), async (req, res, next) => {
  if (!requireEnabled(res)) return;
  try {
    const role = typeof req.body?.role === "string" ? req.body.role.trim() : "";
    if (!req.file) return res.status(400).json({ error: "Choose an avatar file first" });
    if (!isSupportedAvatarSource(req.file, role)) {
      return res.status(400).json({ error: "Avatar uploads must be a GLB/GLTF mesh, JSON manifest, or reference image." });
    }
    const sourceId = createId();
    const originalName = safeSourceFileName(req.file.originalname || `avatar-${role}`);
    const extension = path.extname(originalName);
    const objectPath = buildObjectPath(["remote-generation", "avatar-sources", req.session!.userId, `${sourceId}-${originalName}`]);
    const uploadResult = await uploadBufferToBunny({ buffer: req.file.buffer, objectPath, contentType: req.file.mimetype || "application/octet-stream" });
    return res.status(201).json({ input: {
      role,
      sourceUrl: uploadResult.publicUrl,
      mimeType: req.file.mimetype || (extension === ".json" ? "application/json" : "application/octet-stream"),
      fileName: req.file.originalname || originalName,
      sha256: crypto.createHash("sha256").update(req.file.buffer).digest("hex"),
      sizeBytes: req.file.size,
    } });
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

router.post("/video-chains", async (req, res, next) => {
  if (!requireEnabled(res)) return;
  try {
    const parsed = createVideoChainRequestSchema.parse(req.body);
    const parent = parsed.parent;
    if (parent.sourceType === "job") {
      const sourceJob = await launchServerClient.getJob(parent.sourceJobId!);
      if (sourceJob.userId !== req.session!.userId) return res.status(404).json({ error: "Source video not found" });
      const sourceArtifact = sourceJob.artifacts.find((artifact) => artifact.objectPath === parent.sourceArtifactObjectPath && artifact.mimeType.startsWith("video/"));
      if (!sourceArtifact) return res.status(404).json({ error: "Source video artifact not found" });
    } else if (!isRemoteGenerationObjectPath(parent.sourceArtifactObjectPath)
      || !parent.sourceArtifactObjectPath.startsWith(`remote-generation/chains/${req.session!.userId}/${parent.sourceChainId}/`)) {
      return res.status(404).json({ error: "Source video chain not found" });
    }

    const appendJob = await launchServerClient.getJob(parsed.append.jobId);
    if (appendJob.userId !== req.session!.userId) return res.status(404).json({ error: "Appended video not found" });
    const appendArtifact = appendJob.artifacts.find((artifact) => artifact.objectPath === parsed.append.artifactObjectPath && artifact.mimeType.startsWith("video/"));
    if (!appendArtifact) return res.status(404).json({ error: "Appended video artifact not found" });

    const existingChain = await findRemoteVideoAssetByJob({ ownerUserId: req.session!.userId, jobId: appendJob.id, assetKind: "video_chain" });
    if (existingChain) return res.status(200).json(chainResponseFromStoredAsset(existingChain));

    const appendParameters = appendJob.request.parameters as Record<string, unknown>;
    const rawLineage = appendJob.request.metadata?.videoLineage ?? appendParameters.video_lineage;
    if (!rawLineage || typeof rawLineage !== "object" || Array.isArray(rawLineage)) {
      return res.status(422).json({ error: "The appended video job has no video lineage; the source video was not submitted for temporal continuation." });
    }
    const canonicalParent = ltxLineageParent(appendJob);
    if (!canonicalParent
      || canonicalParent.sourceType !== parent.sourceType
      || canonicalParent.sourceJobId !== parent.sourceJobId
      || canonicalParent.sourceChainId !== parent.sourceChainId
      || canonicalParent.sourceArtifactObjectPath !== parent.sourceArtifactObjectPath
      || canonicalParent.frameIndex !== parent.frameIndex) {
      return res.status(422).json({ error: "The appended video job lineage does not match the requested source frame." });
    }
    const temporalPrefixValue = appendParameters.temporal_prefix ?? appendParameters.temporalPrefix;
    if (!temporalPrefixValue || typeof temporalPrefixValue !== "object" || Array.isArray(temporalPrefixValue)) {
      return res.status(422).json({ error: "The appended video job has no temporal prefix; the source video was not submitted to the worker." });
    }
    const temporalPrefix = temporalPrefixValue as Record<string, unknown>;
    const rawOverlapFrames = temporalPrefix?.frame_count ?? temporalPrefix?.frameCount;
    const conditioningPrefixFrames = typeof rawOverlapFrames === "number" && Number.isInteger(rawOverlapFrames) && rawOverlapFrames > 0
      ? rawOverlapFrames
      : 0;
    if (conditioningPrefixFrames < 1) {
      return res.status(422).json({ error: "The appended video job contains an invalid temporal-prefix frame count." });
    }

    const rawAsset = await upsertRemoteVideoGenerationAsset({
      ownerUserId: req.session!.userId,
      job: appendJob,
      artifact: appendArtifact,
      title: typeof appendJob.request.metadata?.title === "string" ? appendJob.request.metadata.title : parsed.title.replace(/\s+chain$/i, ""),
      durationSeconds: typeof appendJob.request.parameters.duration_seconds === "number" ? appendJob.request.parameters.duration_seconds : undefined,
      frameRate: typeof appendJob.request.parameters.frame_rate === "number" ? appendJob.request.parameters.frame_rate : undefined,
      lineage: rawLineage as Record<string, unknown>,
    });
    const chain = await createVideoChain({
      userId: req.session!.userId,
      title: parsed.title || `${rawAsset.title} chain`,
      frameRate: parsed.frameRate,
      parent: canonicalParent,
      append: { ...parsed.append, conditioningPrefixFrames },
    });
    await upsertRemoteVideoChainAsset({
      ownerUserId: req.session!.userId,
      appendJobId: appendJob.id,
      title: chain.title,
      prompt: typeof appendJob.request.parameters.prompt === "string" ? appendJob.request.parameters.prompt : undefined,
      continuationVideo: {
        objectPath: appendArtifact.objectPath,
        publicUrl: appendArtifact.publicUrl,
        mimeType: appendArtifact.mimeType,
        sizeBytes: appendArtifact.sizeBytes,
        sha256: appendArtifact.sha256,
      },
      parent: canonicalParent,
      chain,
    });
    return res.status(201).json(chain);
  } catch (error) {
    return next(error);
  }
});

router.get("/video-assets", async (req, res, next) => {
  if (!requireEnabled(res)) return;
  try {
    const page = await launchServerClient.listJobs(req.session!.userId, { limit: 50, runtime: "ltx-video" });
    const completedJobs = page.jobs
      .filter((job) => job.status === "succeeded")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    for (const job of completedJobs) {
      try {
        await persistCompletedLtxJob(req.session!.userId, job);
      } catch (error) {
        console.error("[remote-generation] persisted video asset recovery failed", { jobId: job.id, error });
      }
    }
    return res.json({ assets: await listRemoteVideoAssets(req.session!.userId) });
  } catch (error) {
    return next(error);
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
    return res.json(await launchServerClient.listJobs(req.session!.userId, { limit, cursor, activeOnly, knownJobIds, runtime: runtime as "ace-step" | "voice-change" | "rhythm-beats" | "avatar" | "flux-image" | "wan-animate" | "ltx-video" | "mulacover" | undefined }));
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

import type { DanceMotionSourceMetadata } from "@faceless/shared";
import {
  buildCanonicalJointPoints,
  buildCanonicalMotionClip,
  canonicalScaleForPoints,
  normalizeCanonicalPoints,
  type Point3,
  type RawPoseFrame,
  type RawPoseSequence
} from "./canonicalMotion";
import { createWireframeCamera, drawWireframe } from "./wireframe";
import { mediaPipeDepthToCanonical } from "./motionCoordinates";
import {
  DEFAULT_POSE_CAPTURE_QUALITY,
  getPoseCaptureProfile,
  POSE_CAPTURE_FALLBACK_QUALITY,
  type PoseCaptureQuality,
  type PoseCaptureProfile
} from "./poseCaptureConfig";
import { filterRawPoseSequence } from "./poseTemporalFilter";
import { resolvePoseDepth } from "./poseDepthResolver";

const MEDIAPIPE_VERSION = "0.10.35";
const MEDIAPIPE_WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
export const CAPTURE_FRAME_RATE = 30;

export interface PoseProcessingResult {
  rawPose: RawPoseSequence;
  filteredPose: RawPoseSequence;
  depthResolvedPose: RawPoseSequence;
  canonicalMotion: ReturnType<typeof buildCanonicalMotionClip>["clip"];
  diagnostics: Record<string, unknown>;
  wireframeVideo: Blob | null;
}

export interface PoseProcessingCallbacks {
  onProgress: (progress: number, stage: string) => void;
}

export interface PoseProcessingOptions {
  quality?: PoseCaptureQuality;
}

function waitForSeek(video: HTMLVideoElement, time: number): Promise<void> {
  if (video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.001) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("The video could not be decoded.")); };
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = time;
  });
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 1 && Number.isFinite(video.duration)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onLoaded = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("The video metadata could not be read.")); };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("loadedmetadata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function recorderMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
    .find((value) => MediaRecorder.isTypeSupported(value)) ?? null;
}

function finishRecorder(recorder: MediaRecorder | null, chunks: Blob[]): Promise<Blob | null> {
  if (!recorder) return Promise.resolve(null);
  return new Promise((resolve) => {
    recorder.addEventListener("stop", () => resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType || "video/webm" }) : null), { once: true });
    recorder.stop();
  });
}

function evenDimension(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function setWireframeCanvasSize(canvas: HTMLCanvasElement, width: number, height: number): void {
  canvas.width = evenDimension(width);
  canvas.height = evenDimension(height);
}

function setSourcePreviewCanvasSize(canvas: HTMLCanvasElement, video: HTMLVideoElement): void {
  const sourceWidth = Math.max(2, Math.round(video.videoWidth || 960));
  const sourceHeight = Math.max(2, Math.round(video.videoHeight || 540));
  const scale = Math.min(1, 960 / Math.max(sourceWidth, sourceHeight));
  setWireframeCanvasSize(canvas, sourceWidth * scale, sourceHeight * scale);
}

interface MediaPipeLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
}

interface MediaPipePoseResult {
  landmarks?: Array<MediaPipeLandmark[]>;
  worldLandmarks?: Array<MediaPipeLandmark[]>;
}

function frameLandmarks(result: MediaPipePoseResult): RawPoseFrame["landmarks"] {
  const landmarks = result.worldLandmarks?.[0] ?? [];
  return landmarks.map((landmark) => ({
    x: Number(landmark.x),
    y: Number(landmark.y),
    z: Number(landmark.z),
    visibility: Number(landmark.visibility ?? 0),
    ...(Number.isFinite(landmark.presence) ? { presence: Number(landmark.presence) } : {})
  }));
}

function normalizedLandmark(result: MediaPipePoseResult, index: number): Point3 | null {
  const landmark = result.landmarks?.[0]?.[index];
  if (!landmark || ![landmark.x, landmark.y, landmark.z].every(Number.isFinite)) return null;
  return [landmark.x, landmark.y, landmark.z];
}

function worldLandmark(result: MediaPipePoseResult, index: number): Point3 | null {
  const landmark = result.worldLandmarks?.[0]?.[index];
  if (!landmark || ![landmark.x, landmark.y, landmark.z].every(Number.isFinite)) return null;
  return [landmark.x, landmark.y, landmark.z];
}

function midpoint3(first: Point3, second: Point3): Point3 {
  return [
    (first[0] + second[0]) / 2,
    (first[1] + second[1]) / 2,
    (first[2] + second[2]) / 2
  ];
}

function distance3(first: Point3, second: Point3, includeDepth = true): number {
  const depth = includeDepth ? first[2] - second[2] : 0;
  return Math.hypot(first[0] - second[0], first[1] - second[1], depth);
}

function hipCenter(result: MediaPipePoseResult): Point3 | null {
  const left = normalizedLandmark(result, 23);
  const right = normalizedLandmark(result, 24);
  return left && right ? midpoint3(left, right) : null;
}

function imageToWorldScale(result: MediaPipePoseResult): number | null {
  const imageHips = hipCenter(result);
  const imageLeftShoulder = normalizedLandmark(result, 11);
  const imageRightShoulder = normalizedLandmark(result, 12);
  const worldLeftHip = worldLandmark(result, 23);
  const worldRightHip = worldLandmark(result, 24);
  const worldLeftShoulder = worldLandmark(result, 11);
  const worldRightShoulder = worldLandmark(result, 12);
  if (!imageHips || !imageLeftShoulder || !imageRightShoulder || !worldLeftHip || !worldRightHip || !worldLeftShoulder || !worldRightShoulder) return null;
  const imageShoulders = midpoint3(imageLeftShoulder, imageRightShoulder);
  const worldHips = midpoint3(worldLeftHip, worldRightHip);
  const worldShoulders = midpoint3(worldLeftShoulder, worldRightShoulder);
  const imageBodyLength = distance3(imageHips, imageShoulders, false);
  const worldBodyLength = distance3(worldHips, worldShoulders);
  if (imageBodyLength < 0.01 || worldBodyLength < 0.01) return null;
  return Math.max(0.1, Math.min(5, worldBodyLength / imageBodyLength));
}

function rootPositionFromInitialHip(
  currentHip: Point3 | null,
  initialHip: Point3 | null,
  imageToWorld: number
): Point3 {
  if (!currentHip || !initialHip || !Number.isFinite(imageToWorld) || imageToWorld <= 0) return [0, 0, 0];
  return [
    -(currentHip[0] - initialHip[0]) * imageToWorld,
    -(currentHip[1] - initialHip[1]) * imageToWorld,
    mediaPipeDepthToCanonical(currentHip[2] - initialHip[2]) * imageToWorld
  ];
}

async function createLandmarker(requestedQuality: PoseCaptureQuality) {
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
  const requestedProfile = getPoseCaptureProfile(requestedQuality);
  const profiles = requestedProfile.quality === POSE_CAPTURE_FALLBACK_QUALITY
    ? [requestedProfile]
    : [requestedProfile, getPoseCaptureProfile(POSE_CAPTURE_FALLBACK_QUALITY)];
  let lastError: unknown;
  for (let index = 0; index < profiles.length; index += 1) {
    const profile: PoseCaptureProfile = profiles[index];
    const options = {
      runningMode: "VIDEO" as const,
      numPoses: 1,
      minPoseDetectionConfidence: profile.minPoseDetectionConfidence,
      minPosePresenceConfidence: profile.minPosePresenceConfidence,
      minTrackingConfidence: profile.minTrackingConfidence
    };
    try {
      try {
        return {
          landmarker: await vision.PoseLandmarker.createFromOptions(fileset, {
            ...options,
            baseOptions: { modelAssetPath: profile.modelAssetPath, delegate: "GPU" }
          }),
          profile,
          fallbackUsed: index > 0
        };
      } catch (gpuError) {
        lastError = gpuError;
        return {
          landmarker: await vision.PoseLandmarker.createFromOptions(fileset, {
            ...options,
            baseOptions: { modelAssetPath: profile.modelAssetPath, delegate: "CPU" }
          }),
          profile,
          fallbackUsed: index > 0
        };
      }
    } catch (error) {
      lastError = error;
      console.warn(`[dance-motion] ${profile.label} pose model failed; trying fallback`, error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The pose model could not be loaded.");
}

export async function processDanceVideo(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  source: { fileName: string; mimeType: string },
  callbacks: PoseProcessingCallbacks,
  options: PoseProcessingOptions = {}
): Promise<PoseProcessingResult> {
  await waitForMetadata(video);
  callbacks.onProgress(3, "Loading the pose model");
  const requestedQuality = options.quality ?? DEFAULT_POSE_CAPTURE_QUALITY;
  const captureModel = await createLandmarker(requestedQuality);
  const landmarker = captureModel.landmarker;
  const durationSeconds = Math.max(0.01, Number(video.duration));
  const frameRate = CAPTURE_FRAME_RATE;
  const frameCount = Math.max(1, Math.ceil(durationSeconds * frameRate));
  const rawFrames: RawPoseFrame[] = [];
  setSourcePreviewCanvasSize(canvas, video);
  let previousPoints: Record<string, [number, number, number]> | null = null;
  let initialHip: Point3 | null = null;
  let imageToWorld = 0;
  let previewRootStart: Point3 | null = null;
  let previewScaleFactor = 1;
  for (let index = 0; index < frameCount; index += 1) {
    const timestampSeconds = Math.min(durationSeconds, index / frameRate);
    await waitForSeek(video, timestampSeconds);
    const result = landmarker.detectForVideo(video, Math.round(timestampSeconds * 1000));
    const landmarks = frameLandmarks(result);
    const currentHip = hipCenter(result);
    if (!initialHip && currentHip) initialHip = currentHip;
    if (!imageToWorld) imageToWorld = imageToWorldScale(result) ?? 0;
    const frame: RawPoseFrame = {
      timestampSeconds,
      landmarks,
      rootPosition: rootPositionFromInitialHip(currentHip, initialHip, imageToWorld)
    };
    rawFrames.push(frame);
    const previewPoints = buildCanonicalJointPoints(frame);
    if (!previewRootStart) {
      previewRootStart = previewPoints.root ?? [0, 0, 0];
      previewScaleFactor = canonicalScaleForPoints(previewPoints);
    }
    previousPoints = normalizeCanonicalPoints(previewPoints, previewRootStart, previewScaleFactor) as Record<string, [number, number, number]>;
    drawWireframe(canvas, previousPoints, `POSE REVIEW  ${Math.round((timestampSeconds / durationSeconds) * 100)}%`);
    callbacks.onProgress(5 + Math.round(((index + 1) / frameCount) * 88), `Extracting pose ${index + 1}/${frameCount}`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(1, 1000 / frameRate)));
  }
  const rawPose: RawPoseSequence = {
    format: "faceless-raw-pose",
    version: 1,
    frameRate,
    durationSeconds,
    landmarkCount: 33,
    frames: rawFrames
  };
  const filteredResult = filterRawPoseSequence(rawPose);
  const filteredPose = filteredResult.pose;
  const depthResolvedResult = resolvePoseDepth(filteredPose);
  const depthResolvedPose = depthResolvedResult.pose;
  const sourceMetadata: DanceMotionSourceMetadata = {
    fileName: source.fileName,
    mimeType: source.mimeType,
    captureMethod: "video",
    estimator: `MediaPipe Pose Landmarker ${captureModel.profile.label}`,
    estimatorVersion: MEDIAPIPE_VERSION,
    processingVersion: "dance-motion-poc-6-capture-depth-resolved",
    createdAt: new Date().toISOString()
  };
  const { clip: canonicalMotion, pointsPerFrame } = buildCanonicalMotionClip({ raw: depthResolvedPose, sourceMetadata });
  const camera = createWireframeCamera(pointsPerFrame);
  setWireframeCanvasSize(canvas, camera.width, camera.height);
  const canvasStream = canvas.captureStream?.(CAPTURE_FRAME_RATE) ?? null;
  const chunks: Blob[] = [];
  const mimeType = recorderMimeType();
  const recorder = canvasStream && mimeType ? new MediaRecorder(canvasStream, { mimeType }) : null;
  recorder?.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
  recorder?.start(250);
  callbacks.onProgress(94, "Framing the complete captured motion");
  for (let index = 0; index < pointsPerFrame.length; index += 1) {
    const timestampSeconds = depthResolvedPose.frames[index]?.timestampSeconds ?? 0;
    drawWireframe(canvas, pointsPerFrame[index], `POSE REVIEW  ${Math.round((timestampSeconds / durationSeconds) * 100)}%`, camera);
    callbacks.onProgress(94 + Math.round(((index + 1) / Math.max(1, pointsPerFrame.length)) * 2), "Rendering the wireframe review");
    await new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(1, 1000 / frameRate)));
  }
  callbacks.onProgress(96, "Encoding the wireframe review video");
  const wireframeVideo = await finishRecorder(recorder, chunks);
  const validFrames = rawFrames.filter((frame) => frame.landmarks.length >= 25).length;
  const averageConfidence = rawFrames.reduce((sum, frame) => sum + frame.landmarks.reduce((inner, point) => inner + point.visibility, 0) / Math.max(1, frame.landmarks.length), 0) / Math.max(1, rawFrames.length);
  callbacks.onProgress(100, "Pose extraction complete");
  landmarker.close();
  return {
    rawPose,
    filteredPose,
    depthResolvedPose,
    canonicalMotion,
    diagnostics: {
      extractor: "MediaPipe Pose Landmarker",
      requestedModelQuality: requestedQuality,
      modelQuality: captureModel.profile.quality,
      modelLabel: captureModel.profile.label,
      modelAssetPath: captureModel.profile.modelAssetPath,
      modelFallbackUsed: captureModel.fallbackUsed,
      confidenceThresholds: {
        detection: captureModel.profile.minPoseDetectionConfidence,
        presence: captureModel.profile.minPosePresenceConfidence,
        tracking: captureModel.profile.minTrackingConfidence
      },
      temporalFilter: {
        name: "adaptive-confidence-velocity",
        filteredLandmarkCount: filteredResult.filteredLandmarkCount,
        heldLandmarkCount: filteredResult.heldLandmarkCount
      },
      depthResolver: {
        name: "arm-front-back-hysteresis",
        stateFrames: 8,
        ...depthResolvedResult.stats
      },
      frameRate,
      frameCount,
      durationSeconds,
      validFrameRatio: validFrames / Math.max(1, rawFrames.length),
      averageLandmarkConfidence: averageConfidence,
      rootMotion: {
        anchor: "initial-hip",
        source: "image-space-hip-tracking",
        imageToWorldScale: imageToWorld,
        trackedFrameRatio: rawFrames.filter((frame) => frame.rootPosition?.some((value) => value !== 0)).length / Math.max(1, rawFrames.length)
      },
      wireframeVideoGenerated: Boolean(wireframeVideo),
      skeletonId: canonicalMotion.skeletonId,
      canonicalSource: "depth-resolved-pose"
    },
    wireframeVideo
  };
}

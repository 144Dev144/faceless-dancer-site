import type { RawPoseFrame, RawPoseSequence, Point3 } from "./canonicalMotion";

const MIN_ALPHA = 0.14;
const MAX_ALPHA = 0.96;
const STABLE_ALPHA = 0.52;
const MAX_EXPECTED_SPEED_METERS_PER_SECOND = 1.4;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finitePoint(point: Point3 | undefined): point is Point3 {
  return Boolean(point && point.every(Number.isFinite));
}

function distance(first: Point3, second: Point3): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

function lerpPoint(first: Point3, second: Point3, amount: number): Point3 {
  return [
    first[0] + (second[0] - first[0]) * amount,
    first[1] + (second[1] - first[1]) * amount,
    first[2] + (second[2] - first[2]) * amount
  ];
}

function confidenceFor(frame: RawPoseFrame, index: number): number {
  const landmark = frame.landmarks[index];
  const visibility = Number(landmark?.visibility ?? 0);
  const presence = Number(landmark?.presence ?? visibility);
  return clamp(Math.min(visibility, presence), 0, 1);
}

function adaptiveAlpha(confidence: number, speedMetersPerSecond: number): number {
  // Confidence stabilizes uncertain joints, while velocity opens the filter
  // during fast gestures so intentional movement does not trail behind.
  const confidenceAlpha = MIN_ALPHA + (STABLE_ALPHA - MIN_ALPHA) * confidence;
  const velocityAlpha = clamp(speedMetersPerSecond / MAX_EXPECTED_SPEED_METERS_PER_SECOND, 0, 1) * 0.44;
  return clamp(confidenceAlpha + velocityAlpha, MIN_ALPHA, MAX_ALPHA);
}

function filterPoint(
  current: Point3 | undefined,
  previousRaw: Point3 | undefined,
  previousFiltered: Point3 | undefined,
  deltaSeconds: number,
  confidence: number
): Point3 | undefined {
  if (!finitePoint(current)) return previousFiltered ?? previousRaw;
  if (!finitePoint(previousFiltered)) return current;
  const speed = finitePoint(previousRaw) && deltaSeconds > 0
    ? distance(current, previousRaw) / deltaSeconds
    : 0;
  return lerpPoint(previousFiltered, current, adaptiveAlpha(confidence, speed));
}

function cloneFrame(frame: RawPoseFrame, landmarks: RawPoseFrame["landmarks"], rootPosition?: Point3): RawPoseFrame {
  return {
    timestampSeconds: frame.timestampSeconds,
    landmarks,
    ...(rootPosition ? { rootPosition } : {})
  };
}

export interface PoseTemporalFilterResult {
  pose: RawPoseSequence;
  filteredLandmarkCount: number;
  heldLandmarkCount: number;
}

export function filterRawPoseSequence(raw: RawPoseSequence): PoseTemporalFilterResult {
  let previousRawLandmarks: Point3[] = [];
  let previousFilteredLandmarks: Point3[] = [];
  let previousRawRoot: Point3 | undefined;
  let previousFilteredRoot: Point3 | undefined;
  let filteredLandmarkCount = 0;
  let heldLandmarkCount = 0;

  const frames = raw.frames.map((frame, frameIndex) => {
    const previousFrame = raw.frames[Math.max(0, frameIndex - 1)];
    const deltaSeconds = Math.max(1 / Math.max(1, raw.frameRate), frame.timestampSeconds - (previousFrame?.timestampSeconds ?? frame.timestampSeconds));
    const landmarks = frame.landmarks.map((landmark, index) => {
      const current: Point3 = [Number(landmark.x), Number(landmark.y), Number(landmark.z)];
      const filtered = filterPoint(current, previousRawLandmarks[index], previousFilteredLandmarks[index], deltaSeconds, confidenceFor(frame, index));
      const wasHeld = finitePoint(previousFilteredLandmarks[index]) && !finitePoint(current);
      if (filtered) filteredLandmarkCount += 1;
      if (wasHeld) heldLandmarkCount += 1;
      return {
        ...landmark,
        x: filtered?.[0] ?? landmark.x,
        y: filtered?.[1] ?? landmark.y,
        z: filtered?.[2] ?? landmark.z
      };
    });
    const root = frame.rootPosition
      ? filterPoint(frame.rootPosition, previousRawRoot, previousFilteredRoot, deltaSeconds, Math.min(confidenceFor(frame, 23), confidenceFor(frame, 24)))
      : undefined;
    const rawPoints = frame.landmarks.map((landmark) => [Number(landmark.x), Number(landmark.y), Number(landmark.z)] as Point3);
    const filteredPoints = landmarks.map((landmark) => [landmark.x, landmark.y, landmark.z] as Point3);
    previousRawLandmarks = rawPoints;
    previousFilteredLandmarks = filteredPoints;
    previousRawRoot = finitePoint(frame.rootPosition) ? frame.rootPosition : previousRawRoot;
    previousFilteredRoot = root ?? previousFilteredRoot;
    return cloneFrame(frame, landmarks, root);
  });

  return {
    pose: { ...raw, frames },
    filteredLandmarkCount,
    heldLandmarkCount
  };
}

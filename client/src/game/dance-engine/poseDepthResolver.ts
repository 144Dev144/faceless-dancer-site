import type { RawPoseFrame, RawPoseSequence } from "./canonicalMotion";

const ARM_LANDMARKS = {
  left: { elbow: 13, wrist: 15, hand: 19 },
  right: { elbow: 14, wrist: 16, hand: 20 }
} as const;

const TORSO_LANDMARKS = [11, 12, 23, 24] as const;
const DEPTH_STATE_FRAMES = 8;
const MIN_TORSO_SCALE = 0.2;
const MIN_DEPTH_MARGIN = 0.015;

type ArmSide = keyof typeof ARM_LANDMARKS;
type DepthSide = "front" | "behind";
type Point2 = [number, number];

export interface PoseDepthResolverStats {
  correctedLandmarkCount: number;
  heldDepthFrameCount: number;
  blockedFrontToBackFlips: number;
  blockedBackToFrontFlips: number;
  acceptedFrontToBackTransitions: number;
  acceptedBackToFrontTransitions: number;
}

export interface PoseDepthResolverResult {
  pose: RawPoseSequence;
  stats: PoseDepthResolverStats;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function distance2D(first: Point2, second: Point2): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

function distance3D(first: number[], second: number[]): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

function landmarkPoint(frame: RawPoseFrame, index: number): [number, number, number] | null {
  const point = frame.landmarks[index];
  if (!point || ![point.x, point.y, point.z].every(finite)) return null;
  return [point.x, point.y, point.z];
}

function torsoDepth(frame: RawPoseFrame): number | null {
  const points = TORSO_LANDMARKS.map((index) => landmarkPoint(frame, index));
  if (points.some((point) => !point)) return null;
  return points.reduce((sum, point) => sum + (point as [number, number, number])[2], 0) / points.length;
}

function torsoScale(frame: RawPoseFrame): number {
  const leftHip = landmarkPoint(frame, 23);
  const rightHip = landmarkPoint(frame, 24);
  const leftShoulder = landmarkPoint(frame, 11);
  const rightShoulder = landmarkPoint(frame, 12);
  if (!leftHip || !rightHip || !leftShoulder || !rightShoulder) return 1;
  const hips = [
    (leftHip[0] + rightHip[0]) / 2,
    (leftHip[1] + rightHip[1]) / 2,
    (leftHip[2] + rightHip[2]) / 2
  ];
  const shoulders = [
    (leftShoulder[0] + rightShoulder[0]) / 2,
    (leftShoulder[1] + rightShoulder[1]) / 2,
    (leftShoulder[2] + rightShoulder[2]) / 2
  ];
  return Math.max(MIN_TORSO_SCALE, distance3D(hips, shoulders));
}

function armDepthCandidate(frame: RawPoseFrame, side: ArmSide, torsoZ: number): number | null {
  const indices = ARM_LANDMARKS[side];
  const values = [indices.elbow, indices.wrist, indices.hand]
    .map((index) => landmarkPoint(frame, index)?.[2])
    .filter((value): value is number => typeof value === "number" && finite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length - torsoZ;
}

function armConfidence(frame: RawPoseFrame, side: ArmSide): number {
  const indices = ARM_LANDMARKS[side];
  return Math.min(...[indices.elbow, indices.wrist, indices.hand].map((index) => {
    const point = frame.landmarks[index];
    return Math.min(Number(point?.visibility ?? 0), Number(point?.presence ?? point?.visibility ?? 0));
  }));
}

function armImageMotion(previous: RawPoseFrame | undefined, current: RawPoseFrame, side: ArmSide): number {
  if (!previous) return 0;
  const indices = ARM_LANDMARKS[side];
  const motions = [indices.elbow, indices.wrist, indices.hand].flatMap((index) => {
    const before = previous.landmarks[index];
    const after = current.landmarks[index];
    if (!before || !after || ![before.x, before.y, after.x, after.y].every(finite)) return [];
    return [distance2D([before.x, before.y], [after.x, after.y])];
  });
  return motions.length ? motions.reduce((sum, value) => sum + value, 0) / motions.length : 0;
}

function initialDepthSide(candidates: Array<number | null>): DepthSide {
  const values = candidates.slice(0, DEPTH_STATE_FRAMES).filter((value): value is number => value !== null);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return average <= 0 ? "front" : "behind";
}

function sideForDepth(value: number): DepthSide {
  return value <= 0 ? "front" : "behind";
}

function applyArmDepthOffset(frame: RawPoseFrame, side: ArmSide, offset: number): number {
  const indices = ARM_LANDMARKS[side];
  let corrected = 0;
  for (const index of [indices.elbow, indices.wrist, indices.hand]) {
    const landmark = frame.landmarks[index];
    if (!landmark || !finite(landmark.z)) continue;
    landmark.z += offset;
    corrected += 1;
  }
  return corrected;
}

function resolveArmDepth(frames: RawPoseFrame[], side: ArmSide, stats: PoseDepthResolverStats): void {
  const candidates = frames.map((frame) => {
    const torsoZ = torsoDepth(frame);
    return torsoZ === null ? null : armDepthCandidate(frame, side, torsoZ);
  });
  let state = initialDepthSide(candidates);
  let pendingState: DepthSide | null = null;
  let pendingFrames = 0;
  let previousResolved: number | null = null;

  for (let index = 0; index < frames.length; index += 1) {
    const candidate = candidates[index];
    if (candidate === null) continue;
    const previousFrame = frames[index - 1];
    const visualMotion = armImageMotion(previousFrame, frames[index], side);
    const confidence = armConfidence(frames[index], side);
    const candidateState = sideForDepth(candidate);
    if (candidateState !== state) {
      if (pendingState === candidateState) pendingFrames += 1;
      else {
        pendingState = candidateState;
        pendingFrames = 1;
      }
      if (pendingFrames >= DEPTH_STATE_FRAMES) {
        if (state === "front") stats.acceptedFrontToBackTransitions += 1;
        else stats.acceptedBackToFrontTransitions += 1;
        state = candidateState;
        pendingState = null;
        pendingFrames = 0;
      } else if (state === "front") stats.blockedFrontToBackFlips += 1;
      else stats.blockedBackToFrontFlips += 1;
    } else {
      pendingState = null;
      pendingFrames = 0;
    }

    const scale = torsoScale(frames[index]);
    const maxStep = scale * (0.055 + Math.min(0.18, visualMotion * 0.85));
    const heldTarget = previousResolved === null ? candidate : previousResolved;
    let target = candidate;
    if (candidateState !== state && pendingFrames > 0) target = heldTarget;
    if (previousResolved !== null) target = clamp(target, previousResolved - maxStep, previousResolved + maxStep);

    const depthMargin = scale * MIN_DEPTH_MARGIN;
    if (state === "front") target = Math.min(target, -depthMargin);
    else target = Math.max(target, depthMargin);
    const offset = target - candidate;
    if (Math.abs(offset) > 0.0001) stats.correctedLandmarkCount += applyArmDepthOffset(frames[index], side, offset);
    if (candidateState !== state && pendingFrames > 0) stats.heldDepthFrameCount += 1;
    previousResolved = target;

    if (confidence < 0.35 && previousResolved !== null) {
      state = sideForDepth(previousResolved);
      pendingState = null;
      pendingFrames = 0;
    }
  }
}

export function resolvePoseDepth(raw: RawPoseSequence): PoseDepthResolverResult {
  const frames = raw.frames.map((frame) => ({
    ...frame,
    landmarks: frame.landmarks.map((landmark) => ({ ...landmark })),
    ...(frame.rootPosition ? { rootPosition: [...frame.rootPosition] as [number, number, number] } : {})
  }));
  const stats: PoseDepthResolverStats = {
    correctedLandmarkCount: 0,
    heldDepthFrameCount: 0,
    blockedFrontToBackFlips: 0,
    blockedBackToFrontFlips: 0,
    acceptedFrontToBackTransitions: 0,
    acceptedBackToFrontTransitions: 0
  };
  resolveArmDepth(frames, "left", stats);
  resolveArmDepth(frames, "right", stats);
  return { pose: { ...raw, frames }, stats };
}

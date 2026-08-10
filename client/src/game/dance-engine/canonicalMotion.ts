import type {
  DanceMotionClip,
  DanceMotionRegion,
  DanceMotionSourceMetadata,
  MotionSegment,
  SkeletonDefinition
} from "@faceless/shared";
import { CANONICAL_DEPTH_CONVENTION, mediaPipeDepthToCanonical } from "./motionCoordinates";

export interface RawPoseLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
  presence?: number;
}

export type Point3 = [number, number, number];

export interface RawPoseFrame {
  timestampSeconds: number;
  landmarks: RawPoseLandmark[];
  /** Environment-relative root displacement from the initial hip anchor. */
  rootPosition?: Point3;
}

export interface RawPoseSequence {
  format: "faceless-raw-pose";
  version: 1;
  frameRate: number;
  durationSeconds: number;
  landmarkCount: number;
  frames: RawPoseFrame[];
}

export const HUMANOID_SKELETON: SkeletonDefinition = {
  id: "humanoid-v1",
  version: 1,
  label: "Faceless humanoid base skeleton",
  coordinateSystem: "right-handed-y-up",
  joints: [
    { id: "root", parentId: null, region: "full-body" },
    { id: "hips", parentId: "root", region: "hips" },
    { id: "spine", parentId: "hips", region: "torso" },
    { id: "chest", parentId: "spine", region: "torso" },
    { id: "neck", parentId: "chest", region: "head" },
    { id: "head", parentId: "neck", region: "head" },
    { id: "leftShoulder", parentId: "chest", region: "left-arm" },
    { id: "leftArm", parentId: "leftShoulder", region: "left-arm" },
    { id: "leftForearm", parentId: "leftArm", region: "left-arm" },
    { id: "leftHand", parentId: "leftForearm", region: "hands", optional: true },
    { id: "rightShoulder", parentId: "chest", region: "right-arm" },
    { id: "rightArm", parentId: "rightShoulder", region: "right-arm" },
    { id: "rightForearm", parentId: "rightArm", region: "right-arm" },
    { id: "rightHand", parentId: "rightForearm", region: "hands", optional: true },
    { id: "leftUpperLeg", parentId: "hips", region: "lower-body" },
    { id: "leftLowerLeg", parentId: "leftUpperLeg", region: "lower-body" },
    { id: "leftFoot", parentId: "leftLowerLeg", region: "lower-body" },
    { id: "leftToe", parentId: "leftFoot", region: "lower-body", optional: true },
    { id: "rightUpperLeg", parentId: "hips", region: "lower-body" },
    { id: "rightLowerLeg", parentId: "rightUpperLeg", region: "lower-body" },
    { id: "rightFoot", parentId: "rightLowerLeg", region: "lower-body" },
    { id: "rightToe", parentId: "rightFoot", region: "lower-body", optional: true }
  ]
};

export const HUMANOID_JOINT_ORDER = HUMANOID_SKELETON.joints.map((joint) => joint.id);
export const CANONICAL_EDGES = HUMANOID_SKELETON.joints
  .filter((joint): joint is typeof joint & { parentId: string } => Boolean(joint.parentId))
  .map((joint) => [joint.parentId, joint.id] as const);

const MEDIAPIPE_INDEX: Record<string, number | number[]> = {
  leftShoulder: 11,
  leftArm: 13,
  leftForearm: 15,
  leftHand: 19,
  rightShoulder: 12,
  rightArm: 14,
  rightForearm: 16,
  rightHand: 20,
  leftUpperLeg: 23,
  leftLowerLeg: 25,
  leftFoot: 27,
  leftToe: 31,
  rightUpperLeg: 24,
  rightLowerLeg: 26,
  rightFoot: 28,
  rightToe: 32
};

function add(a: Point3, b: Point3): Point3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a: Point3, amount: number): Point3 { return [a[0] * amount, a[1] * amount, a[2] * amount]; }
function midpoint(a: Point3, b: Point3): Point3 { return scale(add(a, b), 0.5); }
function distance(a: Point3, b: Point3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function subtract(a: Point3, b: Point3): Point3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function normalize(a: Point3): Point3 {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length > 0.00001 ? scale(a, 1 / length) : [0, 1, 0];
}

function cross(a: Point3, b: Point3): Point3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function landmark(frame: RawPoseFrame, index: number): Point3 {
  const value = frame.landmarks[index];
  // MediaPipe reports anatomical left on the image's positive-X side for a
  // front-facing subject. Canonical avatars use left-negative/right-positive.
  // Convert the image-facing lateral/depth axes once at the capture boundary
  // so every consumer agrees on the canonical stage coordinate system.
  return value && Number.isFinite(value.x)
    ? [-value.x, -value.y, mediaPipeDepthToCanonical(value.z)]
    : [0, 0, 0];
}

function rootPosition(frame: RawPoseFrame): Point3 {
  const value = frame.rootPosition;
  return value && value.every(Number.isFinite) ? value : [0, 0, 0];
}

function landmarkConfidence(frame: RawPoseFrame, index: number): number {
  return Math.max(0, Math.min(1, Number(frame.landmarks[index]?.visibility ?? 0)));
}

function landmarkIfAvailable(frame: RawPoseFrame, index: number): Point3 | null {
  const value = frame.landmarks[index];
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) return null;
  return landmark(frame, index);
}

function midpointIfAvailable(first: Point3 | null, second: Point3 | null): Point3 | null {
  return first && second ? midpoint(first, second) : null;
}

function headCenter(frame: RawPoseFrame): { point: Point3; confidence: number } {
  const leftEar = landmarkIfAvailable(frame, 7);
  const rightEar = landmarkIfAvailable(frame, 8);
  const ears = midpointIfAvailable(leftEar, rightEar);
  if (ears) {
    return {
      point: ears,
      confidence: Math.min(landmarkConfidence(frame, 7), landmarkConfidence(frame, 8))
    };
  }

  const leftEye = landmarkIfAvailable(frame, 2);
  const rightEye = landmarkIfAvailable(frame, 5);
  const eyes = midpointIfAvailable(leftEye, rightEye);
  if (eyes) {
    return {
      point: eyes,
      confidence: Math.min(landmarkConfidence(frame, 2), landmarkConfidence(frame, 5))
    };
  }

  return { point: landmark(frame, 0), confidence: landmarkConfidence(frame, 0) };
}

function headUpDirection(frame: RawPoseFrame): Point3 {
  const leftEar = landmarkIfAvailable(frame, 7);
  const rightEar = landmarkIfAvailable(frame, 8);
  const eyeCenter = midpointIfAvailable(landmarkIfAvailable(frame, 2), landmarkIfAvailable(frame, 5));
  if (leftEar && rightEar && eyeCenter) {
    // The nose is a face point, not a skeletal head endpoint. Use the ear
    // axis and eye direction to estimate the head's anatomical up vector,
    // which preserves nodding without turning face depth into a hunch.
    const lateral = subtract(rightEar, leftEar);
    const faceDirection = subtract(eyeCenter, midpoint(leftEar, rightEar));
    const up = cross(lateral, faceDirection);
    if (up[1] < 0) return scale(normalize(up), -1);
    if (Math.hypot(...up) > 0.00001) return normalize(up);
  }

  const hips = midpoint(landmark(frame, 23), landmark(frame, 24));
  const chest = midpoint(landmark(frame, 11), landmark(frame, 12));
  return normalize(subtract(chest, hips));
}

function canonicalHeadPoints(frame: RawPoseFrame, environmentRoot: Point3): { neck: Point3; head: Point3 } {
  const hips = add(midpoint(landmark(frame, 23), landmark(frame, 24)), environmentRoot);
  const chest = add(midpoint(landmark(frame, 11), landmark(frame, 12)), environmentRoot);
  const observedHead = add(headCenter(frame).point, environmentRoot);
  const torsoUp = normalize(subtract(chest, hips));
  const observedHeadSpan = Math.max(0.08, distance(chest, observedHead));
  const neckLength = observedHeadSpan * 0.45;
  const headLength = observedHeadSpan * 0.55;
  const neck = add(chest, scale(torsoUp, neckLength));
  const head = add(neck, scale(headUpDirection(frame), headLength));
  return { neck, head };
}

function pointForJoint(frame: RawPoseFrame, jointId: string): Point3 {
  const mapped = MEDIAPIPE_INDEX[jointId];
  const environmentRoot = rootPosition(frame);
  if (typeof mapped === "number") return add(landmark(frame, mapped), environmentRoot);
  if (jointId === "root" || jointId === "hips") return add(midpoint(landmark(frame, 23), landmark(frame, 24)), environmentRoot);
  if (jointId === "spine") return midpoint(pointForJoint(frame, "hips"), pointForJoint(frame, "chest"));
  if (jointId === "chest") return add(midpoint(landmark(frame, 11), landmark(frame, 12)), environmentRoot);
  if (jointId === "neck" || jointId === "head") return canonicalHeadPoints(frame, environmentRoot)[jointId];
  return [0, 0, 0];
}

function confidenceForJoint(frame: RawPoseFrame, jointId: string): number {
  const mapped = MEDIAPIPE_INDEX[jointId];
  if (typeof mapped === "number") return landmarkConfidence(frame, mapped);
  if (jointId === "root" || jointId === "hips") return Math.min(landmarkConfidence(frame, 23), landmarkConfidence(frame, 24));
  if (jointId === "spine") return Math.min(confidenceForJoint(frame, "hips"), confidenceForJoint(frame, "chest"));
  if (jointId === "chest") return Math.min(landmarkConfidence(frame, 11), landmarkConfidence(frame, 12));
  if (jointId === "neck" || jointId === "head") return Math.min(confidenceForJoint(frame, "chest"), headCenter(frame).confidence);
  return 0;
}

function quaternionFromDirection(direction: Point3): [number, number, number, number] {
  const target = normalize(direction);
  const dot = target[1];
  const axis: Point3 = [-target[2], 0, target[0]];
  if (dot < -0.9999) return [1, 0, 0, 0];
  const factor = Math.sqrt((1 + dot) * 2);
  if (factor < 0.00001) return [0, 0, 0, 1];
  return [axis[0] / factor, axis[1] / factor, axis[2] / factor, factor / 2];
}

export function buildCanonicalJointPoints(frame: RawPoseFrame): Record<string, Point3> {
  return Object.fromEntries(HUMANOID_JOINT_ORDER.map((jointId) => [jointId, pointForJoint(frame, jointId)]));
}

export function canonicalScaleForPoints(points: Record<string, Point3>): number {
  const referenceLength = distance(points.hips ?? [0, 0, 0], points.chest ?? [0, 1, 0]);
  return referenceLength > 0.01 ? 1 / referenceLength : 1;
}

export function normalizeCanonicalPoints(
  points: Record<string, Point3>,
  rootStart: Point3,
  scaleFactor: number
): Record<string, Point3> {
  return Object.fromEntries(HUMANOID_JOINT_ORDER.map((jointId) => [
    jointId,
    scale(subtract(points[jointId], rootStart), scaleFactor)
  ]));
}

function buildSegments(
  frames: RawPoseFrame[],
  pointsPerFrame: Array<Record<string, Point3>>,
  durationSeconds: number
): MotionSegment[] {
  const regions: DanceMotionRegion[] = ["full-body", "lower-body", "hips", "torso", "left-arm", "right-arm", "head"];
  const regionJoints = new Map<DanceMotionRegion, string[]>();
  for (const joint of HUMANOID_SKELETON.joints) {
    const joints = regionJoints.get(joint.region) ?? [];
    joints.push(joint.id);
    regionJoints.set(joint.region, joints);
  }
  return regions.map((region) => {
    const joints = region === "full-body" ? HUMANOID_JOINT_ORDER : regionJoints.get(region) ?? [];
    let movement = 0;
    let samples = 0;
    for (let index = 1; index < pointsPerFrame.length; index += 1) {
      for (const jointId of joints) movement += distance(pointsPerFrame[index][jointId], pointsPerFrame[index - 1][jointId]);
      samples += joints.length;
    }
    const energy = samples ? Math.max(0, Math.min(1, (movement / samples) * 24)) : 0;
    const confidence = frames.length
      ? frames.reduce((sum, frame) => sum + joints.reduce((jointSum, jointId) => jointSum + confidenceForJoint(frame, jointId), 0), 0) /
        Math.max(1, frames.length * joints.length)
      : 0;
    return {
      id: `${region}-capture`,
      region,
      startSeconds: 0,
      endSeconds: durationSeconds,
      label: "Captured movement",
      energy,
      confidence
    };
  });
}

function contactFrames(points: Array<Record<string, Point3>>, footId: string, toeId: string): number[] {
  if (!points.length) return [];
  const heights = points.map((frame) => Math.min(frame[footId][1], frame[toeId][1]));
  const floor = [...heights].sort((a, b) => a - b)[Math.floor(heights.length * 0.12)] ?? 0;
  return points.map((frame, index) => {
    const previous = points[Math.max(0, index - 1)][footId];
    const current = frame[footId];
    const speed = distance(current, previous);
    return Math.min(current[1], frame[toeId][1]) <= floor + 0.08 && speed < 0.035 ? 1 : 0;
  });
}

export function buildCanonicalMotionClip(params: {
  raw: RawPoseSequence;
  sourceMetadata: DanceMotionSourceMetadata;
}): { clip: DanceMotionClip; pointsPerFrame: Array<Record<string, Point3>> } {
  const pointsPerFrame = params.raw.frames.map(buildCanonicalJointPoints);
  const first = pointsPerFrame[0] ?? {};
  const scaleFactor = canonicalScaleForPoints(first);
  const rootStart = first.root ?? [0, 0, 0];
  const normalizedPoints = pointsPerFrame.map((frame) => normalizeCanonicalPoints(frame, rootStart, scaleFactor));
  const rootPositions = normalizedPoints.flatMap((frame) => frame.root);
  const rootRotations = params.raw.frames.flatMap(() => [0, 0, 0, 1]);
  const jointPositions = normalizedPoints.flatMap((frame) => HUMANOID_JOINT_ORDER.flatMap((jointId) => frame[jointId]));
  const jointRotations = normalizedPoints.flatMap((frame) => HUMANOID_SKELETON.joints.map((joint) => {
    const child = HUMANOID_SKELETON.joints.find((candidate) => candidate.parentId === joint.id);
    const direction = child ? subtract(frame[child.id], frame[joint.id]) : [0, 1, 0] as Point3;
    return quaternionFromDirection(direction);
  }).flat());
  const landmarkConfidence = params.raw.frames.flatMap((frame) => HUMANOID_JOINT_ORDER.map((jointId) => confidenceForJoint(frame, jointId)));
  const validJointMask = landmarkConfidence.map((confidence) => confidence >= 0.35 ? 1 : 0);
  const clip: DanceMotionClip = {
    format: "faceless-dance-motion",
    version: 1,
    skeletonId: HUMANOID_SKELETON.id,
    durationSeconds: params.raw.durationSeconds,
    sourceFrameRate: params.raw.frameRate,
    frameCount: params.raw.frames.length,
    timestamps: params.raw.frames.map((frame) => frame.timestampSeconds),
    rootPositions,
    rootRotations,
    jointRotations,
    jointPositions,
    landmarkConfidence,
    validJointMask,
    leftFootContact: contactFrames(normalizedPoints, "leftFoot", "leftToe"),
    rightFootContact: contactFrames(normalizedPoints, "rightFoot", "rightToe"),
    leftToeContact: contactFrames(normalizedPoints, "leftToe", "leftToe"),
    rightToeContact: contactFrames(normalizedPoints, "rightToe", "rightToe"),
    segments: buildSegments(params.raw.frames, pointsPerFrame, params.raw.durationSeconds),
    normalization: {
      scale: scaleFactor,
      rotationYRadians: 0,
      rootOffset: rootStart,
      rootAnchor: "initial-hip",
      rootTranslationSource: "image-space-hip-tracking",
      lateralAxis: "left-negative",
      depthConvention: CANONICAL_DEPTH_CONVENTION,
      sourceCoordinateSystem: "mediapipe-pose-world",
      targetCoordinateSystem: "right-handed-y-up"
    },
    sourceMetadata: params.sourceMetadata
  };
  return { clip, pointsPerFrame: normalizedPoints };
}

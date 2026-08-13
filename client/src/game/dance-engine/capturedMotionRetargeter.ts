import type { DanceMotionClip } from "@faceless/shared";
import * as THREE from "three";
import { HUMANOID_JOINT_ORDER } from "./canonicalMotion";
import { rootMotionScaleForRig, storedDepthToEngine } from "./motionCoordinates";
import type { DanceRig } from "./proceduralDanceMotion";

type RigBoneKey = Exclude<keyof DanceRig, "root">;

interface SegmentBinding {
  boneKey: RigBoneKey;
  parentJoint: string;
  childJoint: string;
}

interface RestBonePose {
  bone: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

interface RestSegmentPose {
  binding: SegmentBinding;
  bone: THREE.Object3D;
  baseWorldQuaternion: THREE.Quaternion;
  restWorldDirection: THREE.Vector3 | null;
}

interface RestLegPose {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  foot: THREE.Object3D;
  upperLength: number;
  lowerLength: number;
  lowerLocalDirection: THREE.Vector3;
}

interface RestArmPose {
  side: "left" | "right";
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  hand: THREE.Object3D;
  upperLength: number;
  lowerLength: number;
}

interface TorsoClearanceProxy {
  center: THREE.Vector3;
  radiusX: number;
  radiusY: number;
  radiusZ: number;
  backZ: number;
  frontZ: number;
  clearance: number;
  maxCorrection: number;
  armRadius: number;
}

const SEGMENT_BINDINGS: SegmentBinding[] = [
  { boneKey: "body", parentJoint: "hips", childJoint: "chest" },
  { boneKey: "hips", parentJoint: "hips", childJoint: "spine" },
  { boneKey: "spine", parentJoint: "spine", childJoint: "chest" },
  { boneKey: "chest", parentJoint: "chest", childJoint: "neck" },
  { boneKey: "head", parentJoint: "neck", childJoint: "head" },
  // A bone rotates around its own joint, so the source segment must begin at
  // that same joint. The old bindings were shifted one joint toward the body.
  { boneKey: "shoulderLeft", parentJoint: "leftShoulder", childJoint: "leftArm" },
  { boneKey: "upperArmLeft", parentJoint: "leftArm", childJoint: "leftForearm" },
  { boneKey: "forearmLeft", parentJoint: "leftForearm", childJoint: "leftHand" },
  { boneKey: "shoulderRight", parentJoint: "rightShoulder", childJoint: "rightArm" },
  { boneKey: "upperArmRight", parentJoint: "rightArm", childJoint: "rightForearm" },
  { boneKey: "forearmRight", parentJoint: "rightForearm", childJoint: "rightHand" },
  { boneKey: "upperLegLeft", parentJoint: "leftUpperLeg", childJoint: "leftLowerLeg" },
  { boneKey: "lowerLegLeft", parentJoint: "leftLowerLeg", childJoint: "leftFoot" },
  { boneKey: "footLeft", parentJoint: "leftFoot", childJoint: "leftToe" },
  { boneKey: "upperLegRight", parentJoint: "rightUpperLeg", childJoint: "rightLowerLeg" },
  { boneKey: "lowerLegRight", parentJoint: "rightLowerLeg", childJoint: "rightFoot" },
  { boneKey: "footRight", parentJoint: "rightFoot", childJoint: "rightToe" }
];

const WORLD_QUATERNION = new THREE.Quaternion();
const PARENT_WORLD_QUATERNION = new THREE.Quaternion();
const DESIRED_WORLD_QUATERNION = new THREE.Quaternion();
const LOCAL_QUATERNION = new THREE.Quaternion();
const ROOT_OFFSET = new THREE.Vector3();
const TARGET_SEGMENT_DIRECTION = new THREE.Vector3();
const CURRENT_DIRECTION = new THREE.Vector3();
const TARGET_DIRECTION = new THREE.Vector3();
const POLE_DIRECTION = new THREE.Vector3();
const PROJECTED_POLE = new THREE.Vector3();
const DESIRED_KNEE = new THREE.Vector3();
const TARGET_FOOT = new THREE.Vector3();
const CURRENT_HIP = new THREE.Vector3();
const CURRENT_KNEE = new THREE.Vector3();
const ROTATION_DELTA = new THREE.Quaternion();
const CURRENT_WORLD_QUATERNION = new THREE.Quaternion();
const DESIRED_KNEE_WORLD_QUATERNION = new THREE.Quaternion();
const DESIRED_ANKLE_WORLD_QUATERNION = new THREE.Quaternion();
const SOURCE_KNEE_DIRECTION = new THREE.Vector3();
const BLENDED_FOOT_TARGET = new THREE.Vector3();
const ARM_ORIGIN = new THREE.Vector3();
const ARM_ELBOW = new THREE.Vector3();
const ARM_HAND = new THREE.Vector3();
const ARM_TARGET = new THREE.Vector3();
const ARM_DIRECTION = new THREE.Vector3();
const ARM_POLE = new THREE.Vector3();
const ARM_PROJECTED_POLE = new THREE.Vector3();
const ARM_DESIRED_ELBOW = new THREE.Vector3();
const ARM_CURRENT_END_DIRECTION = new THREE.Vector3();
const ARM_TARGET_END_DIRECTION = new THREE.Vector3();
const ARM_LOCAL_POINT = new THREE.Vector3();
const ARM_TARGET_LOCAL_POINT = new THREE.Vector3();
const ARM_FORWARD_WORLD = new THREE.Vector3();
const ARM_SAMPLE = new THREE.Vector3();
const ARM_PENETRATION_CANDIDATE = new THREE.Vector3();
const ARM_BEST_PENETRATION = new THREE.Vector3();
const LEG_IK_BLEND = 0.35;
// Clearance is a collision safeguard, not a replacement for the captured
// elbow pose. A soft solve prevents small torso-proxy overlaps from flipping
// the arm onto the opposite bend plane.
const ARM_CLEARANCE_IK_BLEND = 0.12;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function uniqueBones(rig: DanceRig): THREE.Object3D[] {
  return [...new Set(Object.values(rig).filter((bone): bone is THREE.Object3D => Boolean(bone)))];
}

function sourcePoint(
  clip: DanceMotionClip,
  frameIndex: number,
  jointId: string
): THREE.Vector3 | null {
  const jointIndex = HUMANOID_JOINT_ORDER.indexOf(jointId);
  if (jointIndex < 0 || !clip.jointPositions) return null;
  const offset = (frameIndex * HUMANOID_JOINT_ORDER.length + jointIndex) * 3;
  const x = Number(clip.jointPositions[offset]);
  const y = Number(clip.jointPositions[offset + 1]);
  const z = Number(clip.jointPositions[offset + 2]);
  if (![x, y, z].every(Number.isFinite)) return null;
  const lateralSign = clip.normalization?.lateralAxis === "left-negative" ? 1 : -1;
  return new THREE.Vector3(x * lateralSign, y, storedDepthToEngine(z, clip.normalization));
}

function sourceJointIsReliable(clip: DanceMotionClip, frameIndex: number, jointId: string): boolean {
  const jointIndex = HUMANOID_JOINT_ORDER.indexOf(jointId);
  if (jointIndex < 0) return false;
  const offset = frameIndex * HUMANOID_JOINT_ORDER.length + jointIndex;
  if (clip.validJointMask && clip.validJointMask[offset] === 0) return false;
  if (clip.landmarkConfidence && Number(clip.landmarkConfidence[offset]) < 0.35) return false;
  return true;
}

function sourcePointAtFramePosition(
  clip: DanceMotionClip,
  framePosition: number,
  jointId: string
): THREE.Vector3 | null {
  const lastFrame = Math.max(0, clip.frameCount - 1);
  const position = clamp(framePosition, 0, lastFrame);
  const firstFrame = Math.floor(position);
  const secondFrame = Math.min(lastFrame, firstFrame + 1);
  const first = sourceJointIsReliable(clip, firstFrame, jointId) ? sourcePoint(clip, firstFrame, jointId) : null;
  const second = sourceJointIsReliable(clip, secondFrame, jointId) ? sourcePoint(clip, secondFrame, jointId) : null;
  if (first && second) return first.lerp(second, position - firstFrame);
  return first ?? second;
}

function sourceDirectionAtFramePosition(
  clip: DanceMotionClip,
  framePosition: number,
  binding: SegmentBinding
): THREE.Vector3 | null {
  const parent = sourcePointAtFramePosition(clip, framePosition, binding.parentJoint);
  const child = sourcePointAtFramePosition(clip, framePosition, binding.childJoint);
  if (!parent || !child) return null;
  const direction = child.sub(parent);
  return direction.lengthSq() > 0.000001 ? direction.normalize() : null;
}

function sourceRootPosition(clip: DanceMotionClip, frameIndex: number): THREE.Vector3 {
  const offset = frameIndex * 3;
  const x = Number(clip.rootPositions[offset] ?? 0);
  const y = Number(clip.rootPositions[offset + 1] ?? 0);
  const z = Number(clip.rootPositions[offset + 2] ?? 0);
  const lateralSign = clip.normalization?.lateralAxis === "left-negative" ? 1 : -1;
  return new THREE.Vector3(
    Number.isFinite(x) ? x * lateralSign : 0,
    Number.isFinite(y) ? y : 0,
    Number.isFinite(z) ? storedDepthToEngine(z, clip.normalization) : 0
  );
}

function sourceRootPositionAtFramePosition(clip: DanceMotionClip, framePosition: number): THREE.Vector3 {
  const lastFrame = Math.max(0, clip.frameCount - 1);
  const position = clamp(framePosition, 0, lastFrame);
  const firstFrame = Math.floor(position);
  const secondFrame = Math.min(lastFrame, firstFrame + 1);
  return sourceRootPosition(clip, firstFrame).lerp(sourceRootPosition(clip, secondFrame), position - firstFrame);
}

function worldPosition(object: THREE.Object3D): THREE.Vector3 {
  object.updateWorldMatrix(true, false);
  return object.getWorldPosition(new THREE.Vector3());
}

function rootLocalPosition(root: THREE.Object3D, object: THREE.Object3D): THREE.Vector3 {
  const position = worldPosition(object);
  return root.worldToLocal(position);
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((sorted.length - 1) * fraction), 0, sorted.length - 1);
  return sorted[index] ?? null;
}

function collectRestMeshPoints(root: THREE.Object3D): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  root.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position) return;
    const stride = Math.max(1, Math.ceil(position.count / 6000));
    for (let index = 0; index < position.count; index += stride) {
      const point = new THREE.Vector3();
      const getVertexPosition = (mesh as THREE.Mesh & {
        getVertexPosition?: (index: number, target: THREE.Vector3) => void;
      }).getVertexPosition;
      if (getVertexPosition) getVertexPosition.call(mesh, index, point);
      else point.fromBufferAttribute(position, index);
      mesh.localToWorld(point);
      root.worldToLocal(point);
      points.push(point);
    }
  });
  return points;
}

function buildTorsoClearanceProxy(rig: DanceRig): TorsoClearanceProxy | null {
  const hips = rig.hips;
  const chest = rig.chest;
  if (!hips || !chest) return null;

  const root = rig.root;
  root.updateWorldMatrix(true, true);
  const hipsPosition = rootLocalPosition(root, hips);
  const chestPosition = rootLocalPosition(root, chest);
  const torsoLength = hipsPosition.distanceTo(chestPosition);
  if (torsoLength < 0.0001) return null;

  const centerX = (hipsPosition.x + chestPosition.x) * 0.5;
  const centerY = (hipsPosition.y + chestPosition.y) * 0.5;
  const centerZ = (hipsPosition.z + chestPosition.z) * 0.5;
  const shoulderHalfWidth = rig.shoulderLeft && rig.shoulderRight
    ? Math.abs(rootLocalPosition(root, rig.shoulderLeft).x - rootLocalPosition(root, rig.shoulderRight).x) * 0.5
    : torsoLength * 0.24;
  const torsoBandBottom = Math.min(hipsPosition.y, chestPosition.y) - torsoLength * 0.14;
  const torsoBandTop = Math.max(hipsPosition.y, chestPosition.y) + torsoLength * 0.18;
  const centralHalfWidth = Math.max(torsoLength * 0.16, shoulderHalfWidth * 0.72);
  const meshPoints = collectRestMeshPoints(root);
  const torsoPoints = meshPoints.filter((point) => (
    point.y >= torsoBandBottom &&
    point.y <= torsoBandTop &&
    Math.abs(point.x - centerX) <= centralHalfWidth * 1.15
  ));
  const points = torsoPoints.length >= 12 ? torsoPoints : meshPoints.filter((point) => (
    point.y >= torsoBandBottom &&
    point.y <= torsoBandTop
  ));

  const xValues = points.map((point) => point.x);
  const zValues = points.map((point) => point.z);
  const minX = percentile(xValues, 0.08);
  const maxX = percentile(xValues, 0.92);
  const backZ = percentile(zValues, 0.08);
  const frontZ = percentile(zValues, 0.92);
  const radiusX = Math.max(
    torsoLength * 0.16,
    minX !== null && maxX !== null ? (maxX - minX) * 0.5 : centralHalfWidth
  );
  const radiusY = Math.max(torsoLength * 0.28, (torsoBandTop - torsoBandBottom) * 0.5);
  const radiusZ = Math.max(
    torsoLength * 0.1,
    backZ !== null && frontZ !== null ? (frontZ - backZ) * 0.5 : torsoLength * 0.15
  );
  const proxyBackZ = backZ ?? centerZ - radiusZ;
  const proxyFrontZ = frontZ ?? centerZ + radiusZ;
  const proxyCenterZ = (proxyBackZ + proxyFrontZ) * 0.5;
  const modelRelativeClearance = torsoLength * 0.025;

  return {
    center: new THREE.Vector3(centerX, centerY, proxyCenterZ),
    radiusX,
    radiusY,
    radiusZ,
    backZ: proxyBackZ,
    frontZ: proxyFrontZ,
    clearance: modelRelativeClearance,
    // A single hand shift is not enough when the captured elbow crosses the
    // torso. Allow the iterative solve to move the arm by a meaningful but
    // model-relative amount without letting it jump to the other side.
    maxCorrection: Math.min(torsoLength * 0.5, radiusZ * 0.85),
    armRadius: Math.max(torsoLength * 0.025, Math.min(torsoLength * 0.075, radiusX * 0.16))
  };
}

function firstChildObject(object: THREE.Object3D): THREE.Object3D | null {
  return object.children.find((child: THREE.Object3D) => child instanceof THREE.Object3D) ?? null;
}

function buildRestArmPose(
  side: "left" | "right",
  upper: THREE.Object3D | null,
  lower: THREE.Object3D | null
): RestArmPose | null {
  if (!upper || !lower) return null;
  const hand = firstChildObject(lower);
  if (!hand) return null;
  const upperPosition = worldPosition(upper);
  const elbowPosition = worldPosition(lower);
  const handPosition = worldPosition(hand);
  const upperLength = upperPosition.distanceTo(elbowPosition);
  const lowerLength = elbowPosition.distanceTo(handPosition);
  if (upperLength < 0.0001 || lowerLength < 0.0001) return null;
  return { side, upper, lower, hand, upperLength, lowerLength };
}

function restBoneDirection(bone: THREE.Object3D): THREE.Vector3 | null {
  const child = bone.children.find((candidate) => (candidate as THREE.Bone).isBone);
  const start = worldPosition(bone);
  // Canonical head bones are terminal nodes, so they have no child from
  // which to infer their axis. Their incoming parent-to-joint direction is
  // the actual rest axis and keeps terminal rotations anchored correctly.
  const end = child ? worldPosition(child) : bone.parent ? worldPosition(bone.parent) : null;
  if (!end) return null;
  if (!child) {
    const direction = start.sub(end);
    return direction.lengthSq() > 0.000001 ? direction.normalize() : null;
  }
  const direction = end.sub(start);
  return direction.lengthSq() > 0.000001 ? direction.normalize() : null;
}

function sourceDistance(
  clip: DanceMotionClip,
  frameIndex: number,
  firstJoint: string,
  secondJoint: string
): number | null {
  if (!sourceJointIsReliable(clip, frameIndex, firstJoint) || !sourceJointIsReliable(clip, frameIndex, secondJoint)) return null;
  const first = sourcePoint(clip, frameIndex, firstJoint);
  const second = sourcePoint(clip, frameIndex, secondJoint);
  if (!first || !second) return null;
  const distance = first.distanceTo(second);
  return distance > 0.0001 ? distance : null;
}

function usesCapturedBaseline(boneKey: RigBoneKey): boolean {
  return boneKey === "body" || boneKey === "hips" || boneKey === "spine" || boneKey === "chest" || boneKey === "head";
}

export class CapturedMotionRetargeter {
  private readonly bones: RestBonePose[];
  private readonly segments: RestSegmentPose[];
  private readonly legs: Array<{ side: "left" | "right"; pose: RestLegPose }> = [];
  private readonly arms: RestArmPose[] = [];
  private readonly torsoClearanceProxy: TorsoClearanceProxy | null;
  private readonly sourceRestLegLengths = new Map<"left" | "right", { upper: number; lower: number }>();
  private readonly sourceRestDirections = new Map<RigBoneKey, THREE.Vector3>();
  private clip: DanceMotionClip | null = null;
  private rootMotionScale = 1;

  constructor(private readonly rig: DanceRig) {
    this.rig.root.updateWorldMatrix(true, true);
    this.bones = uniqueBones(rig).map((bone) => ({
      bone,
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone()
    }));
    this.segments = SEGMENT_BINDINGS.flatMap((binding) => {
      const bone = rig[binding.boneKey];
      if (!bone) return [];
      bone.getWorldQuaternion(WORLD_QUATERNION);
      return [{
        binding,
        bone,
        baseWorldQuaternion: WORLD_QUATERNION.clone(),
        restWorldDirection: restBoneDirection(bone)
      }];
    });
    this.addLegPose("left", rig.upperLegLeft, rig.lowerLegLeft, rig.footLeft);
    this.addLegPose("right", rig.upperLegRight, rig.lowerLegRight, rig.footRight);
    const leftArm = buildRestArmPose("left", rig.upperArmLeft, rig.forearmLeft);
    const rightArm = buildRestArmPose("right", rig.upperArmRight, rig.forearmRight);
    if (leftArm) this.arms.push(leftArm);
    if (rightArm) this.arms.push(rightArm);
    this.torsoClearanceProxy = buildTorsoClearanceProxy(rig);
  }

  setClip(clip: DanceMotionClip | null): void {
    this.clip = clip;
    this.sourceRestLegLengths.clear();
    this.sourceRestDirections.clear();
    this.rootMotionScale = 1;
    if (!clip) return;
    for (const segment of this.segments) {
      if (!usesCapturedBaseline(segment.binding.boneKey)) continue;
      const direction = sourceDirectionAtFramePosition(clip, 0, segment.binding);
      if (direction) this.sourceRestDirections.set(segment.binding.boneKey, direction.clone());
    }
    for (const side of ["left", "right"] as const) {
      const upper = sourceDistance(clip, 0, `${side}UpperLeg`, `${side}LowerLeg`);
      const lower = sourceDistance(clip, 0, `${side}LowerLeg`, `${side}Foot`);
      if (upper && lower) this.sourceRestLegLengths.set(side, { upper, lower });
    }
    const sourceTorsoLength = sourceDistance(clip, 0, "hips", "chest") ?? 1;
    this.rootMotionScale = rootMotionScaleForRig(this.targetTorsoLength(), sourceTorsoLength);
  }

  restoreRestPose(): void {
    for (const pose of this.bones) {
      pose.bone.position.copy(pose.position);
      pose.bone.quaternion.copy(pose.quaternion);
    }
    this.rig.root.updateWorldMatrix(true, true);
  }

  apply(timeSeconds: number): boolean {
    if (!this.clip?.frameCount || !this.clip.jointPositions || !this.segments.length) return false;
    const duration = Math.max(0.001, this.clip.durationSeconds);
    const loopedTime = ((Math.max(0, timeSeconds) % duration) + duration) % duration;
    const framePosition = clamp(loopedTime * this.clip.sourceFrameRate, 0, Math.max(0, this.clip.frameCount - 1));
    this.restoreRestPose();

    const rootPosition = sourceRootPositionAtFramePosition(this.clip, framePosition);
    ROOT_OFFSET.copy(rootPosition).multiplyScalar(this.rootMotionScale);
    this.rig.root.position.add(ROOT_OFFSET);
    this.rig.root.updateWorldMatrix(true, true);

    for (const segment of this.segments) {
      if (segment.binding.boneKey === "footLeft" || segment.binding.boneKey === "footRight") continue;
      const sourceCurrent = sourceDirectionAtFramePosition(this.clip, framePosition, segment.binding);
      if (!sourceCurrent) continue;

      // Arms and legs follow the captured directions directly. Torso and head
      // use the capture's first frame only as their neutral baseline, which
      // prevents bind-pose differences from turning into a permanent hunch
      // while still preserving their full frame-to-frame movement.
      DESIRED_WORLD_QUATERNION.copy(segment.baseWorldQuaternion);
      if (segment.restWorldDirection) {
        TARGET_SEGMENT_DIRECTION.copy(sourceCurrent).normalize();
        const capturedBaseline = this.sourceRestDirections.get(segment.binding.boneKey);
        ROTATION_DELTA.setFromUnitVectors(
          capturedBaseline ?? segment.restWorldDirection,
          TARGET_SEGMENT_DIRECTION
        );
        DESIRED_WORLD_QUATERNION.premultiply(ROTATION_DELTA);
      } else {
        // Keep its calibrated base orientation when no reliable axis exists.
        continue;
      }
      const parent = segment.bone.parent;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        parent.getWorldQuaternion(PARENT_WORLD_QUATERNION);
        LOCAL_QUATERNION.copy(PARENT_WORLD_QUATERNION).invert().multiply(DESIRED_WORLD_QUATERNION);
        segment.bone.quaternion.copy(LOCAL_QUATERNION);
      } else {
        segment.bone.quaternion.copy(DESIRED_WORLD_QUATERNION);
      }
      segment.bone.updateWorldMatrix(true, false);
    }
    this.applyLegIk("left", framePosition);
    this.applyLegIk("right", framePosition);
    this.applyArmClearance(framePosition);
    this.rig.root.updateWorldMatrix(true, true);
    return true;
  }

  private applyArmClearance(framePosition: number): void {
    if (!this.torsoClearanceProxy || !this.arms.length) return;
    this.rig.root.updateWorldMatrix(true, true);
    this.rig.root.getWorldDirection(ARM_FORWARD_WORLD).normalize();
    // The avatar group is normalized to face the camera, so its local +Z is
    // the forward direction even when the source model required a yaw fix.
    for (const arm of this.arms) {
      // Re-test after every solve. A hand-only correction can leave the elbow
      // inside the torso, especially on models with long forearms.
      // One soft correction is enough to clear a visible overlap. Re-solving
      // the same chain repeatedly can turn a small depth correction into a
      // visibly different elbow bend.
      for (let iteration = 0; iteration < 1; iteration += 1) {
        const correction = this.armClearanceCorrection(arm, framePosition);
        if (correction <= 0.0001) break;
        arm.hand.getWorldPosition(ARM_HAND);
        ARM_TARGET_LOCAL_POINT.copy(ARM_HAND);
        this.rig.root.worldToLocal(ARM_TARGET_LOCAL_POINT);
        ARM_TARGET_LOCAL_POINT.add(ARM_BEST_PENETRATION);
        ARM_TARGET.copy(ARM_TARGET_LOCAL_POINT);
        this.rig.root.localToWorld(ARM_TARGET);
        this.solveArmToTarget(arm, ARM_TARGET, framePosition);
      }
    }
  }

  private armClearanceCorrection(arm: RestArmPose, framePosition: number): number {
    const proxy = this.torsoClearanceProxy;
    if (!proxy) return 0;
    arm.upper.getWorldPosition(ARM_ORIGIN);
    arm.lower.getWorldPosition(ARM_ELBOW);
    arm.hand.getWorldPosition(ARM_HAND);
    this.rig.root.worldToLocal(ARM_LOCAL_POINT.copy(ARM_ORIGIN));
    const origin = ARM_LOCAL_POINT.clone();
    this.rig.root.worldToLocal(ARM_LOCAL_POINT.copy(ARM_ELBOW));
    const elbow = ARM_LOCAL_POINT.clone();
    this.rig.root.worldToLocal(ARM_LOCAL_POINT.copy(ARM_HAND));
    const hand = ARM_LOCAL_POINT.clone();
    let maximum = 0;
    ARM_BEST_PENETRATION.set(0, 0, 0);
    const sample = (
      start: THREE.Vector3,
      end: THREE.Vector3,
      startRatio: number,
      endRatio: number,
      parentJoint: string,
      childJoint: string
    ) => {
      for (let index = 0; index <= 4; index += 1) {
        const ratio = startRatio + (endRatio - startRatio) * (index / 4);
        ARM_SAMPLE.copy(start).lerp(end, ratio);
        const capturedDepth = this.capturedArmDepth(
          framePosition,
          parentJoint,
          childJoint,
          ratio
        );
        const penetration = this.torsoPenetration(
          ARM_SAMPLE,
          ARM_PENETRATION_CANDIDATE,
          capturedDepth
        );
        if (penetration > maximum) {
          maximum = penetration;
          ARM_BEST_PENETRATION.copy(ARM_PENETRATION_CANDIDATE);
        }
      }
    };
    // Skip the shoulder pivot itself, which naturally sits close to the torso.
    sample(origin, elbow, 0.18, 1, `${arm.side}Arm`, `${arm.side}Forearm`);
    sample(elbow, hand, 0, 1, `${arm.side}Forearm`, `${arm.side}Hand`);
    return Math.min(proxy.maxCorrection, maximum);
  }

  private capturedArmDepth(
    framePosition: number,
    parentJoint: string,
    childJoint: string,
    ratio: number
  ): number | null {
    if (!this.clip) return null;
    const parent = sourcePointAtFramePosition(this.clip, framePosition, parentJoint);
    const child = sourcePointAtFramePosition(this.clip, framePosition, childJoint);
    const hips = sourcePointAtFramePosition(this.clip, framePosition, "hips");
    const chest = sourcePointAtFramePosition(this.clip, framePosition, "chest");
    if (!parent || !child || !hips || !chest) return null;
    const sourcePoint = parent.lerp(child, ratio);
    const torsoCenterDepth = (hips.z + chest.z) * 0.5;
    return sourcePoint.z - torsoCenterDepth;
  }

  private torsoPenetration(
    point: THREE.Vector3,
    correction: THREE.Vector3,
    capturedDepth: number | null
  ): number {
    const proxy = this.torsoClearanceProxy;
    correction.set(0, 0, 0);
    if (!proxy) return 0;
    const normalizedX = (point.x - proxy.center.x) / proxy.radiusX;
    const normalizedY = (point.y - proxy.center.y) / proxy.radiusY;
    if (normalizedX * normalizedX + normalizedY * normalizedY >= 1) return 0;

    // Use the measured front/back torso surfaces instead of a 3D radial
    // ellipsoid. A crossed arm can be central in X/Y while still being fully
    // in front of the torso; that pose must remain valid. Only points inside
    // the torso's depth interval are corrected, directly toward the nearer
    // front or back surface.
    const surfaceOffset = proxy.clearance + proxy.armRadius;
    const frontBoundary = proxy.frontZ + surfaceOffset;
    const backBoundary = proxy.backZ - surfaceOffset;
    let targetZ = point.z;
    if (point.z > backBoundary && point.z < frontBoundary) {
      targetZ = capturedDepth === null
        ? (point.z >= proxy.center.z ? frontBoundary : backBoundary)
        : capturedDepth >= 0 ? frontBoundary : backBoundary;
    }
    const depth = Math.abs(targetZ - point.z);
    if (depth <= 0.000001) return 0;
    correction.set(0, 0, targetZ - point.z);
    const limitedDepth = Math.min(depth, proxy.maxCorrection);
    correction.setLength(limitedDepth);
    return limitedDepth;
  }

  private solveArmToTarget(arm: RestArmPose, target: THREE.Vector3, framePosition: number): void {
    arm.upper.updateWorldMatrix(true, false);
    arm.lower.updateWorldMatrix(true, false);
    arm.hand.updateWorldMatrix(true, false);
    arm.upper.getWorldPosition(ARM_ORIGIN);
    arm.lower.getWorldPosition(ARM_ELBOW);
    arm.hand.getWorldPosition(ARM_HAND);
    ARM_DIRECTION.copy(target).sub(ARM_ORIGIN);
    const distance = clamp(
      ARM_DIRECTION.length(),
      Math.abs(arm.upperLength - arm.lowerLength) + 0.0001,
      arm.upperLength + arm.lowerLength - 0.0001
    );
    if (ARM_DIRECTION.lengthSq() < 0.000001) return;
    ARM_DIRECTION.normalize();
    ARM_TARGET.copy(ARM_ORIGIN).addScaledVector(ARM_DIRECTION, distance);

    const capturedUpperDirection = this.clip
      ? sourceDirectionAtFramePosition(this.clip, framePosition, {
        boneKey: arm.side === "left" ? "upperArmLeft" : "upperArmRight",
        parentJoint: `${arm.side}Arm`,
        childJoint: `${arm.side}Forearm`
      })
      : null;
    if (capturedUpperDirection) ARM_POLE.copy(capturedUpperDirection);
    else ARM_POLE.copy(ARM_ELBOW).sub(ARM_ORIGIN);
    ARM_PROJECTED_POLE.copy(ARM_POLE).addScaledVector(
      ARM_DIRECTION,
      -ARM_POLE.dot(ARM_DIRECTION)
    );
    if (ARM_PROJECTED_POLE.lengthSq() < 0.000001) {
      ARM_PROJECTED_POLE.copy(ARM_FORWARD_WORLD);
      ARM_PROJECTED_POLE.addScaledVector(ARM_DIRECTION, -ARM_PROJECTED_POLE.dot(ARM_DIRECTION));
    }
    if (ARM_PROJECTED_POLE.lengthSq() < 0.000001) {
      ARM_PROJECTED_POLE.set(0, 1, 0);
      ARM_PROJECTED_POLE.addScaledVector(ARM_DIRECTION, -ARM_PROJECTED_POLE.dot(ARM_DIRECTION));
    }
    ARM_PROJECTED_POLE.normalize();
    const alongTarget = clamp(
      (arm.upperLength * arm.upperLength + distance * distance - arm.lowerLength * arm.lowerLength) / (2 * distance),
      0,
      arm.upperLength
    );
    const elbowHeight = Math.sqrt(Math.max(0, arm.upperLength * arm.upperLength - alongTarget * alongTarget));
    ARM_DESIRED_ELBOW.copy(ARM_ORIGIN)
      .addScaledVector(ARM_DIRECTION, alongTarget)
      .addScaledVector(ARM_PROJECTED_POLE, elbowHeight);

    this.rotateBoneToward(
      arm.upper,
      ARM_ELBOW.clone().sub(ARM_ORIGIN),
      ARM_DESIRED_ELBOW.clone().sub(ARM_ORIGIN),
      DESIRED_KNEE_WORLD_QUATERNION,
      ARM_CLEARANCE_IK_BLEND
    );
    arm.upper.updateWorldMatrix(true, false);
    arm.lower.updateWorldMatrix(true, false);
    arm.hand.updateWorldMatrix(true, false);
    arm.lower.getWorldPosition(ARM_ELBOW);
    arm.hand.getWorldPosition(ARM_HAND);
    ARM_CURRENT_END_DIRECTION.copy(ARM_HAND).sub(ARM_ELBOW);
    ARM_TARGET_END_DIRECTION.copy(ARM_TARGET).sub(ARM_ELBOW);
    this.rotateBoneToward(
      arm.lower,
      ARM_CURRENT_END_DIRECTION,
      ARM_TARGET_END_DIRECTION,
      DESIRED_ANKLE_WORLD_QUATERNION,
      ARM_CLEARANCE_IK_BLEND
    );
  }

  private addLegPose(
    side: "left" | "right",
    upper: THREE.Object3D | null,
    lower: THREE.Object3D | null,
    foot: THREE.Object3D | null
  ): void {
    if (!upper || !lower || !foot) return;
    const upperPosition = worldPosition(upper);
    const lowerPosition = worldPosition(lower);
    const footPosition = worldPosition(foot);
    const upperLength = upperPosition.distanceTo(lowerPosition);
    const lowerLength = lowerPosition.distanceTo(footPosition);
    if (upperLength < 0.0001 || lowerLength < 0.0001) return;
    const lowerRestDirection = footPosition.clone().sub(lowerPosition).normalize();
    const lowerBaseWorldQuaternion = lower.getWorldQuaternion(new THREE.Quaternion());
    const lowerLocalDirection = lowerRestDirection.applyQuaternion(lowerBaseWorldQuaternion.clone().invert());
    this.legs.push({ side, pose: { upper, lower, foot, upperLength, lowerLength, lowerLocalDirection } });
  }

  private targetTorsoLength(): number {
    const hips = this.rig.hips;
    const chest = this.rig.chest;
    if (!hips || !chest) return 1;
    const length = worldPosition(hips).distanceTo(worldPosition(chest));
    return length > 0.0001 ? length : 1;
  }

  private applyLegIk(side: "left" | "right", framePosition: number): void {
    const leg = this.legs.find((entry) => entry.side === side)?.pose;
    const sourceLengths = this.sourceRestLegLengths.get(side);
    if (!leg || !sourceLengths || !this.clip) return;
    const sourceHip = sourcePointAtFramePosition(this.clip, framePosition, `${side}UpperLeg`);
    const sourceKnee = sourcePointAtFramePosition(this.clip, framePosition, `${side}LowerLeg`);
    const sourceFoot = sourcePointAtFramePosition(this.clip, framePosition, `${side}Foot`);
    if (!sourceHip || !sourceFoot) return;

    const sourceLegLength = sourceLengths.upper + sourceLengths.lower;
    const avatarLegLength = leg.upperLength + leg.lowerLength;
    const motionScale = avatarLegLength / Math.max(0.0001, sourceLegLength);
    leg.upper.updateWorldMatrix(true, false);
    leg.lower.updateWorldMatrix(true, false);
    leg.foot.updateWorldMatrix(true, false);
    leg.upper.getWorldPosition(CURRENT_HIP);
    leg.lower.getWorldPosition(CURRENT_KNEE);
    TARGET_FOOT.copy(CURRENT_HIP).add(
      TARGET_DIRECTION.copy(sourceFoot).sub(sourceHip).multiplyScalar(motionScale)
    );

    TARGET_DIRECTION.copy(TARGET_FOOT).sub(CURRENT_HIP).normalize();
    const targetDistance = clamp(CURRENT_HIP.distanceTo(TARGET_FOOT), Math.abs(leg.upperLength - leg.lowerLength) + 0.0001, leg.upperLength + leg.lowerLength - 0.0001);
    TARGET_FOOT.copy(CURRENT_HIP).addScaledVector(TARGET_DIRECTION, targetDistance);
    CURRENT_DIRECTION.copy(CURRENT_KNEE).sub(CURRENT_HIP).normalize();
    PROJECTED_POLE.set(0, 0, 0);
    if (sourceKnee) {
      SOURCE_KNEE_DIRECTION.copy(sourceKnee).sub(sourceHip);
      PROJECTED_POLE.copy(SOURCE_KNEE_DIRECTION).addScaledVector(
        TARGET_DIRECTION,
        -SOURCE_KNEE_DIRECTION.dot(TARGET_DIRECTION)
      );
    }
    if (PROJECTED_POLE.lengthSq() < 0.000001) {
      POLE_DIRECTION.copy(CURRENT_DIRECTION);
      PROJECTED_POLE.copy(POLE_DIRECTION).addScaledVector(TARGET_DIRECTION, -POLE_DIRECTION.dot(TARGET_DIRECTION));
    }
    if (PROJECTED_POLE.lengthSq() < 0.000001) {
      PROJECTED_POLE.set(0, 0, 1).addScaledVector(TARGET_DIRECTION, -TARGET_DIRECTION.z);
      if (PROJECTED_POLE.lengthSq() < 0.000001) PROJECTED_POLE.set(1, 0, 0).addScaledVector(TARGET_DIRECTION, -TARGET_DIRECTION.x);
    }
    PROJECTED_POLE.normalize();
    const alongTarget = clamp((leg.upperLength * leg.upperLength + targetDistance * targetDistance - leg.lowerLength * leg.lowerLength) / (2 * targetDistance), 0, leg.upperLength);
    const kneeHeight = Math.sqrt(Math.max(0, leg.upperLength * leg.upperLength - alongTarget * alongTarget));
    DESIRED_KNEE.copy(CURRENT_HIP).addScaledVector(TARGET_DIRECTION, alongTarget).addScaledVector(PROJECTED_POLE, kneeHeight);

    this.rotateBoneToward(
      leg.upper,
      CURRENT_KNEE.sub(CURRENT_HIP),
      DESIRED_KNEE.clone().sub(CURRENT_HIP),
      DESIRED_KNEE_WORLD_QUATERNION,
      LEG_IK_BLEND
    );
    leg.upper.updateWorldMatrix(true, false);
    leg.lower.updateWorldMatrix(true, false);
    leg.lower.getWorldPosition(CURRENT_KNEE);
    leg.lower.getWorldQuaternion(CURRENT_WORLD_QUATERNION);
    CURRENT_DIRECTION.copy(leg.lowerLocalDirection).applyQuaternion(CURRENT_WORLD_QUATERNION);
    this.rotateBoneToward(
      leg.lower,
      CURRENT_DIRECTION,
      TARGET_FOOT.clone().sub(CURRENT_KNEE),
      DESIRED_ANKLE_WORLD_QUATERNION,
      LEG_IK_BLEND
    );
    leg.lower.updateWorldMatrix(true, false);
    leg.foot.updateWorldMatrix(true, false);
    if (leg.foot.parent !== leg.lower) {
      BLENDED_FOOT_TARGET.copy(worldPosition(leg.foot)).lerp(TARGET_FOOT, LEG_IK_BLEND);
      const localFootTarget = BLENDED_FOOT_TARGET.clone();
      leg.foot.parent?.worldToLocal(localFootTarget);
      leg.foot.position.copy(localFootTarget);
    }
  }

  private rotateBoneToward(
    bone: THREE.Object3D,
    currentDirection: THREE.Vector3,
    desiredDirection: THREE.Vector3,
    desiredWorldQuaternion: THREE.Quaternion,
    blend = 1
  ): void {
    if (currentDirection.lengthSq() < 0.000001 || desiredDirection.lengthSq() < 0.000001) return;
    bone.getWorldQuaternion(CURRENT_WORLD_QUATERNION);
    ROTATION_DELTA.setFromUnitVectors(currentDirection.normalize(), desiredDirection.normalize());
    desiredWorldQuaternion.copy(CURRENT_WORLD_QUATERNION).premultiply(ROTATION_DELTA);
    const parent = bone.parent;
    if (!parent) {
      bone.quaternion.slerp(desiredWorldQuaternion, blend);
      return;
    }
    parent.getWorldQuaternion(PARENT_WORLD_QUATERNION);
    LOCAL_QUATERNION.copy(PARENT_WORLD_QUATERNION).invert().multiply(desiredWorldQuaternion);
    bone.quaternion.slerp(LOCAL_QUATERNION, blend);
  }
}

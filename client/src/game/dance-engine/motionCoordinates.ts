import type { DanceMotionNormalization } from "@faceless/shared";

/**
 * Canonical motion uses a right-handed, Y-up stage where positive Z points
 * toward the front of the avatar. MediaPipe world Z uses the opposite depth
 * direction for a front-facing subject, so that conversion belongs at the
 * capture boundary rather than being repeated by each renderer.
 */
export const CANONICAL_DEPTH_CONVENTION = "front-positive" as const;

export function mediaPipeDepthToCanonical(value: number): number {
  return -value;
}

export function storedDepthToEngine(
  value: number,
  normalization: DanceMotionNormalization | undefined
): number {
  // Clips created before depthConvention was persisted contain the original
  // MediaPipe sign. Keep those clips playable without rewriting stored data.
  return normalization?.depthConvention === CANONICAL_DEPTH_CONVENTION ? value : -value;
}

export function rootMotionScaleForRig(
  targetTorsoLength: number,
  sourceTorsoLength: number
): number {
  if (!Number.isFinite(targetTorsoLength) || targetTorsoLength <= 0) return 1;
  if (!Number.isFinite(sourceTorsoLength) || sourceTorsoLength <= 0) return targetTorsoLength;
  return targetTorsoLength / sourceTorsoLength;
}

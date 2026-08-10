import type { DanceMotionClip, DanceMotionComposition, DanceMotionCompositionSegment } from "@faceless/shared";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function frameIndexForTime(clip: DanceMotionClip, timeSeconds: number): number {
  const timestamps = clip.timestamps;
  if (!timestamps.length) return 0;
  let low = 0;
  let high = timestamps.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (timestamps[middle] <= timeSeconds) low = middle;
    else high = middle - 1;
  }
  return clamp(low, 0, Math.max(0, clip.frameCount - 1));
}

function copyFrame(source: number[], frameIndex: number, valuesPerFrame: number): number[] {
  const start = frameIndex * valuesPerFrame;
  return source.slice(start, start + valuesPerFrame);
}

function normalizedSegment(segment: DanceMotionCompositionSegment): { start: number; end: number } {
  const duration = Math.max(0.01, segment.clip.durationSeconds);
  const start = clamp(Number(segment.trimStartSeconds) || 0, 0, Math.max(0, duration - 0.01));
  const end = clamp(Number(segment.trimEndSeconds) || duration, start + 0.01, duration);
  return { start, end };
}

/** Flatten ordered composition segments into the canonical clip consumed by DanceRenderer. */
export function composeDanceMotion(composition: DanceMotionComposition): DanceMotionClip | null {
  const segments = composition.segments
    .filter((segment) => segment.clip.frameCount > 0 && segment.clip.timestamps.length > 0)
    .slice()
    .sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  const first = segments[0]?.clip;
  if (!first) return null;

  const jointCount = Math.max(1, Math.round(first.jointRotations.length / Math.max(1, first.frameCount * 4)));
  const hasJointPositions = segments.every((segment) => Boolean(segment.clip.jointPositions));
  const timestamps: number[] = [];
  const rootPositions: number[] = [];
  const rootRotations: number[] = [];
  const jointRotations: number[] = [];
  const jointPositions: number[] = [];
  const landmarkConfidence: number[] = [];
  const validJointMask: number[] = [];
  const leftFootContact: number[] = [];
  const rightFootContact: number[] = [];
  const leftToeContact: number[] = [];
  const rightToeContact: number[] = [];
  const segmentMeta: DanceMotionComposition["segments"] = [];
  let frameCount = 0;
  let durationSeconds = 0;

  for (const segment of segments) {
    const clip = segment.clip;
    const range = normalizedSegment(segment);
    const firstFrame = frameIndexForTime(clip, range.start);
    const lastFrame = frameIndexForTime(clip, range.end);
    const startFrame = Math.min(firstFrame, lastFrame);
    const endFrame = Math.max(startFrame, lastFrame);
    const actualOffset = Math.max(0, Number(segment.offsetSeconds) || 0);
    const rootSize = 3;
    const rotationSize = 4;
    const jointRotationSize = jointCount * rotationSize;
    const jointPositionSize = jointCount * 3;
    const segmentStartFrame = frameCount;

    for (let frame = startFrame; frame <= endFrame; frame += 1) {
      const sourceTime = clip.timestamps[frame] ?? range.start;
      const time = actualOffset + Math.max(0, sourceTime - range.start);
      timestamps.push(time);
      rootPositions.push(...copyFrame(clip.rootPositions, frame, rootSize));
      rootRotations.push(...copyFrame(clip.rootRotations, frame, rotationSize));
      jointRotations.push(...copyFrame(clip.jointRotations, frame, jointRotationSize));
      if (hasJointPositions) jointPositions.push(...copyFrame(clip.jointPositions ?? [], frame, jointPositionSize));
      landmarkConfidence.push(...copyFrame(clip.landmarkConfidence ?? [], frame, jointCount));
      validJointMask.push(...copyFrame(clip.validJointMask ?? [], frame, jointCount));
      leftFootContact.push(clip.leftFootContact[frame] ?? 0);
      rightFootContact.push(clip.rightFootContact[frame] ?? 0);
      leftToeContact.push(clip.leftToeContact?.[frame] ?? 0);
      rightToeContact.push(clip.rightToeContact?.[frame] ?? 0);
      frameCount += 1;
      durationSeconds = Math.max(durationSeconds, time);
    }
    segmentMeta.push({
      ...segment,
      offsetSeconds: actualOffset,
      trimStartSeconds: range.start,
      trimEndSeconds: range.end,
    });
    if (segmentStartFrame === frameCount) continue;
  }

  const timestampsRebased = timestamps.map((time, index) => index === 0 ? 0 : Math.max(0, time));
  const frameRate = Math.max(1, first.sourceFrameRate || 30);
  return {
    ...first,
    durationSeconds: Math.max(0.01, durationSeconds),
    sourceFrameRate: frameRate,
    frameCount,
    timestamps: timestampsRebased,
    rootPositions,
    rootRotations,
    jointRotations,
    ...(hasJointPositions ? { jointPositions } : { jointPositions: undefined }),
    landmarkConfidence,
    validJointMask,
    leftFootContact,
    rightFootContact,
    leftToeContact,
    rightToeContact,
    segments: segmentMeta.flatMap((segment) => segment.clip.segments),
  };
}

export function createCompositionSegment(clip: DanceMotionClip, title: string, sourceJobId?: string, offsetSeconds = 0): DanceMotionCompositionSegment {
  return {
    id: `motion-segment-${crypto.randomUUID()}`,
    title,
    sourceJobId,
    clip,
    offsetSeconds,
    trimStartSeconds: 0,
    trimEndSeconds: clip.durationSeconds,
  };
}

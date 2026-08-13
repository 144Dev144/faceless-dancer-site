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

interface MotionPoseFrame {
  rootPosition: number[];
  rootRotation: number[];
  jointRotation: number[];
  jointPosition: number[];
  landmarkConfidence: number[];
  validJointMask: number[];
  leftFootContact: number;
  rightFootContact: number;
  leftToeContact: number;
  rightToeContact: number;
}

function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function mixArray(first: number[], second: number[], amount: number): number[] {
  return first.map((value, index) => mix(value, second[index] ?? value, amount));
}

function slerpQuaternion(first: number[], second: number[], amount: number): number[] {
  let ax = first[0] ?? 0;
  let ay = first[1] ?? 0;
  let az = first[2] ?? 0;
  let aw = first[3] ?? 1;
  let bx = second[0] ?? ax;
  let by = second[1] ?? ay;
  let bz = second[2] ?? az;
  let bw = second[3] ?? aw;
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (dot > 0.9995) {
    const length = Math.hypot(ax + amount * (bx - ax), ay + amount * (by - ay), az + amount * (bz - az), aw + amount * (bw - aw)) || 1;
    return [
      (ax + amount * (bx - ax)) / length,
      (ay + amount * (by - ay)) / length,
      (az + amount * (bz - az)) / length,
      (aw + amount * (bw - aw)) / length,
    ];
  }
  const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
  const sinTheta = Math.sin(theta) || 1;
  const firstWeight = Math.sin((1 - amount) * theta) / sinTheta;
  const secondWeight = Math.sin(amount * theta) / sinTheta;
  return [
    ax * firstWeight + bx * secondWeight,
    ay * firstWeight + by * secondWeight,
    az * firstWeight + bz * secondWeight,
    aw * firstWeight + bw * secondWeight,
  ];
}

function slerpQuaternionArray(first: number[], second: number[], amount: number): number[] {
  const result: number[] = [];
  for (let index = 0; index < Math.max(first.length, second.length); index += 4) {
    result.push(...slerpQuaternion(first.slice(index, index + 4), second.slice(index, index + 4), amount));
  }
  return result;
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
  let previousPose: MotionPoseFrame | null = null;
  let previousTime = 0;
  const frameRate = Math.max(1, first.sourceFrameRate || 30);

  const appendPose = (time: number, pose: MotionPoseFrame) => {
    timestamps.push(time);
    rootPositions.push(...pose.rootPosition);
    rootRotations.push(...pose.rootRotation);
    jointRotations.push(...pose.jointRotation);
    if (hasJointPositions) jointPositions.push(...pose.jointPosition);
    landmarkConfidence.push(...pose.landmarkConfidence);
    validJointMask.push(...pose.validJointMask);
    leftFootContact.push(pose.leftFootContact);
    rightFootContact.push(pose.rightFootContact);
    leftToeContact.push(pose.leftToeContact);
    rightToeContact.push(pose.rightToeContact);
    frameCount += 1;
    durationSeconds = Math.max(durationSeconds, time);
    previousPose = pose;
    previousTime = time;
  };

  const sourcePose = (clip: DanceMotionClip, frame: number, jointRotationSize: number, jointPositionSize: number): MotionPoseFrame => ({
    rootPosition: copyFrame(clip.rootPositions, frame, 3),
    rootRotation: copyFrame(clip.rootRotations, frame, 4),
    jointRotation: copyFrame(clip.jointRotations, frame, jointRotationSize),
    jointPosition: copyFrame(clip.jointPositions ?? [], frame, jointPositionSize),
    landmarkConfidence: copyFrame(clip.landmarkConfidence ?? [], frame, jointCount),
    validJointMask: copyFrame(clip.validJointMask ?? [], frame, jointCount),
    leftFootContact: clip.leftFootContact[frame] ?? 0,
    rightFootContact: clip.rightFootContact[frame] ?? 0,
    leftToeContact: clip.leftToeContact?.[frame] ?? 0,
    rightToeContact: clip.rightToeContact?.[frame] ?? 0,
  });

  for (const segment of segments) {
    const clip = segment.clip;
    const range = normalizedSegment(segment);
    const firstFrame = frameIndexForTime(clip, range.start);
    const lastFrame = frameIndexForTime(clip, range.end);
    const startFrame = Math.min(firstFrame, lastFrame);
    const endFrame = Math.max(startFrame, lastFrame);
    const actualOffset = Math.max(0, Number(segment.offsetSeconds) || 0);
    const rotationSize = 4;
    const jointRotationSize = jointCount * rotationSize;
    const jointPositionSize = jointCount * 3;
    const firstPose = sourcePose(clip, startFrame, jointRotationSize, jointPositionSize);
    const firstOutputTime = actualOffset;
    if (previousPose && firstOutputTime > previousTime) {
      const transitionFrom = previousPose;
      const transitionStart = previousTime;
      const gap = firstOutputTime - previousTime;
      const transitionFrames = Math.max(0, Math.floor(gap * frameRate) - 1);
      for (let transitionFrame = 1; transitionFrame <= transitionFrames; transitionFrame += 1) {
        const amount = transitionFrame / Math.max(1, transitionFrames + 1);
        appendPose(transitionStart + gap * amount, {
          rootPosition: mixArray(transitionFrom.rootPosition, firstPose.rootPosition, amount),
          rootRotation: slerpQuaternionArray(transitionFrom.rootRotation, firstPose.rootRotation, amount),
          jointRotation: slerpQuaternionArray(transitionFrom.jointRotation, firstPose.jointRotation, amount),
          jointPosition: mixArray(transitionFrom.jointPosition, firstPose.jointPosition, amount),
          landmarkConfidence: mixArray(transitionFrom.landmarkConfidence, firstPose.landmarkConfidence, amount),
          validJointMask: firstPose.validJointMask.map(() => 0),
          leftFootContact: 0,
          rightFootContact: 0,
          leftToeContact: 0,
          rightToeContact: 0,
        });
      }
    }

    for (let frame = startFrame; frame <= endFrame; frame += 1) {
      const sourceTime = clip.timestamps[frame] ?? range.start;
      const time = actualOffset + Math.max(0, sourceTime - range.start);
      appendPose(time, sourcePose(clip, frame, jointRotationSize, jointPositionSize));
    }
    segmentMeta.push({
      ...segment,
      offsetSeconds: actualOffset,
      trimStartSeconds: range.start,
      trimEndSeconds: range.end,
    });
  }

  const timestampsRebased = timestamps.map((time, index) => index === 0 ? 0 : Math.max(timestamps[index - 1] + 0.0001, time));
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

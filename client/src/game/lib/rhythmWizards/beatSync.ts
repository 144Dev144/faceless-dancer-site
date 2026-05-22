import { damageBonusByJudgement } from "./balance";
import type { CombatJudgement } from "./types";

export interface BeatSyncWindows {
  perfect: number;
  great: number;
  good: number;
  poor: number;
}

export interface BeatSyncResult {
  judgement: CombatJudgement;
  deltaSeconds: number;
  bonusMultiplier: number;
  aoeRadius: number;
}

function classify(deltaSeconds: number, windows: BeatSyncWindows): CombatJudgement {
  const absolute = Math.abs(deltaSeconds);
  if (absolute <= windows.perfect) return "perfect";
  if (absolute <= windows.great) return "great";
  if (absolute <= windows.good) return "good";
  return "none";
}

export function buildBeatTimelineFromNoteTimes(noteTimes: number[]): number[] {
  const sorted = noteTimes.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const merged: number[] = [];
  const minGap = 0.03;
  for (const beatTime of sorted) {
    const previous = merged[merged.length - 1];
    if (previous === undefined || beatTime - previous > minGap) {
      merged.push(beatTime);
    }
  }
  return merged;
}

export function evaluateBeatSync(
  heardTimeSeconds: number,
  beatTimelineSeconds: number[],
  windows: BeatSyncWindows,
  beatBonusDamageMultiplier: number,
  beatAoeRadius: number
): BeatSyncResult {
  let nearestDelta = Number.POSITIVE_INFINITY;
  for (const beatTime of beatTimelineSeconds) {
    const delta = heardTimeSeconds - beatTime;
    const absolute = Math.abs(delta);
    if (absolute < Math.abs(nearestDelta)) {
      nearestDelta = delta;
    }
    if (beatTime > heardTimeSeconds + windows.poor) {
      break;
    }
  }
  if (!Number.isFinite(nearestDelta)) {
    return { judgement: "none", deltaSeconds: 0, bonusMultiplier: 1, aoeRadius: 0 };
  }
  const judgement = classify(nearestDelta, windows);
  if (judgement === "none") {
    return { judgement, deltaSeconds: nearestDelta, bonusMultiplier: 1, aoeRadius: 0 };
  }
  const bonusUnit = damageBonusByJudgement(judgement);
  return {
    judgement,
    deltaSeconds: nearestDelta,
    bonusMultiplier: 1 + bonusUnit * (beatBonusDamageMultiplier - 1),
    aoeRadius: beatAoeRadius * Math.max(0.42, bonusUnit),
  };
}

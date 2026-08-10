import type { DanceBeat, DanceMoveRole, DanceRuntimeOptions, DanceStyle } from "./types";

export interface MotionDecision {
  role: DanceMoveRole;
  beats: number;
  beatIndex: number;
}

function seededValue(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x45d9f3b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function nearestBeatIndex(beats: DanceBeat[], timeSeconds: number): number {
  let low = 0;
  let high = beats.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (beats[middle].timeSeconds <= timeSeconds + 0.035) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function chooseRole(
  beat: DanceBeat,
  beatIndex: number,
  options: DanceRuntimeOptions,
  recentRoles: DanceMoveRole[]
): DanceMoveRole {
  const random = seededValue(options.seed, beatIndex);
  const strength = Math.max(0, Math.min(1, beat.strength));
  const style = options.style;
  const energetic = options.energy * (0.58 + strength * 0.42);
  const recentlyUsed = (role: DanceMoveRole): boolean => recentRoles.includes(role);

  if (energetic < 0.26 && beatIndex % 4 !== 0) return "groove";
  if (style === "groove" && random < 0.62 && !recentlyUsed("groove")) return "groove";
  if (style === "energetic" && strength > 0.62 && random < 0.7) return "accent";
  if (strength > 0.78 && energetic > 0.52 && random < 0.5) return "accent";
  if (random < 0.5 + options.variety * 0.16 && !recentlyUsed("step")) return "step";
  return "groove";
}

export class MotionGraph {
  private beatIndex = -1;
  private currentRole: DanceMoveRole = "idle";
  private recentRoles: DanceMoveRole[] = [];

  reset(): void {
    this.beatIndex = -1;
    this.currentRole = "idle";
    this.recentRoles = [];
  }

  getCurrentRole(): DanceMoveRole {
    return this.currentRole;
  }

  getBeatIndex(): number {
    return this.beatIndex;
  }

  update(timeSeconds: number, beats: DanceBeat[], options: DanceRuntimeOptions): MotionDecision | null {
    if (beats.length === 0) return null;
    const nextBeatIndex = nearestBeatIndex(beats, timeSeconds);
    if (nextBeatIndex < 0 || nextBeatIndex === this.beatIndex) return null;

    this.beatIndex = nextBeatIndex;
    const beat = beats[nextBeatIndex];
    const role = nextBeatIndex === 0 && options.energy < 0.45
      ? "groove"
      : chooseRole(beat, nextBeatIndex, options, this.recentRoles);
    this.currentRole = role;
    this.recentRoles = [...this.recentRoles, role].slice(-3);
    return { role, beats: role === "accent" ? 1 : role === "step" ? 2 : 4, beatIndex: nextBeatIndex };
  }
}

export function estimateBpm(beats: DanceBeat[], fallback = 120): number {
  if (beats.length < 2) return fallback;
  const intervals = beats
    .slice(1)
    .map((beat, index) => beat.timeSeconds - beats[index].timeSeconds)
    .filter((interval) => interval >= 0.25 && interval <= 2);
  if (!intervals.length) return fallback;
  const average = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  return Math.max(40, Math.min(220, 60 / average));
}

export function styleLabel(style: DanceStyle): string {
  return style === "groove" ? "Groove" : style === "energetic" ? "Energetic" : "Balanced";
}

import type { CanonicalRigProfile } from "./canonicalRigProfile";

export type DanceStyle = "balanced" | "groove" | "energetic";

export type DanceMoveRole = "idle" | "groove" | "step" | "accent";

export type DanceBoneRole =
  | "hips"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "shoulderLeft"
  | "shoulderRight"
  | "upperArmLeft"
  | "upperArmRight"
  | "forearmLeft"
  | "forearmRight"
  | "upperLegLeft"
  | "upperLegRight"
  | "lowerLegLeft"
  | "lowerLegRight"
  | "footLeft"
  | "footRight";

export interface DanceBeat {
  timeSeconds: number;
  strength: number;
}

export interface DanceModelPreset {
  id: string;
  label: string;
  url: string;
  clipNames: Partial<Record<DanceMoveRole, string>>;
  baseClipName?: string;
  source: string;
  manifest?: DanceModelManifest;
}

export interface DanceModelManifest {
  schemaVersion: 1;
  modelId: string;
  label: string;
  skeletonId: "humanoid-v1";
  modelFile: string;
  orientation?: {
    yawRadians: number;
  };
  generatedBy?: {
    meshGenerator?: string;
    rigGenerator?: string;
    sourceImage?: string;
  };
  bones: Partial<Record<DanceBoneRole, string>>;
  requiredBones: DanceBoneRole[];
  canonicalProfile?: CanonicalRigProfile;
}

export interface DanceRuntimeOptions {
  energy: number;
  variety: number;
  bpmScale: number;
  style: DanceStyle;
  liveAccents: boolean;
  reducedQuality: boolean;
  minBeatStrength: number;
  seed: number;
}

export interface DanceRuntimeSnapshot {
  currentMove: DanceMoveRole;
  beatIndex: number;
  beatPhase: number;
  barIndex: number;
  bpm: number;
  modelLabel: string;
  loaded: boolean;
  renderer: string;
  fps: number;
  frameTimeMs: number;
  triangles: number;
  drawCalls: number;
  rigCoverage: number;
  rigWarnings: string[];
}

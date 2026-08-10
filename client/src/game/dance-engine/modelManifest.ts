import type { DanceBoneRole, DanceModelManifest } from "./types";
import { parseCanonicalRigProfile } from "./canonicalRigProfile";

export const REQUIRED_DANCE_BONES: DanceBoneRole[] = [
  "hips",
  "spine",
  "chest",
  "head",
  "upperArmLeft",
  "upperArmRight",
  "forearmLeft",
  "forearmRight",
  "upperLegLeft",
  "upperLegRight",
  "lowerLegLeft",
  "lowerLegRight",
  "footLeft",
  "footRight"
];

const BONE_ROLES = new Set<DanceBoneRole>([
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "shoulderLeft",
  "shoulderRight",
  "upperArmLeft",
  "upperArmRight",
  "forearmLeft",
  "forearmRight",
  "upperLegLeft",
  "upperLegRight",
  "lowerLegLeft",
  "lowerLegRight",
  "footLeft",
  "footRight"
]);

export interface ManifestValidation {
  manifest: DanceModelManifest;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Manifest field "${key}" must be a non-empty string.`);
  return value.trim();
}

export function parseDanceModelManifest(value: unknown): ManifestValidation {
  if (!isRecord(value)) throw new Error("Dance model manifest must be a JSON object.");
  if (value.schemaVersion !== 1) throw new Error("Unsupported dance model manifest version.");
  if (value.skeletonId !== "humanoid-v1") throw new Error("Dance Engine requires skeletonId humanoid-v1.");
  if (!isRecord(value.bones)) throw new Error("Dance model manifest must include a bones map.");

  const bones: Partial<Record<DanceBoneRole, string>> = {};
  for (const [key, boneName] of Object.entries(value.bones)) {
    if (!BONE_ROLES.has(key as DanceBoneRole)) throw new Error(`Unknown dance bone role "${key}".`);
    if (typeof boneName !== "string" || !boneName.trim()) throw new Error(`Bone mapping "${key}" must be a non-empty string.`);
    bones[key as DanceBoneRole] = boneName.trim();
  }

  if (!Array.isArray(value.requiredBones)) throw new Error("Dance model manifest must include requiredBones.");
  const requiredBones = value.requiredBones.map((role) => {
    if (typeof role !== "string" || !BONE_ROLES.has(role as DanceBoneRole)) throw new Error(`Unknown required dance bone role "${String(role)}".`);
    return role as DanceBoneRole;
  });
  const warnings = REQUIRED_DANCE_BONES
    .filter((role) => !requiredBones.includes(role))
    .map((role) => `Recommended bone role is not required: ${role}.`);
  for (const role of requiredBones) {
    if (!bones[role]) warnings.push(`Required bone role has no mapping: ${role}.`);
  }

  let canonicalProfile: DanceModelManifest["canonicalProfile"];
  if (value.canonicalProfile !== undefined) {
    const parsedProfile = parseCanonicalRigProfile(value.canonicalProfile);
    canonicalProfile = parsedProfile.profile;
    warnings.push(...parsedProfile.warnings);
  }

  let orientation: DanceModelManifest["orientation"];
  if (value.orientation !== undefined) {
    if (!isRecord(value.orientation) || typeof value.orientation.yawRadians !== "number" || !Number.isFinite(value.orientation.yawRadians)) {
      throw new Error('Manifest field "orientation.yawRadians" must be a finite number.');
    }
    orientation = { yawRadians: value.orientation.yawRadians };
  }

  return {
    manifest: {
      schemaVersion: 1,
      modelId: requireString(value, "modelId"),
      label: requireString(value, "label"),
      skeletonId: "humanoid-v1",
      modelFile: requireString(value, "modelFile"),
      orientation,
      generatedBy: isRecord(value.generatedBy)
        ? {
          meshGenerator: typeof value.generatedBy.meshGenerator === "string" ? value.generatedBy.meshGenerator : undefined,
          rigGenerator: typeof value.generatedBy.rigGenerator === "string" ? value.generatedBy.rigGenerator : undefined,
          sourceImage: typeof value.generatedBy.sourceImage === "string" ? value.generatedBy.sourceImage : undefined
        }
        : undefined,
      bones,
      requiredBones,
      canonicalProfile
    },
    warnings
  };
}

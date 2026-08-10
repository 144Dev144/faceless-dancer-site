export interface CanonicalJoint {
  parent: string | null;
  position: [number, number, number];
}

export interface CanonicalRigProfile {
  schemaVersion: 1;
  skeletonId: "humanoid-v1";
  meshFile?: string;
  source: {
    mode?: string;
    seedRig?: string | null;
    meshSha256?: string;
  };
  coordinateSystem: {
    up: "Y";
    front: "+Z" | "-Z" | string;
    units: string;
  };
  joints: Record<string, CanonicalJoint>;
  boneLengths: Record<string, number>;
  requiredRoles: string[];
}

export interface CanonicalProfileValidation {
  profile: CanonicalRigProfile;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Canonical profile field "${field}" must be finite.`);
  return value;
}

function cloneJoint(joint: CanonicalJoint): CanonicalJoint {
  return { parent: joint.parent, position: [...joint.position] as [number, number, number] };
}

export function cloneCanonicalRigProfile(profile: CanonicalRigProfile): CanonicalRigProfile {
  return {
    ...profile,
    source: { ...profile.source },
    coordinateSystem: { ...profile.coordinateSystem },
    joints: Object.fromEntries(Object.entries(profile.joints).map(([name, joint]) => [name, cloneJoint(joint)])),
    boneLengths: { ...profile.boneLengths },
    requiredRoles: [...profile.requiredRoles]
  };
}

export function parseCanonicalRigProfile(value: unknown): CanonicalProfileValidation {
  if (!isRecord(value)) throw new Error("Canonical profile must be a JSON object.");
  // Worker output is a manifest wrapper with the editable profile under
  // `canonicalProfile`; standalone profile exports contain these fields at
  // the top level. Accept both existing formats without changing the worker
  // contract.
  const profile = isRecord(value.canonicalProfile) ? value.canonicalProfile : value;
  if (profile.schemaVersion !== 1) throw new Error("Unsupported canonical profile version.");
  if (profile.skeletonId !== "humanoid-v1") throw new Error("Canonical profile requires skeletonId humanoid-v1.");
  const meshFile = typeof profile.meshFile === "string" && profile.meshFile.trim() ? profile.meshFile.trim() : undefined;
  if (!isRecord(profile.coordinateSystem)) throw new Error("Canonical profile must include coordinateSystem.");
  if (profile.coordinateSystem.up !== "Y") throw new Error("Canonical profile must use Y-up coordinates.");
  if (typeof profile.coordinateSystem.front !== "string" || typeof profile.coordinateSystem.units !== "string") {
    throw new Error("Canonical profile coordinateSystem is incomplete.");
  }
  if (!isRecord(profile.joints) || !Object.keys(profile.joints).length) throw new Error("Canonical profile must include joints.");

  const joints: Record<string, CanonicalJoint> = {};
  for (const [name, rawJoint] of Object.entries(profile.joints)) {
    if (!isRecord(rawJoint)) throw new Error(`Canonical joint "${name}" must be an object.`);
    const parent = rawJoint.parent === null ? null : rawJoint.parent;
    if (parent !== null && (typeof parent !== "string" || !parent.trim())) throw new Error(`Canonical joint "${name}" has an invalid parent.`);
    if (!Array.isArray(rawJoint.position) || rawJoint.position.length !== 3) throw new Error(`Canonical joint "${name}" must have a 3D position.`);
    const position = rawJoint.position.map((component, index) => finiteNumber(component, `joints.${name}.position[${index}]`)) as [number, number, number];
    joints[name] = { parent: parent as string | null, position };
  }

  const warnings: string[] = [];
  const rootNames = Object.entries(joints).filter(([, joint]) => joint.parent === null).map(([name]) => name);
  if (rootNames.length !== 1) warnings.push(`Expected one root joint; found ${rootNames.length}.`);
  for (const [name, joint] of Object.entries(joints)) {
    if (joint.parent && !joints[joint.parent]) warnings.push(`Joint "${name}" references missing parent "${joint.parent}".`);
  }

  const boneLengths: Record<string, number> = {};
  if (profile.boneLengths !== undefined) {
    if (!isRecord(profile.boneLengths)) throw new Error("Canonical profile boneLengths must be an object.");
    for (const [name, length] of Object.entries(profile.boneLengths)) {
      const parsedLength = finiteNumber(length, `boneLengths.${name}`);
      if (parsedLength <= 0) warnings.push(`Bone length for "${name}" is not positive.`);
      boneLengths[name] = parsedLength;
    }
  }

  const requiredRoles = profile.requiredRoles === undefined
    ? []
    : Array.isArray(profile.requiredRoles) && profile.requiredRoles.every((role) => typeof role === "string")
      ? profile.requiredRoles as string[]
      : (() => { throw new Error("Canonical profile requiredRoles must be an array of strings."); })();

  return {
    profile: {
      schemaVersion: 1,
      skeletonId: "humanoid-v1",
      ...(meshFile ? { meshFile } : {}),
      source: isRecord(profile.source)
        ? {
          mode: typeof profile.source.mode === "string" ? profile.source.mode : undefined,
          seedRig: profile.source.seedRig === null || typeof profile.source.seedRig === "string" ? profile.source.seedRig : undefined,
          meshSha256: typeof profile.source.meshSha256 === "string" ? profile.source.meshSha256 : undefined
        }
        : {},
      coordinateSystem: {
        up: "Y",
        front: profile.coordinateSystem.front,
        units: profile.coordinateSystem.units
      },
      joints,
      boneLengths,
      requiredRoles
    },
    warnings
  };
}

export function getCanonicalChildren(profile: CanonicalRigProfile, jointName: string): string[] {
  return Object.entries(profile.joints)
    .filter(([, joint]) => joint.parent === jointName)
    .map(([name]) => name);
}

export function getCanonicalDescendants(profile: CanonicalRigProfile, jointName: string): string[] {
  const descendants: string[] = [];
  const pending = [...getCanonicalChildren(profile, jointName)];
  while (pending.length) {
    const next = pending.shift();
    if (!next) continue;
    descendants.push(next);
    pending.push(...getCanonicalChildren(profile, next));
  }
  return descendants;
}

function translateSubtree(profile: CanonicalRigProfile, jointName: string, delta: [number, number, number]): void {
  for (const name of [jointName, ...getCanonicalDescendants(profile, jointName)]) {
    const position = profile.joints[name]?.position;
    if (!position) continue;
    position[0] += delta[0];
    position[1] += delta[1];
    position[2] += delta[2];
  }
}

export function moveCanonicalJoint(profile: CanonicalRigProfile, jointName: string, x: number, y: number): CanonicalRigProfile {
  const next = cloneCanonicalRigProfile(profile);
  const joint = next.joints[jointName];
  if (!joint || !Number.isFinite(x) || !Number.isFinite(y)) return next;
  const delta: [number, number, number] = [x - joint.position[0], y - joint.position[1], 0];
  translateSubtree(next, jointName, delta);
  return next;
}

export function setCanonicalBoneLength(profile: CanonicalRigProfile, jointName: string, length: number): CanonicalRigProfile {
  const next = cloneCanonicalRigProfile(profile);
  const parent = next.joints[jointName];
  const childName = getCanonicalChildren(next, jointName)[0];
  const child = childName ? next.joints[childName] : undefined;
  if (!parent || !child || !Number.isFinite(length) || length <= 0) return next;

  const dx = child.position[0] - parent.position[0];
  const dy = child.position[1] - parent.position[1];
  const dz = child.position[2] - parent.position[2];
  const currentLength = Math.hypot(dx, dy, dz);
  if (currentLength < 0.000001) return next;
  const target = [parent.position[0] + (dx / currentLength) * length, parent.position[1] + (dy / currentLength) * length, parent.position[2] + (dz / currentLength) * length] as [number, number, number];
  const delta: [number, number, number] = [target[0] - child.position[0], target[1] - child.position[1], target[2] - child.position[2]];
  translateSubtree(next, childName!, delta);
  next.boneLengths[jointName] = length;
  return next;
}

export function getCanonicalBoneLength(profile: CanonicalRigProfile, jointName: string): number | null {
  const childName = getCanonicalChildren(profile, jointName)[0];
  const parent = profile.joints[jointName];
  const child = childName ? profile.joints[childName] : undefined;
  if (!parent || !child) return null;
  return Math.hypot(child.position[0] - parent.position[0], child.position[1] - parent.position[1], child.position[2] - parent.position[2]);
}

export function getCanonicalProfileBounds(profile: CanonicalRigProfile): { minX: number; maxX: number; minY: number; maxY: number } {
  const positions = Object.values(profile.joints).map((joint) => joint.position);
  if (!positions.length) return { minX: -0.5, maxX: 0.5, minY: 0, maxY: 1 };
  return {
    minX: Math.min(...positions.map((position) => position[0])),
    maxX: Math.max(...positions.map((position) => position[0])),
    minY: Math.min(...positions.map((position) => position[1])),
    maxY: Math.max(...positions.map((position) => position[1]))
  };
}

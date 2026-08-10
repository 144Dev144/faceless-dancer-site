import * as THREE from "three";
import type { DanceBeat, DanceMoveRole, DanceRuntimeOptions } from "./types";

export interface DanceRig {
  root: THREE.Object3D;
  body: THREE.Object3D | null;
  hips: THREE.Object3D | null;
  spine: THREE.Object3D | null;
  chest: THREE.Object3D | null;
  neck: THREE.Object3D | null;
  head: THREE.Object3D | null;
  shoulderLeft: THREE.Object3D | null;
  shoulderRight: THREE.Object3D | null;
  upperArmLeft: THREE.Object3D | null;
  upperArmRight: THREE.Object3D | null;
  forearmLeft: THREE.Object3D | null;
  forearmRight: THREE.Object3D | null;
  upperLegLeft: THREE.Object3D | null;
  upperLegRight: THREE.Object3D | null;
  lowerLegLeft: THREE.Object3D | null;
  lowerLegRight: THREE.Object3D | null;
  footLeft: THREE.Object3D | null;
  footRight: THREE.Object3D | null;
}

interface ImpulseState {
  bounce: number;
  sway: number;
  step: number;
  arms: number;
  head: number;
  side: number;
}

const TAU = Math.PI * 2;
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function easeInOut(value: number): number {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function positiveWave(phase: number): number {
  return easeInOut(Math.max(0, Math.sin(phase)));
}

function negativeWave(phase: number): number {
  return easeInOut(Math.max(0, -Math.sin(phase)));
}

function uniqueBones(rig: DanceRig): THREE.Object3D[] {
  return [...new Set(Object.values(rig).filter((bone): bone is THREE.Object3D => Boolean(bone)))];
}

export class ProceduralDanceMotion {
  private readonly bones: THREE.Object3D[];
  private readonly basePose = new Map<THREE.Object3D, { position: THREE.Vector3; quaternion: THREE.Quaternion }>();
  private readonly impulse: ImpulseState = { bounce: 0, sway: 0, step: 0, arms: 0, head: 0, side: 1 };
  private lastTime = 0;

  constructor(private readonly rig: DanceRig) {
    this.bones = uniqueBones(rig);
  }

  reset(): void {
    this.basePose.clear();
    this.impulse.bounce = 0;
    this.impulse.sway = 0;
    this.impulse.step = 0;
    this.impulse.arms = 0;
    this.impulse.head = 0;
    this.impulse.side = 1;
    this.lastTime = 0;
  }

  restoreBasePose(): void {
    for (const bone of this.bones) {
      const pose = this.basePose.get(bone);
      if (!pose) continue;
      bone.position.copy(pose.position);
      bone.quaternion.copy(pose.quaternion);
    }
  }

  captureBasePose(): void {
    for (const bone of this.bones) {
      const pose = this.basePose.get(bone);
      if (pose) {
        pose.position.copy(bone.position);
        pose.quaternion.copy(bone.quaternion);
      } else {
        this.basePose.set(bone, {
          position: bone.position.clone(),
          quaternion: bone.quaternion.clone()
        });
      }
    }
  }

  triggerBeat(beat: DanceBeat, beatIndex: number, role: DanceMoveRole, options: DanceRuntimeOptions): void {
    if (!options.liveAccents) return;
    const strength = clamp(beat.strength, 0.15, 1) * (0.55 + options.energy * 0.45);
    this.impulse.side = beatIndex % 2 === 0 ? 1 : -1;
    this.impulse.bounce = Math.max(this.impulse.bounce, strength);
    this.impulse.sway = Math.max(this.impulse.sway, strength * (role === "accent" ? 1.15 : 0.78));
    this.impulse.step = Math.max(this.impulse.step, strength * (role === "step" ? 1.2 : 0.82));
    this.impulse.arms = Math.max(this.impulse.arms, strength * (role === "accent" ? 1.25 : 0.62));
    this.impulse.head = Math.max(this.impulse.head, strength * 0.72);
  }

  apply(timeSeconds: number, bpm: number, options: DanceRuntimeOptions): void {
    if (!this.basePose.size) return;
    const delta = this.lastTime > 0 ? clamp(timeSeconds - this.lastTime, 0, 0.12) : 0;
    const decay = Math.exp(-delta / 0.34);
    this.impulse.bounce *= decay;
    this.impulse.sway *= decay;
    this.impulse.step *= decay;
    this.impulse.arms *= decay;
    this.impulse.head *= decay;
    this.lastTime = timeSeconds;

    const beatPhase = timeSeconds * bpm / 60 * TAU;
    const barPhase = beatPhase / 4;
    const energy = clamp(options.energy, 0, 1);
    const styleMultiplier = options.style === "groove" ? 0.82 : options.style === "energetic" ? 1.22 : 1;
    const stepAmplitude = (0.65 + energy * 0.35) * styleMultiplier;
    const stepStrength = (0.42 + this.impulse.step * 0.58) * stepAmplitude;
    const leftLift = positiveWave(beatPhase) * stepStrength;
    const rightLift = negativeWave(beatPhase) * stepStrength;
    const continuousSway = Math.sin(beatPhase) * 0.045 * stepAmplitude;
    const impulseSway = this.impulse.sway * 0.07 * this.impulse.side;
    const hipSway = continuousSway + impulseSway;
    const delayedTorso = Math.sin(beatPhase - 0.7) * 0.032 * stepAmplitude;
    const delayedArms = Math.sin(beatPhase - 1.05) * 0.2 * stepAmplitude;
    const armRiseCycle = Math.max(0, Math.sin(barPhase - 0.9));
    const armRise = armRiseCycle * (0.09 + this.impulse.arms * 0.48) * (options.style === "energetic" ? 0.7 : 0.42);
    const bounce = (Math.max(0, Math.sin(beatPhase * 2)) * 0.014 + this.impulse.bounce * 0.028) * energy;
    const headFollow = Math.sin(beatPhase - 1.35) * 0.055 * stepAmplitude + this.impulse.head * 0.038 * this.impulse.side;

    this.translate(this.rig.root, Math.sin(beatPhase) * 0.035 * stepAmplitude, bounce, 0);
    this.rotate(this.rig.hips, AXIS_Z, hipSway);
    this.rotate(this.rig.hips, AXIS_Y, Math.sin(beatPhase - 0.35) * 0.035 * stepAmplitude);
    this.rotate(this.rig.spine, AXIS_Z, -hipSway * 0.48);
    this.rotate(this.rig.spine, AXIS_Y, delayedTorso * 0.8);
    this.rotate(this.rig.chest, AXIS_Z, -delayedTorso);
    this.rotate(this.rig.chest, AXIS_Y, delayedTorso * 1.25);
    this.rotate(this.rig.head, AXIS_Y, headFollow);
    this.rotate(this.rig.head, AXIS_Z, Math.sin(beatPhase - 1.8) * 0.025 * stepAmplitude);

    this.rotate(this.rig.upperLegLeft, AXIS_X, -leftLift * 0.42);
    this.rotate(this.rig.lowerLegLeft, AXIS_X, leftLift * 0.66);
    this.rotate(this.rig.footLeft, AXIS_X, -leftLift * 0.22);
    this.rotate(this.rig.upperLegRight, AXIS_X, -rightLift * 0.42);
    this.rotate(this.rig.lowerLegRight, AXIS_X, rightLift * 0.66);
    this.rotate(this.rig.footRight, AXIS_X, -rightLift * 0.22);

    const leftArm = delayedArms + armRise * this.impulse.side;
    const rightArm = -delayedArms - armRise * this.impulse.side;
    this.rotate(this.rig.shoulderLeft, AXIS_Z, leftArm * 0.18);
    this.rotate(this.rig.shoulderRight, AXIS_Z, rightArm * 0.18);
    this.rotate(this.rig.upperArmLeft, AXIS_Z, leftArm);
    this.rotate(this.rig.upperArmRight, AXIS_Z, rightArm);
    this.rotate(this.rig.forearmLeft, AXIS_X, Math.sin(beatPhase - 1.55) * 0.13 * stepAmplitude + armRise * 0.18);
    this.rotate(this.rig.forearmRight, AXIS_X, -Math.sin(beatPhase - 1.55) * 0.13 * stepAmplitude - armRise * 0.18);
  }

  private rotate(bone: THREE.Object3D | null, axis: THREE.Vector3, angle: number): void {
    if (!bone || !this.basePose.has(bone)) return;
    const base = this.basePose.get(bone)!;
    bone.quaternion.copy(base.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(axis, clamp(angle, -0.65, 0.65)));
  }

  private translate(bone: THREE.Object3D | null, x: number, y: number, z: number): void {
    if (!bone || !this.basePose.has(bone)) return;
    const base = this.basePose.get(bone)!;
    bone.position.set(base.position.x + x, base.position.y + y, base.position.z + z);
  }
}

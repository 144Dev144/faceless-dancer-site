import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MotionGraph } from "./motionGraph";
import { ProceduralDanceMotion, type DanceRig } from "./proceduralDanceMotion";
import { CapturedMotionRetargeter } from "./capturedMotionRetargeter";
import { REQUIRED_DANCE_BONES } from "./modelManifest";
import type { DanceMotionClip } from "@faceless/shared";
import type {
  DanceBeat,
  DanceBoneRole,
  DanceModelPreset,
  DanceRuntimeOptions,
  DanceRuntimeSnapshot,
} from "./types";

const DEFAULT_BPM = 120;
const MODEL_HEIGHT = 2.15;
const FRAME_INTERVAL_MS = 1000 / 30;
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function findBone(
  root: THREE.Object3D,
  patterns: RegExp[],
  side?: "left" | "right",
  excludedPatterns: RegExp[] = []
): THREE.Object3D | null {
  const candidates: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (!(object as THREE.Bone).isBone) return;
    const name = object.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const roleName = name.replace(/(?:left|right|[lr])$/, "");
    if (side) {
      const isLeft = name.includes("left") || name.endsWith("l");
      const isRight = name.includes("right") || name.endsWith("r");
      if (side === "left" ? !isLeft : !isRight) return;
    }
    if (excludedPatterns.some((pattern) => pattern.test(roleName))) return;
    if (patterns.some((pattern) => pattern.test(roleName))) candidates.push(object);
  });
  return candidates.sort((a, b) => boneScore(b) - boneScore(a))[0] ?? null;
}

function findMappedBone(root: THREE.Object3D, preset: DanceModelPreset, role: DanceBoneRole, fallback: THREE.Object3D | null): THREE.Object3D | null {
  const mappedName = preset.manifest?.bones[role];
  if (!mappedName) return fallback;
  let mapped: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (mapped || object.name !== mappedName) return;
    if ((object as THREE.Bone).isBone) mapped = object;
  });
  return mapped ?? fallback;
}

function findTorsoBones(root: THREE.Object3D): { spine: THREE.Object3D | null; chest: THREE.Object3D | null } {
  const bones: THREE.Object3D[] = [];
  root.traverse((object) => {
    if ((object as THREE.Bone).isBone) bones.push(object);
  });
  const normalized = (bone: THREE.Object3D) => bone.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const candidates = bones.filter((bone) => {
    const name = normalized(bone);
    return /(spine|abdomen|chest|torso)[0-9]*$/.test(name);
  });
  const exact = (names: string[]) => candidates.find((bone) => {
    const name = normalized(bone);
    return names.some((suffix) => name.endsWith(suffix));
  }) ?? null;
  const spine = exact(["spine", "abdomen", "spine0", "spine01"]);
  const chest = exact(["chest", "torso", "spine2", "spine02", "spine3", "spine03"])
    ?? [...candidates].reverse().find((bone) => bone !== spine)
    ?? (spine?.children.find((child) => (child as THREE.Bone).isBone) ?? null);
  return { spine, chest };
}

function boneScore(bone: THREE.Object3D): number {
  const name = bone.name.toLowerCase();
  let score = bone.children.length;
  if (bone.children.some((child) => child.name.toLowerCase().match(/head|neck|shoulder|upperarm|lowerarm|upperleg|lowerleg|abdomen/))) score += 5;
  if (name.match(/end|poletarget|target|control|helper/)) score -= 10;
  return score;
}

function disposeMaterial(material: THREE.Material): void {
  material.dispose();
  for (const value of Object.values(material)) {
    if (value && typeof value === "object" && "isTexture" in value && value.isTexture) {
      (value as THREE.Texture).dispose();
    }
  }
}

function disposeObjectResources(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => disposeMaterial(material));
  });
}

export class DanceRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
  private readonly avatarGroup = new THREE.Group();
  private readonly motionGraph = new MotionGraph();
  private readonly loader = new GLTFLoader();
  private readonly ambientLight = new THREE.HemisphereLight(0x8bc9ff, 0x0e1020, 1.7);
  private readonly keyLight = new THREE.DirectionalLight(0xffe5c4, 2.2);
  private mixer: THREE.AnimationMixer | null = null;
  private root: THREE.Object3D | null = null;
  private clips = new Map<string, THREE.AnimationClip>();
  private activeAction: THREE.AnimationAction | null = null;
  private proceduralMotion: ProceduralDanceMotion | null = null;
  private capturedMotionRetargeter: CapturedMotionRetargeter | null = null;
  private capturedMotion: DanceMotionClip | null = null;
  private capturedMotionEnabled = false;
  private lastSongTime = 0;
  private lastFrameAt = 0;
  private fps = 0;
  private frameTimeMs = 0;
  private modelLabel = "Loading model";
  private rigCoverage = 0;
  private rigWarnings: string[] = [];
  private reducedQuality = false;
  private loaded = false;
  private loadGeneration = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: false
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    this.renderer.setClearColor(0x000000, 0);

    this.scene.add(this.ambientLight);
    this.keyLight.position.set(2.5, 4, 4);
    this.scene.add(this.keyLight);
    this.scene.add(this.avatarGroup);
    this.camera.position.set(0, 1.18, 4.7);
    this.camera.lookAt(0, 1.03, 0);
    this.resize();
  }

  async loadModel(preset: DanceModelPreset): Promise<void> {
    const loadGeneration = ++this.loadGeneration;
    this.loaded = false;
    this.modelLabel = `Loading ${preset.label}`;
    this.disposeAvatar();
    this.motionGraph.reset();
    this.lastSongTime = 0;
    const gltf = await this.loader.loadAsync(preset.url);
    if (loadGeneration !== this.loadGeneration) {
      // A previous request can finish after a newer model was selected. Do
      // not attach that stale avatar to the shared scene.
      disposeObjectResources(gltf.scene);
      return;
    }
    const root = gltf.scene;
    const yawRadians = preset.manifest?.orientation?.yawRadians ?? 0;
    if (yawRadians !== 0) root.rotation.y += yawRadians;
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const scale = size.y > 0 ? MODEL_HEIGHT / size.y : 1;
    root.scale.setScalar(scale);
    box.setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.y -= box.min.y;
    root.position.z -= center.z;
    this.avatarGroup.add(root);
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
    const torso = findTorsoBones(root);
    const heuristicRig: Record<DanceBoneRole, THREE.Object3D | null> = {
      hips: findBone(root, [/hips$/, /pelvis$/]),
      spine: torso.spine,
      chest: torso.chest,
      neck: findBone(root, [/neck$/]),
      head: findBone(root, [/head$/]),
      shoulderLeft: findBone(root, [/shoulder$/], "left"),
      shoulderRight: findBone(root, [/shoulder$/], "right"),
      upperArmLeft: findBone(root, [/upperarm$/, /arm$/], "left", [/forearm$/, /lowerarm$/]),
      upperArmRight: findBone(root, [/upperarm$/, /arm$/], "right", [/forearm$/, /lowerarm$/]),
      forearmLeft: findBone(root, [/lowerarm$/, /forearm$/], "left"),
      forearmRight: findBone(root, [/lowerarm$/, /forearm$/], "right"),
      upperLegLeft: findBone(root, [/upperleg$/, /upleg$/, /thigh$/], "left"),
      upperLegRight: findBone(root, [/upperleg$/, /upleg$/, /thigh$/], "right"),
      lowerLegLeft: findBone(root, [/lowerleg$/, /calf$/, /shin$/, /leg$/], "left", [/upperleg$/, /upleg$/]),
      lowerLegRight: findBone(root, [/lowerleg$/, /calf$/, /shin$/, /leg$/], "right", [/upperleg$/, /upleg$/]),
      footLeft: findBone(root, [/foot$/, /ankle$/], "left"),
      footRight: findBone(root, [/foot$/, /ankle$/], "right")
    };
    const mappedRig = Object.fromEntries(
      Object.entries(heuristicRig).map(([role, fallback]) => [role, findMappedBone(root, preset, role as DanceBoneRole, fallback)])
    ) as Record<DanceBoneRole, THREE.Object3D | null>;
    const mappedRequired = (preset.manifest?.requiredBones ?? REQUIRED_DANCE_BONES).filter((role) => Boolean(mappedRig[role]));
    this.rigCoverage = mappedRequired.length / Math.max(1, (preset.manifest?.requiredBones ?? REQUIRED_DANCE_BONES).length);
    this.rigWarnings = [];
    if (!preset.manifest) this.rigWarnings.push("No model manifest supplied; using bone-name heuristics.");
    for (const role of (preset.manifest?.requiredBones ?? REQUIRED_DANCE_BONES)) {
      if (!mappedRig[role]) this.rigWarnings.push(`Missing required bone: ${role}.`);
    }
    const rig: DanceRig = {
      root: this.avatarGroup,
      body: findBone(root, [/body$/]),
      hips: mappedRig.hips,
      spine: mappedRig.spine,
      chest: mappedRig.chest,
      neck: mappedRig.neck,
      head: mappedRig.head,
      shoulderLeft: mappedRig.shoulderLeft,
      shoulderRight: mappedRig.shoulderRight,
      upperArmLeft: mappedRig.upperArmLeft,
      upperArmRight: mappedRig.upperArmRight,
      forearmLeft: mappedRig.forearmLeft,
      forearmRight: mappedRig.forearmRight,
      upperLegLeft: mappedRig.upperLegLeft,
      upperLegRight: mappedRig.upperLegRight,
      lowerLegLeft: mappedRig.lowerLegLeft,
      lowerLegRight: mappedRig.lowerLegRight,
      footLeft: mappedRig.footLeft,
      footRight: mappedRig.footRight
    };
    this.proceduralMotion = new ProceduralDanceMotion(rig);
    this.startBaseAnimation(preset);
    this.proceduralMotion.captureBasePose();
    this.capturedMotionRetargeter = new CapturedMotionRetargeter(rig);
    this.capturedMotionRetargeter.setClip(this.capturedMotion);
    this.modelLabel = preset.label;
    this.loaded = true;
  }

  setCapturedMotion(clip: DanceMotionClip | null): void {
    this.capturedMotion = clip;
    this.capturedMotionRetargeter?.setClip(clip);
  }

  setCapturedMotionEnabled(enabled: boolean): void {
    this.capturedMotionEnabled = enabled && Boolean(this.capturedMotion);
  }

  update(
    songTime: number,
    isPlaying: boolean,
    bpm: number,
    beats: DanceBeat[],
    options: DanceRuntimeOptions,
    preset: DanceModelPreset
  ): DanceRuntimeSnapshot {
    const safeTime = Math.max(0, songTime);
    const effectiveBpm = clamp(bpm * options.bpmScale, 40, 240);
    const decision = this.motionGraph.update(safeTime, beats, options);
    if (decision && this.proceduralMotion) {
      const beat = beats[decision.beatIndex];
      if (beat) this.proceduralMotion.triggerBeat(beat, decision.beatIndex, decision.role, options);
    }

    const jumped = Math.abs(safeTime - this.lastSongTime) > 0.45;
    const capturedApplied = this.capturedMotionEnabled && this.capturedMotionRetargeter?.apply(safeTime);
    if (!capturedApplied) {
      this.capturedMotionRetargeter?.restoreRestPose();
      this.proceduralMotion?.restoreBasePose();
      if (this.mixer && this.activeAction) {
        if (jumped) this.mixer.setTime(0);
        this.activeAction.setEffectiveTimeScale(clamp(effectiveBpm / DEFAULT_BPM, 0.75, 1.25));
        const delta = isPlaying ? clamp(safeTime - this.lastSongTime, 0, 0.12) : 0;
        if (delta > 0) this.mixer.update(delta);
        if (!isPlaying && jumped) this.mixer.update(0);
      }
      this.proceduralMotion?.captureBasePose();
      this.proceduralMotion?.apply(safeTime, effectiveBpm, options);
    }
    this.lastSongTime = safeTime;

    const now = performance.now();
    const elapsed = this.lastFrameAt > 0 ? now - this.lastFrameAt : FRAME_INTERVAL_MS;
    this.frameTimeMs = elapsed;
    this.fps = elapsed > 0 ? 1000 / elapsed : 0;
    if (now - this.lastFrameAt >= FRAME_INTERVAL_MS || !this.lastFrameAt) {
      this.renderer.render(this.scene, this.camera);
      this.lastFrameAt = now;
    }

    const beatIndex = this.motionGraph.getBeatIndex();
    const beat = beatIndex >= 0 ? beats[beatIndex] : null;
    const beatLength = beatIndex >= 0 && beats[beatIndex + 1]
      ? Math.max(0.25, beats[beatIndex + 1].timeSeconds - beat!.timeSeconds)
      : 60 / effectiveBpm;
    const beatPhase = beat ? clamp((safeTime - beat.timeSeconds) / beatLength, 0, 1) : 0;
    const info = this.renderer.info.render;
    return {
      currentMove: this.motionGraph.getCurrentRole(),
      beatIndex,
      beatPhase,
      barIndex: beatIndex >= 0 ? Math.floor(beatIndex / 4) : 0,
      bpm: effectiveBpm,
      modelLabel: this.modelLabel,
      loaded: this.loaded,
      renderer: "WebGL2",
      fps: this.fps,
      frameTimeMs: this.frameTimeMs,
      triangles: info.triangles,
      drawCalls: info.calls,
      rigCoverage: this.rigCoverage,
      rigWarnings: this.rigWarnings
    };
  }

  resize(): void {
    const width = Math.max(1, this.canvas.clientWidth || this.canvas.width || 1);
    const height = Math.max(1, this.canvas.clientHeight || this.canvas.height || 1);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.reducedQuality ? 0.85 : 1.25);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  setQuality(reduced: boolean): void {
    if (this.reducedQuality === reduced) return;
    this.reducedQuality = reduced;
    this.resize();
  }

  dispose(): void {
    this.loadGeneration += 1;
    this.disposeAvatar();
    this.renderer.dispose();
    this.scene.clear();
  }

  private startBaseAnimation(preset: DanceModelPreset): void {
    if (!this.mixer) return;
    const clipName = preset.baseClipName || preset.clipNames.idle;
    if (!clipName) return;
    const clip = this.clips.get(clipName) || this.clips.get(preset.clipNames.idle || "");
    if (!clip) return;
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.play();
    this.activeAction = action;
  }

  private disposeAvatar(): void {
    if (!this.root) return;
    this.mixer?.stopAllAction();
    disposeObjectResources(this.root);
    this.avatarGroup.remove(this.root);
    this.root = null;
    this.mixer = null;
    this.activeAction = null;
    this.clips.clear();
    this.proceduralMotion = null;
    this.capturedMotionRetargeter = null;
  }
}

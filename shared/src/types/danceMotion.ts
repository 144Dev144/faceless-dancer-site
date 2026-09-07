export type DanceMotionRegion =
  | "full-body"
  | "lower-body"
  | "hips"
  | "torso"
  | "left-arm"
  | "right-arm"
  | "head"
  | "hands";

export interface SkeletonJointDefinition {
  id: string;
  parentId: string | null;
  region: DanceMotionRegion;
  optional?: boolean;
}

export interface SkeletonDefinition {
  id: string;
  version: number;
  label: string;
  coordinateSystem: "right-handed-y-up";
  joints: SkeletonJointDefinition[];
}

export interface DanceMotionSourceMetadata {
  fileName: string;
  mimeType: string;
  captureMethod: "video" | "bvh" | "gltf" | "vrma" | "live-camera" | "unknown";
  estimator?: string;
  estimatorVersion?: string;
  processingVersion: string;
  createdAt: string;
  license?: string;
}

export interface DanceMotionNormalization {
  scale: number;
  rotationYRadians: number;
  rootOffset: [number, number, number];
  rootAnchor?: "initial-hip" | "legacy-frame-origin";
  rootTranslationSource?: "image-space-hip-tracking" | "none";
  /** Canonical lateral convention used by jointPositions and rootPositions. */
  lateralAxis?: "left-negative" | "right-negative";
  /** Canonical depth convention used by jointPositions and rootPositions. */
  depthConvention?: "front-positive" | "mediapipe-world-z";
  sourceCoordinateSystem: string;
  targetCoordinateSystem: "right-handed-y-up";
}

export interface MotionSegment {
  id: string;
  region: DanceMotionRegion;
  startSeconds: number;
  endSeconds: number;
  label?: string;
  energy: number;
  confidence: number;
}

export interface DanceMotionClip {
  format: "faceless-dance-motion";
  version: 1;
  skeletonId: string;
  durationSeconds: number;
  sourceFrameRate: number;
  frameCount: number;
  timestamps: number[];
  rootPositions: number[];
  rootRotations: number[];
  jointRotations: number[];
  jointPositions?: number[];
  landmarkConfidence?: number[];
  validJointMask?: number[];
  leftFootContact: number[];
  rightFootContact: number[];
  leftToeContact?: number[];
  rightToeContact?: number[];
  beatTimes?: number[];
  downbeatTimes?: number[];
  segments: MotionSegment[];
  normalization: DanceMotionNormalization;
  sourceMetadata: DanceMotionSourceMetadata;
}

export interface DanceMotionCompositionSegment {
  id: string;
  title: string;
  sourceJobId?: string;
  clip: DanceMotionClip;
  offsetSeconds: number;
  trimStartSeconds: number;
  trimEndSeconds: number;
}

export interface DanceMotionComposition {
  format: "faceless-dance-composition";
  version: 1;
  title: string;
  durationSeconds: number;
  segments: DanceMotionCompositionSegment[];
  audioSource?: {
    url: string;
    fileName?: string;
    mimeType?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface GenerativeDancePlacement {
  translateX: number;
  translateY: number;
  scale: number;
  rotationDegrees: number;
}

export const GENERATIVE_DANCE_MAX_DURATION_SECONDS = 12;

export interface GenerativeDanceBoundary {
  timeSeconds: number;
  anchor: [number, number];
  subjectBounds: [number, number, number, number];
  footFloor: number;
  confidence: number;
}

export interface GenerativeDanceWindow {
  index: number;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  timelineStartSeconds: number;
  timelineEndSeconds: number;
  startBoundary?: GenerativeDanceBoundary;
  endBoundary?: GenerativeDanceBoundary;
}

export interface GenerativeDanceSequenceSegment {
  id: string;
  inputId: string;
  title: string;
  prompt: string;
  sourceStartSeconds: number;
  sourceEndSeconds: number;
  timelineStartSeconds: number;
  timelineEndSeconds: number;
  placement: GenerativeDancePlacement;
  anchor: [number, number];
  subjectBounds: [number, number, number, number];
  startBoundary?: GenerativeDanceBoundary;
  endBoundary?: GenerativeDanceBoundary;
  windows: GenerativeDanceWindow[];
}

export interface GenerativeDanceSequence {
  format: "faceless-generative-dance-sequence";
  version: 1;
  fps: number;
  maxFramesPerGeneration: number;
  canvas: {
    width: number;
    height: number;
    anchorSemantic: "pelvis";
    anchorX: number;
    anchorY: number;
    floorY: number;
  };
  durationSeconds: number;
  segments: GenerativeDanceSequenceSegment[];
}

export interface DanceMotionJobArtifact {
  kind: "source-video" | "raw-pose" | "filtered-pose" | "depth-resolved-pose" | "canonical-motion" | "wireframe-video" | "diagnostics";
  url: string;
  fileName: string;
  contentType: string;
  sizeBytes?: number;
}

export type DanceMotionJobStatus =
  | "uploaded"
  | "processing"
  | "completed"
  | "failed";

export interface DanceMotionJob {
  id: string;
  status: DanceMotionJobStatus;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  progress: number;
  stage: string;
  error?: string;
  artifacts: DanceMotionJobArtifact[];
}

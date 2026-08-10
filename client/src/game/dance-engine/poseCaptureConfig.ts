export type PoseCaptureQuality = "lite" | "full" | "heavy";

export interface PoseCaptureProfile {
  quality: PoseCaptureQuality;
  label: string;
  modelAssetPath: string;
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
}

const MEDIAPIPE_MODEL_BASE_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker";

export const POSE_CAPTURE_PROFILES: Record<PoseCaptureQuality, PoseCaptureProfile> = {
  lite: {
    quality: "lite",
    label: "Lite",
    modelAssetPath: `${MEDIAPIPE_MODEL_BASE_URL}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
    minPoseDetectionConfidence: 0.4,
    minPosePresenceConfidence: 0.4,
    minTrackingConfidence: 0.4
  },
  full: {
    quality: "full",
    label: "Full",
    modelAssetPath: `${MEDIAPIPE_MODEL_BASE_URL}/pose_landmarker_full/float16/latest/pose_landmarker_full.task`,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  },
  heavy: {
    quality: "heavy",
    label: "Heavy",
    modelAssetPath: `${MEDIAPIPE_MODEL_BASE_URL}/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task`,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  }
};

export const DEFAULT_POSE_CAPTURE_QUALITY: PoseCaptureQuality = "full";
export const POSE_CAPTURE_FALLBACK_QUALITY: PoseCaptureQuality = "lite";

export function getPoseCaptureProfile(quality = DEFAULT_POSE_CAPTURE_QUALITY): PoseCaptureProfile {
  return POSE_CAPTURE_PROFILES[quality] ?? POSE_CAPTURE_PROFILES[DEFAULT_POSE_CAPTURE_QUALITY];
}

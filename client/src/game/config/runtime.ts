import type { RhythmFlameMode, VisualizerMode } from "../../playground/types";

export interface RuntimeConfig {
  appName: string;
  beatWindowSize: number;
  beatHopSize: number;
  beatSmoothingAlpha: number;
  audioOutputLatencySeconds: number;
  peakMinProminence: number;
  peakMinStrength: number;
  peakMinDistancePoints: number;
  beatApiBaseUrl: string;
  majorBeatActiveWindowSeconds: number;
  sourceDrumsThreshold: number;
  sourceBassThreshold: number;
  sourceOtherThreshold: number;
  sourceDrumsMinDurationSeconds: number;
  sourceBassMinDurationSeconds: number;
  sourceOtherMinDurationSeconds: number;
  sourceSyntheticCount: number;
  sourceTransientHopScale: number;
  sourceAdaptiveThresholdWindow: number;
  sourceMinInterOnsetSeconds: number;
  sourceBassDominanceRatio: number;
  sourceBassMaxSustainSeconds: number;
  sourceDrumTransientGain: number;
  sourceDrumTriggerFloor: number;
  sourceReassignMargin: number;
  sourceStemHarmonicBands: number;
  sourceStemTransientBands: number;
  sourceStemBaseThreshold: number;
  sourceStemTransientBoost: number;
  sourceStemSustainMinDurationSeconds: number;
  sourceStemTransientMinDurationSeconds: number;
  sourceStemSustainReleaseSeconds: number;
  sourceStemMergeGapSeconds: number;
  sourceStemMaxSourcesPerStem: number;
  sourceStemMinAverageStrengthPerSource: number;
  sourceStemMinEventsPerSource: number;
  sourceTrackerMaxGapSeconds: number;
  sourceTrackerBandWeight: number;
  sourceTrackerStemSwitchPenalty: number;
  sourceTrackerMinEventsPerTrack: number;
  stemPeakSmoothingWindow: number;
  stemPeakMinStrength: number;
  stemPeakMinProminence: number;
  stemPeakMinDistancePoints: number;
  hybridAnalysisHopLengthDefault: number;
  hybridAnalysisOnsetMinStrengthDefault: number;
  hybridAnalysisOnsetMinDistanceSecondsDefault: number;
  hybridAnalysisAdaptiveWindowSecondsDefault: number;
  hybridAnalysisStrictKDefault: number;
  hybridAnalysisPermissiveKDefault: number;
  hybridAnalysisGapTriggerSecondsDefault: number;
  hybridAnalysisSustainMinDurationSecondsDefault: number;
  hybridAnalysisSustainMergeGapSecondsDefault: number;
  hybridAnalysisSustainBridgeFloorDefault: number;
  hybridAnalysisSustainMaxPitchJumpSemitonesDefault: number;
  hybridAnalysisSustainSplitOnPitchChangeDefault: boolean;
  hybridAnalysisSustainMinPitchConfidenceDefault: number;
  hybridAnalysisSustainEnableContinuousPitchSplitDefault: boolean;
  hybridAnalysisSustainPitchSplitThresholdSemitonesDefault: number;
  hybridAnalysisSustainPitchSplitMinSegmentSecondsDefault: number;
  hybridAnalysisSustainPitchSplitMinVoicedProbabilityDefault: number;
  hybridAnalysisLowFminDefault: number;
  hybridAnalysisLowFmaxDefault: number;
  hybridAnalysisMidFminDefault: number;
  hybridAnalysisMidFmaxDefault: number;
  hybridAnalysisHighFminDefault: number;
  hybridAnalysisHighFmaxDefault: number;
  hybridAnalysisLowWeightDefault: number;
  hybridAnalysisMidWeightDefault: number;
  hybridAnalysisHighWeightDefault: number;
  gameBeatEditorDefaultMinStrength: number;
  gameBeatEditorMergeWindowSeconds: number;
  gameApproachSeconds: number;
  gamePerfectWindowSeconds: number;
  gameGreatWindowSeconds: number;
  gameGoodWindowSeconds: number;
  gamePoorWindowSeconds: number;
  gameRhythmWizardsPlayerMoveSpeed: number;
  gameRhythmWizardsEnemyMoveSpeed: number;
  gameRhythmWizardsProjectileSpeed: number;
  gameRhythmWizardsProjectileLifetimeSeconds: number;
  gameRhythmWizardsCastCooldownSeconds: number;
  gameRhythmWizardsMoveFrameMs: number;
  gameRhythmWizardsAttackFrameMs: number;
  gameRhythmWizardsStaggerFrameMs: number;
  gameRhythmWizardsDeathFrameMs: number;
  gameRhythmWizardsWizardHealth: number;
  gameRhythmWizardsObstacleHealth: number;
  gameRhythmWizardsDirectDamageBase: number;
  gameRhythmWizardsBeatBonusDamageMultiplier: number;
  gameRhythmWizardsAoeDamageMultiplier: number;
  gameRhythmWizardsBeatAoeRadius: number;
  gameRhythmWizardsObstacleDamageMultiplier: number;
  gameRhythmWizardsObstacleDecisionMinSeconds: number;
  gameRhythmWizardsObstacleDecisionMaxSeconds: number;
  gameRhythmWizardsObstacleSpeedMin: number;
  gameRhythmWizardsObstacleSpeedMax: number;
  gameRhythmWizardsAiEasyBeatPrecisionChance: number;
  gameRhythmWizardsAiNormalBeatPrecisionChance: number;
  gameRhythmWizardsAiHardBeatPrecisionChance: number;
  gameRhythmWizardsAiEasyAccuracyChance: number;
  gameRhythmWizardsAiNormalAccuracyChance: number;
  gameRhythmWizardsAiHardAccuracyChance: number;
  menuPreviewStartSeconds: number;
  playgroundMeydaBufferSize: number;
  playgroundFeatureSmoothing: number;
  playgroundBeatPulseDecay: number;
  playgroundBeatLookaheadSeconds: number;
  playgroundBeatLookbackSeconds: number;
  playgroundBeatStrengthBoost: number;
  playgroundTempoDefaultBpm: number;
  playgroundBeatImpulseWindowRatio: number;
  playgroundVisualizerVariationAmount: number;
  playgroundVisualizerOverscanRatio: number;
  playgroundDefaultMode: VisualizerMode;
  playgroundRhythmFlameDefaultMode: RhythmFlameMode;
  playgroundRhythmFlameDefaultExtension: number;
  playgroundRhythmFlameDefaultIntensity: number;
  playgroundRhythmFlameDefaultChaos: number;
  playgroundRhythmFlameDefaultDirectionDegrees: number;
  playgroundRhythmFlameDefaultCoreColor: string;
  playgroundRhythmFlameDefaultMidColor: string;
  playgroundRhythmFlameDefaultEdgeColor: string;
  playgroundRhythmFlameAudioMasterDefault: number;
  playgroundRhythmFlameMeydaInfluenceDefault: number;
  playgroundRhythmFlameBeatInfluenceDefault: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseClampedNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parsePlaygroundMode(
  value: string | undefined
): VisualizerMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "nebula_ribbons") return "nebula_ribbons";
  if (normalized === "pulse_tunnel") return "pulse_tunnel";
  if (normalized === "lattice_dream") return "lattice_dream";
  if (normalized === "fractal_atlas") return "fractal_atlas";
  if (normalized === "celestial_gyroscope") return "celestial_gyroscope";
  if (normalized === "chaos_bloom") return "chaos_bloom";
  if (normalized === "quantum_veil") return "quantum_veil";
  if (normalized === "spectral_superformula") return "spectral_superformula";
  if (normalized === "harmonic_lissajous_manifold") return "harmonic_lissajous_manifold";
  if (normalized === "attractor_phase_weave") return "attractor_phase_weave";
  if (normalized === "spectral_implicit_isolines") return "spectral_implicit_isolines";
  return "prism_bloom";
}

function parseRhythmFlameMode(value: string | undefined): RhythmFlameMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "flame_ring") return "flame_ring";
  return "flame";
}

function parseHexColor(value: string | undefined, fallback: string): string {
  const normalized = String(value ?? "").trim();
  if (/^#[0-9a-fA-F]{3}$/.test(normalized) || /^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized;
  }
  return fallback;
}

export const runtimeConfig: RuntimeConfig = {
  appName: import.meta.env.VITE_APP_NAME ?? "Faceless Game Builder",
  beatWindowSize: parsePositiveInt(import.meta.env.VITE_BEAT_WINDOW_SIZE, 1024),
  beatHopSize: parsePositiveInt(import.meta.env.VITE_BEAT_HOP_SIZE, 512),
  beatSmoothingAlpha: parseClampedNumber(
    import.meta.env.VITE_BEAT_SMOOTHING_ALPHA,
    0.35,
    0,
    1
  ),
  audioOutputLatencySeconds: parseClampedNumber(
    import.meta.env.VITE_AUDIO_OUTPUT_LATENCY_SECONDS,
    0.12,
    0,
    1
  ),
  peakMinProminence: parseClampedNumber(
    import.meta.env.VITE_PEAK_MIN_PROMINENCE,
    0.18,
    0,
    1
  ),
  peakMinStrength: parseClampedNumber(import.meta.env.VITE_PEAK_MIN_STRENGTH, 0.5, 0, 1),
  peakMinDistancePoints: parsePositiveInt(import.meta.env.VITE_PEAK_MIN_DISTANCE_POINTS, 8),
  beatApiBaseUrl: import.meta.env.VITE_BEAT_API_BASE_URL ?? "/api/game",
  majorBeatActiveWindowSeconds: parseClampedNumber(
    import.meta.env.VITE_MAJOR_BEAT_ACTIVE_WINDOW_SECONDS,
    0.03,
    0.005,
    0.2
  ),
  sourceDrumsThreshold: parseClampedNumber(import.meta.env.VITE_SOURCE_DRUMS_THRESHOLD, 0.22, 0, 1),
  sourceBassThreshold: parseClampedNumber(import.meta.env.VITE_SOURCE_BASS_THRESHOLD, 0.32, 0, 1),
  sourceOtherThreshold: parseClampedNumber(import.meta.env.VITE_SOURCE_OTHER_THRESHOLD, 0.18, 0, 1),
  sourceDrumsMinDurationSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_DRUMS_MIN_DURATION_SECONDS,
    0.05,
    0.02,
    2
  ),
  sourceBassMinDurationSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_BASS_MIN_DURATION_SECONDS,
    0.18,
    0.03,
    5
  ),
  sourceOtherMinDurationSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_OTHER_MIN_DURATION_SECONDS,
    0.14,
    0.03,
    5
  ),
  sourceSyntheticCount: parsePositiveInt(import.meta.env.VITE_SOURCE_SYNTHETIC_COUNT, 4),
  sourceTransientHopScale: parsePositiveInt(import.meta.env.VITE_SOURCE_TRANSIENT_HOP_SCALE, 2),
  sourceAdaptiveThresholdWindow: parsePositiveInt(
    import.meta.env.VITE_SOURCE_ADAPTIVE_THRESHOLD_WINDOW,
    16
  ),
  sourceMinInterOnsetSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_MIN_INTER_ONSET_SECONDS,
    0.03,
    0.005,
    0.3
  ),
  sourceBassDominanceRatio: parseClampedNumber(
    import.meta.env.VITE_SOURCE_BASS_DOMINANCE_RATIO,
    1.4,
    1,
    4
  ),
  sourceBassMaxSustainSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_BASS_MAX_SUSTAIN_SECONDS,
    0.7,
    0.05,
    8
  ),
  sourceDrumTransientGain: parseClampedNumber(
    import.meta.env.VITE_SOURCE_DRUM_TRANSIENT_GAIN,
    1.8,
    0.2,
    5
  ),
  sourceDrumTriggerFloor: parseClampedNumber(
    import.meta.env.VITE_SOURCE_DRUM_TRIGGER_FLOOR,
    0.08,
    0,
    1
  ),
  sourceReassignMargin: parseClampedNumber(
    import.meta.env.VITE_SOURCE_REASSIGN_MARGIN,
    0.1,
    0,
    1
  ),
  sourceStemHarmonicBands: parsePositiveInt(import.meta.env.VITE_SOURCE_STEM_HARMONIC_BANDS, 8),
  sourceStemTransientBands: parsePositiveInt(import.meta.env.VITE_SOURCE_STEM_TRANSIENT_BANDS, 8),
  sourceStemBaseThreshold: parseClampedNumber(
    import.meta.env.VITE_SOURCE_STEM_BASE_THRESHOLD,
    0.1,
    0.01,
    0.95
  ),
  sourceStemTransientBoost: parseClampedNumber(
    import.meta.env.VITE_SOURCE_STEM_TRANSIENT_BOOST,
    1.65,
    0.5,
    5
  ),
  sourceStemSustainMinDurationSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_STEM_SUSTAIN_MIN_DURATION_SECONDS,
    0.16,
    0.02,
    8
  ),
  sourceStemTransientMinDurationSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_STEM_TRANSIENT_MIN_DURATION_SECONDS,
    0.03,
    0.01,
    1
  ),
  sourceStemSustainReleaseSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_STEM_SUSTAIN_RELEASE_SECONDS,
    0.08,
    0,
    1.5
  ),
  sourceStemMergeGapSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_STEM_MERGE_GAP_SECONDS,
    0.09,
    0,
    1
  ),
  sourceStemMaxSourcesPerStem: parsePositiveInt(
    import.meta.env.VITE_SOURCE_STEM_MAX_SOURCES_PER_STEM,
    4
  ),
  sourceStemMinAverageStrengthPerSource: parseClampedNumber(
    import.meta.env.VITE_SOURCE_STEM_MIN_AVERAGE_STRENGTH_PER_SOURCE,
    0.14,
    0.01,
    1
  ),
  sourceStemMinEventsPerSource: parsePositiveInt(
    import.meta.env.VITE_SOURCE_STEM_MIN_EVENTS_PER_SOURCE,
    3
  ),
  sourceTrackerMaxGapSeconds: parseClampedNumber(
    import.meta.env.VITE_SOURCE_TRACKER_MAX_GAP_SECONDS,
    0.9,
    0.05,
    8
  ),
  sourceTrackerBandWeight: parseClampedNumber(
    import.meta.env.VITE_SOURCE_TRACKER_BAND_WEIGHT,
    0.08,
    0,
    1
  ),
  sourceTrackerStemSwitchPenalty: parseClampedNumber(
    import.meta.env.VITE_SOURCE_TRACKER_STEM_SWITCH_PENALTY,
    0.22,
    0,
    2
  ),
  sourceTrackerMinEventsPerTrack: parsePositiveInt(
    import.meta.env.VITE_SOURCE_TRACKER_MIN_EVENTS_PER_TRACK,
    2
  ),
  stemPeakSmoothingWindow: parsePositiveInt(
    import.meta.env.VITE_STEM_PEAK_SMOOTHING_WINDOW,
    3
  ),
  stemPeakMinStrength: parseClampedNumber(
    import.meta.env.VITE_STEM_PEAK_MIN_STRENGTH,
    0.03,
    0,
    1
  ),
  stemPeakMinProminence: parseClampedNumber(
    import.meta.env.VITE_STEM_PEAK_MIN_PROMINENCE,
    0.01,
    0,
    1
  ),
  stemPeakMinDistancePoints: parsePositiveInt(
    import.meta.env.VITE_STEM_PEAK_MIN_DISTANCE_POINTS,
    3
  ),
  hybridAnalysisHopLengthDefault: parsePositiveInt(
    import.meta.env.VITE_HYBRID_ANALYSIS_HOP_LENGTH_DEFAULT,
    512
  ),
  hybridAnalysisOnsetMinStrengthDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_ONSET_MIN_STRENGTH_DEFAULT,
    0.1,
    0,
    1
  ),
  hybridAnalysisOnsetMinDistanceSecondsDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_ONSET_MIN_DISTANCE_SECONDS_DEFAULT,
    0.11,
    0.01,
    2
  ),
  hybridAnalysisAdaptiveWindowSecondsDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_ADAPTIVE_WINDOW_SECONDS_DEFAULT,
    0.45,
    0.05,
    5
  ),
  hybridAnalysisStrictKDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_STRICT_K_DEFAULT,
    1.15,
    0,
    4
  ),
  hybridAnalysisPermissiveKDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_PERMISSIVE_K_DEFAULT,
    0.62,
    0,
    4
  ),
  hybridAnalysisGapTriggerSecondsDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_GAP_TRIGGER_SECONDS_DEFAULT,
    0.24,
    0.02,
    4
  ),
  hybridAnalysisSustainMinDurationSecondsDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_MIN_DURATION_SECONDS_DEFAULT,
    0.08,
    0.02,
    4
  ),
  hybridAnalysisSustainMergeGapSecondsDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_MERGE_GAP_SECONDS_DEFAULT,
    0.14,
    0,
    2
  ),
  hybridAnalysisSustainBridgeFloorDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_BRIDGE_FLOOR_DEFAULT,
    0.25,
    0,
    2
  ),
  hybridAnalysisSustainMaxPitchJumpSemitonesDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_MAX_PITCH_JUMP_SEMITONES_DEFAULT,
    3.0,
    0,
    24
  ),
  hybridAnalysisSustainSplitOnPitchChangeDefault: parseBoolean(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_SPLIT_ON_PITCH_CHANGE_DEFAULT,
    true
  ),
  hybridAnalysisSustainMinPitchConfidenceDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_MIN_PITCH_CONFIDENCE_DEFAULT,
    0.45,
    0,
    1
  ),
  hybridAnalysisSustainEnableContinuousPitchSplitDefault: parseBoolean(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_ENABLE_CONTINUOUS_PITCH_SPLIT_DEFAULT,
    true
  ),
  hybridAnalysisSustainPitchSplitThresholdSemitonesDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_PITCH_SPLIT_THRESHOLD_SEMITONES_DEFAULT,
    0.75,
    0,
    24
  ),
  hybridAnalysisSustainPitchSplitMinSegmentSecondsDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_PITCH_SPLIT_MIN_SEGMENT_SECONDS_DEFAULT,
    0.2,
    0.02,
    10
  ),
  hybridAnalysisSustainPitchSplitMinVoicedProbabilityDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_SUSTAIN_PITCH_SPLIT_MIN_VOICED_PROBABILITY_DEFAULT,
    0.7,
    0,
    1
  ),
  hybridAnalysisLowFminDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_LOW_FMIN_DEFAULT,
    20,
    1,
    24000
  ),
  hybridAnalysisLowFmaxDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_LOW_FMAX_DEFAULT,
    5000,
    2,
    24000
  ),
  hybridAnalysisMidFminDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_MID_FMIN_DEFAULT,
    5000,
    2,
    24000
  ),
  hybridAnalysisMidFmaxDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_MID_FMAX_DEFAULT,
    7000,
    3,
    24000
  ),
  hybridAnalysisHighFminDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_HIGH_FMIN_DEFAULT,
    7000,
    3,
    24000
  ),
  hybridAnalysisHighFmaxDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_HIGH_FMAX_DEFAULT,
    12000,
    4,
    24000
  ),
  hybridAnalysisLowWeightDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_LOW_WEIGHT_DEFAULT,
    1.15,
    0,
    8
  ),
  hybridAnalysisMidWeightDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_MID_WEIGHT_DEFAULT,
    1.0,
    0,
    8
  ),
  hybridAnalysisHighWeightDefault: parseClampedNumber(
    import.meta.env.VITE_HYBRID_ANALYSIS_HIGH_WEIGHT_DEFAULT,
    0.9,
    0,
    8
  ),
  gameBeatEditorDefaultMinStrength: parseClampedNumber(
    import.meta.env.VITE_GAME_BEAT_EDITOR_DEFAULT_MIN_STRENGTH,
    0.08,
    0,
    1
  ),
  gameBeatEditorMergeWindowSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_BEAT_EDITOR_MERGE_WINDOW_SECONDS,
    0.03,
    0.001,
    0.2
  ),
  gameApproachSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_APPROACH_SECONDS,
    1.8,
    0.4,
    5
  ),
  gamePerfectWindowSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_WINDOW_PERFECT_SECONDS,
    0.04,
    0.005,
    0.2
  ),
  gameGreatWindowSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_WINDOW_GREAT_SECONDS,
    0.08,
    0.01,
    0.3
  ),
  gameGoodWindowSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_WINDOW_GOOD_SECONDS,
    0.13,
    0.02,
    0.4
  ),
  gamePoorWindowSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_WINDOW_POOR_SECONDS,
    0.2,
    0.03,
    0.6
  ),
  gameRhythmWizardsPlayerMoveSpeed: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_PLAYER_MOVE_SPEED,
    0.34,
    0.1,
    2
  ),
  gameRhythmWizardsEnemyMoveSpeed: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_ENEMY_MOVE_SPEED,
    0.3,
    0.1,
    2
  ),
  gameRhythmWizardsProjectileSpeed: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_PROJECTILE_SPEED,
    0.46,
    0.2,
    4
  ),
  gameRhythmWizardsProjectileLifetimeSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_PROJECTILE_LIFETIME_SECONDS,
    2.8,
    0.2,
    5
  ),
  gameRhythmWizardsCastCooldownSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_CAST_COOLDOWN_SECONDS,
    0.58,
    0.1,
    3
  ),
  gameRhythmWizardsMoveFrameMs: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_MOVE_FRAME_MS,
    86,
    30,
    300
  ),
  gameRhythmWizardsAttackFrameMs: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_ATTACK_FRAME_MS,
    70,
    30,
    350
  ),
  gameRhythmWizardsStaggerFrameMs: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_STAGGER_FRAME_MS,
    72,
    30,
    350
  ),
  gameRhythmWizardsDeathFrameMs: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_DEATH_FRAME_MS,
    88,
    30,
    450
  ),
  gameRhythmWizardsWizardHealth: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_WIZARD_HEALTH,
    100,
    10,
    1000
  ),
  gameRhythmWizardsObstacleHealth: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_OBSTACLE_HEALTH,
    90,
    1,
    500
  ),
  gameRhythmWizardsDirectDamageBase: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_DIRECT_DAMAGE_BASE,
    10,
    1,
    100
  ),
  gameRhythmWizardsBeatBonusDamageMultiplier: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_BEAT_BONUS_DAMAGE_MULTIPLIER,
    1.45,
    1,
    5
  ),
  gameRhythmWizardsAoeDamageMultiplier: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_AOE_DAMAGE_MULTIPLIER,
    0.72,
    0,
    3
  ),
  gameRhythmWizardsBeatAoeRadius: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_BEAT_AOE_RADIUS,
    0.11,
    0,
    0.6
  ),
  gameRhythmWizardsObstacleDamageMultiplier: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_OBSTACLE_DAMAGE_MULTIPLIER,
    0.42,
    0,
    2
  ),
  gameRhythmWizardsObstacleDecisionMinSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_OBSTACLE_DECISION_MIN_SECONDS,
    0.28,
    0.05,
    4
  ),
  gameRhythmWizardsObstacleDecisionMaxSeconds: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_OBSTACLE_DECISION_MAX_SECONDS,
    1.1,
    0.1,
    6
  ),
  gameRhythmWizardsObstacleSpeedMin: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_OBSTACLE_SPEED_MIN,
    0.18,
    0,
    2
  ),
  gameRhythmWizardsObstacleSpeedMax: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_OBSTACLE_SPEED_MAX,
    0.42,
    0.01,
    3
  ),
  gameRhythmWizardsAiEasyBeatPrecisionChance: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_AI_EASY_BEAT_PRECISION_CHANCE,
    0.28,
    0,
    1
  ),
  gameRhythmWizardsAiNormalBeatPrecisionChance: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_AI_NORMAL_BEAT_PRECISION_CHANCE,
    0.58,
    0,
    1
  ),
  gameRhythmWizardsAiHardBeatPrecisionChance: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_AI_HARD_BEAT_PRECISION_CHANCE,
    0.84,
    0,
    1
  ),
  gameRhythmWizardsAiEasyAccuracyChance: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_AI_EASY_ACCURACY_CHANCE,
    0.44,
    0,
    1
  ),
  gameRhythmWizardsAiNormalAccuracyChance: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_AI_NORMAL_ACCURACY_CHANCE,
    0.66,
    0,
    1
  ),
  gameRhythmWizardsAiHardAccuracyChance: parseClampedNumber(
    import.meta.env.VITE_GAME_RW_AI_HARD_ACCURACY_CHANCE,
    0.84,
    0,
    1
  ),
  menuPreviewStartSeconds: parseClampedNumber(
    import.meta.env.VITE_MENU_PREVIEW_START_SECONDS,
    0,
    0,
    600
  ),
  playgroundMeydaBufferSize: parsePositiveInt(
    import.meta.env.VITE_PLAYGROUND_MEYDA_BUFFER_SIZE,
    1024
  ),
  playgroundFeatureSmoothing: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_FEATURE_SMOOTHING,
    0.82,
    0,
    0.999
  ),
  playgroundBeatPulseDecay: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_BEAT_PULSE_DECAY,
    0.92,
    0.7,
    0.999
  ),
  playgroundBeatLookaheadSeconds: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_BEAT_LOOKAHEAD_SECONDS,
    0.03,
    0,
    0.2
  ),
  playgroundBeatLookbackSeconds: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_BEAT_LOOKBACK_SECONDS,
    0.04,
    0,
    0.25
  ),
  playgroundBeatStrengthBoost: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_BEAT_STRENGTH_BOOST,
    1.1,
    0,
    2.5
  ),
  playgroundTempoDefaultBpm: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_TEMPO_DEFAULT_BPM,
    124,
    60,
    220
  ),
  playgroundBeatImpulseWindowRatio: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_BEAT_IMPULSE_WINDOW_RATIO,
    0.22,
    0.05,
    0.7
  ),
  playgroundVisualizerVariationAmount: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_VISUALIZER_VARIATION_AMOUNT,
    1,
    0,
    2
  ),
  playgroundVisualizerOverscanRatio: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_VISUALIZER_OVERSCAN_RATIO,
    0.18,
    0,
    0.6
  ),
  playgroundDefaultMode: parsePlaygroundMode(import.meta.env.VITE_PLAYGROUND_DEFAULT_MODE),
  playgroundRhythmFlameDefaultMode: parseRhythmFlameMode(
    import.meta.env.VITE_PLAYGROUND_RHYTHM_FLAME_DEFAULT_MODE
  ),
  playgroundRhythmFlameDefaultExtension: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_RHYTHM_FLAME_DEFAULT_EXTENSION,
    0.62,
    0,
    1
  ),
  playgroundRhythmFlameDefaultIntensity: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_RHYTHM_FLAME_DEFAULT_INTENSITY,
    0.72,
    0,
    1
  ),
  playgroundRhythmFlameDefaultChaos: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_RHYTHM_FLAME_DEFAULT_CHAOS,
    0.5,
    0,
    1
  ),
  playgroundRhythmFlameDefaultDirectionDegrees: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_RHYTHM_FLAME_DEFAULT_DIRECTION_DEGREES,
    0,
    -180,
    180
  ),
  playgroundRhythmFlameDefaultCoreColor: parseHexColor(
    import.meta.env.VITE_PLAYGROUND_RHYTHM_FLAME_DEFAULT_CORE_COLOR,
    "#ffd37a"
  ),
  playgroundRhythmFlameDefaultMidColor: parseHexColor(
    import.meta.env.VITE_PLAYGROUND_RHYTHM_FLAME_DEFAULT_MID_COLOR,
    "#ff6f3f"
  ),
  playgroundRhythmFlameDefaultEdgeColor: parseHexColor(
    import.meta.env.VITE_PLAYGROUND_RHYTHM_FLAME_DEFAULT_EDGE_COLOR,
    "#6e1f24"
  ),
  playgroundRhythmFlameAudioMasterDefault: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_RHYTHM_FLAME_AUDIO_MASTER_DEFAULT,
    0.75,
    0,
    1
  ),
  playgroundRhythmFlameMeydaInfluenceDefault: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_RHYTHM_FLAME_MEYDA_INFLUENCE_DEFAULT,
    0.62,
    0,
    1
  ),
  playgroundRhythmFlameBeatInfluenceDefault: parseClampedNumber(
    import.meta.env.VITE_PLAYGROUND_RHYTHM_FLAME_BEAT_INFLUENCE_DEFAULT,
    0.82,
    0,
    1
  )
};

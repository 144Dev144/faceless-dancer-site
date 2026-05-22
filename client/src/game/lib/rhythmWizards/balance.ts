import type { CombatJudgement, RhythmWizardsConfig, WizardAiDifficulty } from "./types";
import { runtimeConfig } from "../../config/runtime";

export const rhythmWizardsConfig: RhythmWizardsConfig = {
  arenaMinX: 0.12,
  arenaMaxX: 0.88,
  playerY: 0.9,
  enemyY: 0.1,
  wizardRadius: 0.042,
  obstacleMinX: 0.16,
  obstacleMaxX: 0.84,
  playerMoveSpeed: runtimeConfig.gameRhythmWizardsPlayerMoveSpeed,
  enemyMoveSpeed: runtimeConfig.gameRhythmWizardsEnemyMoveSpeed,
  projectileSpeed: runtimeConfig.gameRhythmWizardsProjectileSpeed,
  projectileRadius: 0.018,
  projectileLifetimeSeconds: Math.max(2.2, runtimeConfig.gameRhythmWizardsProjectileLifetimeSeconds),
  castCooldownSeconds: runtimeConfig.gameRhythmWizardsCastCooldownSeconds,
  moveFrameMs: runtimeConfig.gameRhythmWizardsMoveFrameMs,
  attackFrameMs: runtimeConfig.gameRhythmWizardsAttackFrameMs,
  staggerFrameMs: runtimeConfig.gameRhythmWizardsStaggerFrameMs,
  deathFrameMs: runtimeConfig.gameRhythmWizardsDeathFrameMs,
  playerHealth: runtimeConfig.gameRhythmWizardsWizardHealth,
  enemyHealth: runtimeConfig.gameRhythmWizardsWizardHealth,
  obstacleHealth: runtimeConfig.gameRhythmWizardsObstacleHealth,
  directDamageBase: runtimeConfig.gameRhythmWizardsDirectDamageBase,
  beatBonusDamageMultiplier: runtimeConfig.gameRhythmWizardsBeatBonusDamageMultiplier,
  aoeDamageMultiplier: runtimeConfig.gameRhythmWizardsAoeDamageMultiplier,
  obstacleDamageMultiplier: runtimeConfig.gameRhythmWizardsObstacleDamageMultiplier,
  beatAoeRadius: runtimeConfig.gameRhythmWizardsBeatAoeRadius,
  obstacleRandomIdleChance: 0.24,
  obstacleDecisionMinSeconds: runtimeConfig.gameRhythmWizardsObstacleDecisionMinSeconds,
  obstacleDecisionMaxSeconds: runtimeConfig.gameRhythmWizardsObstacleDecisionMaxSeconds,
  obstacleSpeedMin: runtimeConfig.gameRhythmWizardsObstacleSpeedMin,
  obstacleSpeedMax: runtimeConfig.gameRhythmWizardsObstacleSpeedMax,
};

export interface AiDifficultyProfile {
  moveDecisionMinSeconds: number;
  moveDecisionMaxSeconds: number;
  castDecisionMinSeconds: number;
  castDecisionMaxSeconds: number;
  enemyCooldownMultiplier: number;
  idleMoveChance: number;
  directionFlipChance: number;
  dodgeAwarenessChance: number;
  dodgeLookaheadSeconds: number;
  dodgeDangerRadiusMultiplier: number;
  beatPrecisionChance: number;
  accuracyChance: number;
  leadPlayerMovementChance: number;
}

export const aiProfilesByDifficulty: Record<WizardAiDifficulty, AiDifficultyProfile> = {
  novice: {
    moveDecisionMinSeconds: 0.26,
    moveDecisionMaxSeconds: 0.7,
    castDecisionMinSeconds: 0.85,
    castDecisionMaxSeconds: 1.35,
    enemyCooldownMultiplier: 1,
    idleMoveChance: 0.22,
    directionFlipChance: 0.28,
    dodgeAwarenessChance: 0.16,
    dodgeLookaheadSeconds: 0.32,
    dodgeDangerRadiusMultiplier: 1.12,
    beatPrecisionChance: Math.max(0, runtimeConfig.gameRhythmWizardsAiEasyBeatPrecisionChance - 0.1),
    accuracyChance: Math.max(0, runtimeConfig.gameRhythmWizardsAiEasyAccuracyChance - 0.12),
    leadPlayerMovementChance: 0.15,
  },
  apprentice: {
    moveDecisionMinSeconds: 0.2,
    moveDecisionMaxSeconds: 0.58,
    castDecisionMinSeconds: 0.55,
    castDecisionMaxSeconds: 0.95,
    enemyCooldownMultiplier: 0.82,
    idleMoveChance: 0.16,
    directionFlipChance: 0.42,
    dodgeAwarenessChance: 0.4,
    dodgeLookaheadSeconds: 0.46,
    dodgeDangerRadiusMultiplier: 1.24,
    beatPrecisionChance: runtimeConfig.gameRhythmWizardsAiEasyBeatPrecisionChance,
    accuracyChance: runtimeConfig.gameRhythmWizardsAiEasyAccuracyChance,
    leadPlayerMovementChance: 0.24,
  },
  adept: {
    moveDecisionMinSeconds: 0.14,
    moveDecisionMaxSeconds: 0.45,
    castDecisionMinSeconds: 0.32,
    castDecisionMaxSeconds: 0.64,
    enemyCooldownMultiplier: 0.62,
    idleMoveChance: 0.1,
    directionFlipChance: 0.58,
    dodgeAwarenessChance: 0.7,
    dodgeLookaheadSeconds: 0.62,
    dodgeDangerRadiusMultiplier: 1.4,
    beatPrecisionChance: runtimeConfig.gameRhythmWizardsAiNormalBeatPrecisionChance,
    accuracyChance: runtimeConfig.gameRhythmWizardsAiNormalAccuracyChance,
    leadPlayerMovementChance: 0.44,
  },
  master: {
    moveDecisionMinSeconds: 0.08,
    moveDecisionMaxSeconds: 0.24,
    castDecisionMinSeconds: 0.18,
    castDecisionMaxSeconds: 0.36,
    enemyCooldownMultiplier: 0.46,
    idleMoveChance: 0.05,
    directionFlipChance: 0.76,
    dodgeAwarenessChance: 0.93,
    dodgeLookaheadSeconds: 0.9,
    dodgeDangerRadiusMultiplier: 1.62,
    beatPrecisionChance: Math.min(1, runtimeConfig.gameRhythmWizardsAiHardBeatPrecisionChance),
    accuracyChance: Math.min(1, runtimeConfig.gameRhythmWizardsAiHardAccuracyChance),
    leadPlayerMovementChance: 0.74,
  },
  archmage: {
    moveDecisionMinSeconds: 0.045,
    moveDecisionMaxSeconds: 0.14,
    castDecisionMinSeconds: 0.08,
    castDecisionMaxSeconds: 0.2,
    enemyCooldownMultiplier: 0.32,
    idleMoveChance: 0.02,
    directionFlipChance: 0.9,
    dodgeAwarenessChance: 1,
    dodgeLookaheadSeconds: 1.2,
    dodgeDangerRadiusMultiplier: 1.86,
    beatPrecisionChance: Math.min(1, runtimeConfig.gameRhythmWizardsAiHardBeatPrecisionChance + 0.12),
    accuracyChance: Math.min(1, runtimeConfig.gameRhythmWizardsAiHardAccuracyChance + 0.12),
    leadPlayerMovementChance: 0.9,
  },
};

export function damageBonusByJudgement(judgement: CombatJudgement): number {
  if (judgement === "perfect") return 1;
  if (judgement === "great") return 0.65;
  if (judgement === "good") return 0.35;
  return 0;
}

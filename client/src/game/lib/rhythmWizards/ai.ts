import { aiProfilesByDifficulty } from "./balance";
import type { MoveDirection, RhythmWizardsAiState, RhythmWizardsState, WizardAiDifficulty } from "./types";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomRange(nextRandom: () => number, min: number, max: number): number {
  return min + nextRandom() * Math.max(0, max - min);
}

export interface AiDecision {
  moveDir: MoveDirection;
  shouldCast: boolean;
  targetX: number;
  targetY: number;
  nextState: RhythmWizardsAiState;
}

function findDodgeDirection(
  state: RhythmWizardsState,
  lookaheadSeconds: number,
  dangerRadiusMultiplier: number
): { direction: MoveDirection; imminenceSeconds: number } {
  const enemy = state.enemy;
  const combinedRadius = (0.042 + 0.018) * dangerRadiusMultiplier;
  const laneBandHalfHeight = combinedRadius * 1.1;
  let nearestThreatTime = Number.POSITIVE_INFINITY;
  let nearestThreatX = enemy.x;

  for (const projectile of state.projectiles) {
    if (projectile.owner !== "player") continue;
    if (projectile.vy >= 0) continue;

    const dy = enemy.y - projectile.y;
    const hitTime = dy / projectile.vy;
    if (!Number.isFinite(hitTime) || hitTime < 0 || hitTime > lookaheadSeconds) {
      continue;
    }

    const projectedX = projectile.x + projectile.vx * hitTime;
    const projectedY = projectile.y + projectile.vy * hitTime;
    const distanceX = Math.abs(projectedX - enemy.x);
    const distanceY = Math.abs(projectedY - enemy.y);
    if (distanceY > laneBandHalfHeight || distanceX > combinedRadius * 1.7) {
      continue;
    }

    if (hitTime < nearestThreatTime) {
      nearestThreatTime = hitTime;
      nearestThreatX = projectedX;
    }
  }

  if (!Number.isFinite(nearestThreatTime)) {
    return { direction: 0, imminenceSeconds: Number.POSITIVE_INFINITY };
  }
  return {
    direction: nearestThreatX >= enemy.x ? -1 : 1,
    imminenceSeconds: nearestThreatTime,
  };
}

export function createInitialAiState(difficulty: WizardAiDifficulty): RhythmWizardsAiState {
  const profile = aiProfilesByDifficulty[difficulty];
  return {
    moveDecisionRemainingSeconds: profile.moveDecisionMinSeconds,
    castDecisionRemainingSeconds: profile.castDecisionMinSeconds,
  };
}

export function decideEnemyAction(
  state: RhythmWizardsState,
  dtSeconds: number,
  _beatTimelineSeconds: number[],
  nextRandom: () => number
): AiDecision {
  const profile = aiProfilesByDifficulty[state.aiDifficulty];
  const player = state.player;
  const enemy = state.enemy;
  const previous = state.ai;

  let moveDecisionRemainingSeconds = previous.moveDecisionRemainingSeconds - dtSeconds;
  let castDecisionRemainingSeconds = previous.castDecisionRemainingSeconds - dtSeconds;
  let moveDir = enemy.moveDir;

  const dodge = findDodgeDirection(state, profile.dodgeLookaheadSeconds, profile.dodgeDangerRadiusMultiplier);
  const shouldForceDodge =
    dodge.direction !== 0 &&
    (dodge.imminenceSeconds <= 0.28 || nextRandom() < profile.dodgeAwarenessChance);
  if (shouldForceDodge) {
    moveDir = dodge.direction;
    moveDecisionRemainingSeconds = Math.max(0.03, moveDecisionRemainingSeconds);
  }

  if (!shouldForceDodge && moveDecisionRemainingSeconds <= 0) {
    const distanceToPlayer = player.x - enemy.x;
    const shouldIdle = nextRandom() < profile.idleMoveChance;
    if (shouldIdle) {
      moveDir = 0;
    } else {
      const alignRoll = nextRandom();
      const shouldAlign = Math.abs(distanceToPlayer) > 0.04 && alignRoll < profile.accuracyChance;
      if (shouldAlign) {
        moveDir = distanceToPlayer > 0 ? 1 : -1;
      } else if (enemy.moveDir === 0) {
        moveDir = nextRandom() < 0.5 ? -1 : 1;
      } else if (nextRandom() < profile.directionFlipChance) {
        moveDir = enemy.moveDir === 1 ? -1 : 1;
      } else {
        moveDir = enemy.moveDir;
      }
    }
    moveDecisionRemainingSeconds = randomRange(
      nextRandom,
      profile.moveDecisionMinSeconds,
      profile.moveDecisionMaxSeconds
    );
  }

  let shouldCast = false;
  if (enemy.cooldownRemainingSeconds <= 0 && castDecisionRemainingSeconds <= 0 && !enemy.defeated) {
    shouldCast = true;
    castDecisionRemainingSeconds = randomRange(
      nextRandom,
      profile.castDecisionMinSeconds,
      profile.castDecisionMaxSeconds
    );
  }

  const leadDistance = 0.08 + profile.leadPlayerMovementChance * 0.05;
  const targetBase =
    nextRandom() < profile.leadPlayerMovementChance ? player.x + player.moveDir * leadDistance : player.x;
  const aimError = (1 - profile.accuracyChance) * (nextRandom() - 0.5) * 0.28;
  const targetX = clamp(targetBase + aimError, 0.08, 0.92);
  const targetY = 0.88;

  return {
    moveDir,
    shouldCast,
    targetX,
    targetY,
    nextState: {
      moveDecisionRemainingSeconds,
      castDecisionRemainingSeconds,
    },
  };
}

import type { MoveDirection, ObstacleState, RhythmWizardsConfig } from "./types";
const OBSTACLE_HIT_FLASH_SECONDS = 0.16;

function randomRange(randomValue: number, min: number, max: number): number {
  return min + randomValue * Math.max(0, max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function updateObstacleMotion(
  obstacle: ObstacleState,
  dtSeconds: number,
  config: RhythmWizardsConfig,
  nextRandom: () => number
): ObstacleState {
  if (obstacle.destroyed) {
    return obstacle;
  }

  let moveDir: MoveDirection = obstacle.moveDir;
  let decisionRemainingSeconds = obstacle.decisionRemainingSeconds - dtSeconds;
  let speed = obstacle.speed;

  if (decisionRemainingSeconds <= 0) {
    const idleRoll = nextRandom();
    if (idleRoll < config.obstacleRandomIdleChance) {
      moveDir = 0;
      speed = 0;
    } else {
      moveDir = nextRandom() >= 0.5 ? 1 : -1;
      speed = randomRange(nextRandom(), config.obstacleSpeedMin, config.obstacleSpeedMax);
    }
    decisionRemainingSeconds = randomRange(
      nextRandom(),
      config.obstacleDecisionMinSeconds,
      config.obstacleDecisionMaxSeconds
    );
  }

  let x = obstacle.x + moveDir * speed * dtSeconds;
  if (x <= config.obstacleMinX) {
    x = config.obstacleMinX;
    moveDir = 1;
  } else if (x >= config.obstacleMaxX) {
    x = config.obstacleMaxX;
    moveDir = -1;
  }

  const hitFlashRemainingSeconds = clamp(
    obstacle.hitFlashRemainingSeconds - dtSeconds,
    0,
    OBSTACLE_HIT_FLASH_SECONDS
  );
  return {
    ...obstacle,
    x,
    moveDir,
    speed,
    decisionRemainingSeconds,
    hitFlashRemainingSeconds,
  };
}

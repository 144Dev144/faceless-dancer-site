import { evaluateBeatSync } from "./beatSync";
import { createInitialAiState, decideEnemyAction } from "./ai";
import { aiProfilesByDifficulty, rhythmWizardsConfig } from "./balance";
import { updateObstacleMotion } from "./obstacles";
import type {
  MoveDirection,
  ObstacleState,
  ProjectileState,
  RhythmWizardsEvent,
  RhythmWizardsState,
  SpellCastRequest,
  StepInput,
  WizardAction,
  WizardActorState,
  WizardAiDifficulty,
  WizardOwner,
} from "./types";

const PLAYER_ID = "player";
const ENEMY_ID = "enemy";
const WIZARD_HIT_FLASH_SECONDS = 0.18;
const OBSTACLE_HIT_FLASH_SECONDS = 0.16;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function randomRange(nextRandom: () => number, min: number, max: number): number {
  return min + nextRandom() * Math.max(0, max - min);
}

function attackDurationSeconds(): number {
  return (9 * rhythmWizardsConfig.attackFrameMs) / 1000;
}

function staggerDurationSeconds(): number {
  return (7 * rhythmWizardsConfig.staggerFrameMs) / 1000;
}

function deathDurationSeconds(): number {
  return (6 * rhythmWizardsConfig.deathFrameMs) / 1000;
}

function isMovementLocked(action: WizardAction): boolean {
  return action === "attack" || action === "stagger" || action === "death";
}

function setActorAction(actor: WizardActorState, action: WizardAction, durationSeconds: number): WizardActorState {
  return {
    ...actor,
    action,
    actionDurationSeconds: durationSeconds,
    actionElapsedSeconds: 0,
    actionToken: actor.actionToken + 1,
  };
}

function createActor(owner: WizardOwner, x: number, y: number, health: number): WizardActorState {
  return {
    owner,
    x,
    y,
    health,
    maxHealth: health,
    moveDir: 0,
    cooldownRemainingSeconds: 0,
    castFlashRemainingSeconds: 0,
    hitFlashRemainingSeconds: 0,
    defeated: false,
    pendingDefeat: false,
    action: "idle",
    actionElapsedSeconds: 0,
    actionDurationSeconds: 0,
    actionToken: 0,
    pendingAttack: null,
    attackSpawned: false,
  };
}

function createInitialObstacles(seedRandom: () => number): ObstacleState[] {
  return [
    {
      id: "obstacle-1",
      x: randomRange(seedRandom, 0.28, 0.44),
      y: 0.38,
      width: 0.17,
      height: 0.085,
      health: rhythmWizardsConfig.obstacleHealth,
      maxHealth: rhythmWizardsConfig.obstacleHealth,
      moveDir: seedRandom() > 0.5 ? 1 : -1,
      speed: randomRange(seedRandom, rhythmWizardsConfig.obstacleSpeedMin, rhythmWizardsConfig.obstacleSpeedMax),
      decisionRemainingSeconds: randomRange(
        seedRandom,
        rhythmWizardsConfig.obstacleDecisionMinSeconds,
        rhythmWizardsConfig.obstacleDecisionMaxSeconds
      ),
      destroyed: false,
      hitFlashRemainingSeconds: 0,
    },
    {
      id: "obstacle-2",
      x: randomRange(seedRandom, 0.56, 0.72),
      y: 0.61,
      width: 0.17,
      height: 0.085,
      health: rhythmWizardsConfig.obstacleHealth,
      maxHealth: rhythmWizardsConfig.obstacleHealth,
      moveDir: seedRandom() > 0.5 ? 1 : -1,
      speed: randomRange(seedRandom, rhythmWizardsConfig.obstacleSpeedMin, rhythmWizardsConfig.obstacleSpeedMax),
      decisionRemainingSeconds: randomRange(
        seedRandom,
        rhythmWizardsConfig.obstacleDecisionMinSeconds,
        rhythmWizardsConfig.obstacleDecisionMaxSeconds
      ),
      destroyed: false,
      hitFlashRemainingSeconds: 0,
    },
  ];
}

function circleIntersectsRect(
  cx: number,
  cy: number,
  radius: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): boolean {
  const nearestX = clamp(cx, rx - rw * 0.5, rx + rw * 0.5);
  const nearestY = clamp(cy, ry - rh * 0.5, ry + rh * 0.5);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

function distanceSquared(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function canDamageOwner(projectile: ProjectileState, owner: WizardOwner): boolean {
  return projectile.owner !== owner;
}

function applyDamageToActor(target: WizardActorState, amount: number): WizardActorState {
  if (target.defeated || target.pendingDefeat || amount <= 0) {
    return target;
  }
  const health = Math.max(0, target.health - amount);
  return {
    ...target,
    health,
    hitFlashRemainingSeconds: WIZARD_HIT_FLASH_SECONDS,
    castFlashRemainingSeconds: 0,
    moveDir: 0,
    pendingAttack: null,
    attackSpawned: true,
    action: "stagger",
    actionElapsedSeconds: 0,
    actionDurationSeconds: staggerDurationSeconds(),
    actionToken: target.actionToken + 1,
    pendingDefeat: health <= 0,
  };
}

function startAttack(actor: WizardActorState, cast: SpellCastRequest, cooldownSeconds: number): WizardActorState {
  return {
    ...actor,
    cooldownRemainingSeconds: cooldownSeconds,
    castFlashRemainingSeconds: 0,
    moveDir: 0,
    action: "attack",
    actionElapsedSeconds: 0,
    actionDurationSeconds: attackDurationSeconds(),
    actionToken: actor.actionToken + 1,
    pendingAttack: {
      targetX: cast.targetX,
      targetY: cast.targetY,
      heardTimeSeconds: cast.heardTimeSeconds,
      judgement: cast.judgement,
      bonusMultiplier: cast.bonusMultiplier,
      aoeRadius: cast.aoeRadius,
    },
    attackSpawned: false,
  };
}

function castCooldownForOwner(state: RhythmWizardsState, owner: WizardOwner): number {
  if (owner === PLAYER_ID) {
    return rhythmWizardsConfig.castCooldownSeconds;
  }
  const profile = aiProfilesByDifficulty[state.aiDifficulty];
  return Math.max(0.12, rhythmWizardsConfig.castCooldownSeconds * profile.enemyCooldownMultiplier);
}

export function createRhythmWizardsState(aiDifficulty: WizardAiDifficulty, seed = 1337): RhythmWizardsState {
  const random = createSeededRandom(seed);
  return {
    aiDifficulty,
    timeSeconds: 0,
    seed,
    nextProjectileId: 1,
    ended: false,
    winner: null,
    player: createActor(PLAYER_ID, 0.5, rhythmWizardsConfig.playerY, rhythmWizardsConfig.playerHealth),
    enemy: createActor(ENEMY_ID, 0.5, rhythmWizardsConfig.enemyY, rhythmWizardsConfig.enemyHealth),
    obstacles: createInitialObstacles(random),
    projectiles: [],
    ai: createInitialAiState(aiDifficulty),
  };
}

function createProjectile(
  state: RhythmWizardsState,
  owner: WizardOwner,
  sourceX: number,
  sourceY: number,
  cast: SpellCastRequest
): { state: RhythmWizardsState; projectile: ProjectileState } {
  const dx = cast.targetX - sourceX;
  const dy = cast.targetY - sourceY;
  const magnitude = Math.hypot(dx, dy) || 1;
  const bonusDamage = rhythmWizardsConfig.directDamageBase * cast.bonusMultiplier;
  const projectile: ProjectileState = {
    id: `${owner}-${state.nextProjectileId}`,
    owner,
    x: sourceX,
    y: sourceY,
    vx: (dx / magnitude) * rhythmWizardsConfig.projectileSpeed,
    vy: (dy / magnitude) * rhythmWizardsConfig.projectileSpeed,
    radius: rhythmWizardsConfig.projectileRadius,
    directDamage: bonusDamage,
    aoeDamage: bonusDamage * rhythmWizardsConfig.aoeDamageMultiplier,
    aoeRadius: cast.aoeRadius,
    ttlRemainingSeconds: rhythmWizardsConfig.projectileLifetimeSeconds,
    beatJudgement: cast.judgement,
  };
  return {
    state: {
      ...state,
      nextProjectileId: state.nextProjectileId + 1,
    },
    projectile,
  };
}

export function castSpell(state: RhythmWizardsState, cast: SpellCastRequest): { state: RhythmWizardsState; events: RhythmWizardsEvent[] } {
  if (state.ended) {
    return { state, events: [] };
  }
  const actor = cast.owner === PLAYER_ID ? state.player : state.enemy;
  if (actor.defeated || actor.cooldownRemainingSeconds > 0 || isMovementLocked(actor.action)) {
    return { state, events: [] };
  }
  const cooldownSeconds = castCooldownForOwner(state, cast.owner);
  const nextPlayer = cast.owner === PLAYER_ID ? startAttack(state.player, cast, cooldownSeconds) : state.player;
  const nextEnemy = cast.owner === ENEMY_ID ? startAttack(state.enemy, cast, cooldownSeconds) : state.enemy;
  return {
    state: {
      ...state,
      player: nextPlayer,
      enemy: nextEnemy,
    },
    events: [
      {
        type: cast.owner === PLAYER_ID ? "player_cast" : "enemy_cast",
        atSeconds: cast.heardTimeSeconds,
        judgement: cast.judgement,
        x: actor.x,
        y: actor.y,
      },
    ],
  };
}

function resolveActorAction(
  state: RhythmWizardsState,
  actor: WizardActorState,
  dtSeconds: number,
  moveSpeed: number,
  desiredMoveDir: MoveDirection,
  atSeconds: number,
  events: RhythmWizardsEvent[]
): { state: RhythmWizardsState; actor: WizardActorState } {
  let nextState = state;
  let nextActor = {
    ...actor,
    cooldownRemainingSeconds: Math.max(0, actor.cooldownRemainingSeconds - dtSeconds),
    castFlashRemainingSeconds: Math.max(0, actor.castFlashRemainingSeconds - dtSeconds),
    hitFlashRemainingSeconds: Math.max(0, actor.hitFlashRemainingSeconds - dtSeconds),
  };

  if (nextActor.defeated && nextActor.action !== "death") {
    nextActor = setActorAction(nextActor, "death", deathDurationSeconds());
    nextActor.moveDir = 0;
  }

  if (nextActor.action === "attack" || nextActor.action === "stagger" || nextActor.action === "death") {
    const previousElapsed = nextActor.actionElapsedSeconds;
    const nextElapsed = Math.min(nextActor.actionDurationSeconds, previousElapsed + dtSeconds);
    nextActor.actionElapsedSeconds = nextElapsed;
    nextActor.moveDir = 0;

    if (nextActor.action === "attack" && !nextActor.attackSpawned && nextActor.pendingAttack) {
      const spawnFraction = 4.5 / 9;
      const spawnAt = nextActor.actionDurationSeconds * spawnFraction;
      if (previousElapsed < spawnAt && nextElapsed >= spawnAt) {
        const created = createProjectile(
          nextState,
          nextActor.owner,
          nextActor.x,
          nextActor.y,
          {
            owner: nextActor.owner,
            ...nextActor.pendingAttack,
          }
        );
        nextState = {
          ...created.state,
          projectiles: [...created.state.projectiles, created.projectile],
        };
        nextActor.attackSpawned = true;
      }
    }

    if (nextElapsed >= nextActor.actionDurationSeconds) {
      if (nextActor.action === "attack") {
        nextActor = {
          ...setActorAction(nextActor, "idle", 0),
          pendingAttack: null,
          attackSpawned: true,
        };
      } else if (nextActor.action === "stagger") {
        if (nextActor.pendingDefeat || nextActor.health <= 0) {
          nextActor = {
            ...setActorAction(nextActor, "death", deathDurationSeconds()),
            pendingDefeat: false,
            defeated: true,
            health: 0,
            moveDir: 0,
            pendingAttack: null,
            attackSpawned: true,
          };
        } else {
          nextActor = setActorAction(nextActor, "idle", 0);
        }
      }
    }
    return { state: nextState, actor: nextActor };
  }

  nextActor.moveDir = desiredMoveDir;
  const moving = desiredMoveDir !== 0;
  const targetAction: WizardAction = !moving ? "idle" : desiredMoveDir < 0 ? "move_left" : "move_right";
  if (nextActor.action !== targetAction) {
    nextActor = setActorAction(nextActor, targetAction, 0);
  }
  nextActor.x = clamp(
    nextActor.x + desiredMoveDir * moveSpeed * dtSeconds,
    rhythmWizardsConfig.arenaMinX,
    rhythmWizardsConfig.arenaMaxX
  );

  return { state: nextState, actor: nextActor };
}

function applyProjectileAoe(
  projectile: ProjectileState,
  player: WizardActorState,
  enemy: WizardActorState,
  obstacles: ObstacleState[],
  events: RhythmWizardsEvent[],
  atSeconds: number
): { player: WizardActorState; enemy: WizardActorState; obstacles: ObstacleState[] } {
  if (projectile.aoeRadius <= 0 || projectile.aoeDamage <= 0) {
    return { player, enemy, obstacles };
  }
  let nextPlayer = player;
  let nextEnemy = enemy;
  let nextObstacles = obstacles;

  if (canDamageOwner(projectile, PLAYER_ID)) {
    const inRadius = distanceSquared(projectile.x, projectile.y, nextPlayer.x, nextPlayer.y) <= projectile.aoeRadius * projectile.aoeRadius;
    if (inRadius) {
      nextPlayer = applyDamageToActor(nextPlayer, projectile.aoeDamage);
      events.push({ type: "enemy_hit_player", atSeconds, amount: projectile.aoeDamage, x: nextPlayer.x, y: nextPlayer.y });
    }
  }
  if (canDamageOwner(projectile, ENEMY_ID)) {
    const inRadius = distanceSquared(projectile.x, projectile.y, nextEnemy.x, nextEnemy.y) <= projectile.aoeRadius * projectile.aoeRadius;
    if (inRadius) {
      nextEnemy = applyDamageToActor(nextEnemy, projectile.aoeDamage);
      events.push({ type: "player_hit_enemy", atSeconds, amount: projectile.aoeDamage, x: nextEnemy.x, y: nextEnemy.y });
    }
  }

  nextObstacles = nextObstacles.map((obstacle) => {
    if (obstacle.destroyed) return obstacle;
    const inRadius = distanceSquared(projectile.x, projectile.y, obstacle.x, obstacle.y) <= projectile.aoeRadius * projectile.aoeRadius;
    if (!inRadius) return obstacle;
    const damage = projectile.aoeDamage * rhythmWizardsConfig.obstacleDamageMultiplier;
    const health = Math.max(0, obstacle.health - damage);
    events.push({
      type: "projectile_hit_obstacle",
      atSeconds,
      amount: damage,
      obstacleId: obstacle.id,
      x: obstacle.x,
      y: obstacle.y,
    });
    if (health <= 0 && !obstacle.destroyed) {
      events.push({ type: "obstacle_destroyed", atSeconds, obstacleId: obstacle.id, x: obstacle.x, y: obstacle.y });
    }
    return {
      ...obstacle,
      health,
      destroyed: health <= 0,
      hitFlashRemainingSeconds: OBSTACLE_HIT_FLASH_SECONDS,
    };
  });

  return { player: nextPlayer, enemy: nextEnemy, obstacles: nextObstacles };
}

function moveProjectiles(
  projectiles: ProjectileState[],
  dtSeconds: number,
  player: WizardActorState,
  enemy: WizardActorState,
  obstacles: ObstacleState[],
  atSeconds: number
): { projectiles: ProjectileState[]; player: WizardActorState; enemy: WizardActorState; obstacles: ObstacleState[]; events: RhythmWizardsEvent[] } {
  let nextPlayer = player;
  let nextEnemy = enemy;
  let nextObstacles = obstacles;
  const events: RhythmWizardsEvent[] = [];
  const alive: ProjectileState[] = [];

  for (const projectile of projectiles) {
    const moved: ProjectileState = {
      ...projectile,
      x: projectile.x + projectile.vx * dtSeconds,
      y: projectile.y + projectile.vy * dtSeconds,
      ttlRemainingSeconds: projectile.ttlRemainingSeconds - dtSeconds,
    };
    if (moved.ttlRemainingSeconds <= 0) {
      continue;
    }

    let consumed = false;
    for (const obstacle of nextObstacles) {
      if (obstacle.destroyed) continue;
      const hitObstacle = circleIntersectsRect(moved.x, moved.y, moved.radius, obstacle.x, obstacle.y, obstacle.width, obstacle.height);
      if (!hitObstacle) continue;
      consumed = true;
      const damage = moved.directDamage * rhythmWizardsConfig.obstacleDamageMultiplier;
      const health = Math.max(0, obstacle.health - damage);
      nextObstacles = nextObstacles.map((entry) =>
        entry.id === obstacle.id
          ? {
              ...entry,
              health,
              destroyed: health <= 0,
              hitFlashRemainingSeconds: OBSTACLE_HIT_FLASH_SECONDS,
            }
          : entry
      );
      events.push({ type: "projectile_hit_obstacle", atSeconds, amount: damage, obstacleId: obstacle.id, x: obstacle.x, y: obstacle.y });
      if (health <= 0) {
        events.push({ type: "obstacle_destroyed", atSeconds, obstacleId: obstacle.id, x: obstacle.x, y: obstacle.y });
      }
      const aoeApplied = applyProjectileAoe(moved, nextPlayer, nextEnemy, nextObstacles, events, atSeconds);
      nextPlayer = aoeApplied.player;
      nextEnemy = aoeApplied.enemy;
      nextObstacles = aoeApplied.obstacles;
      break;
    }
    if (consumed) continue;

    if (canDamageOwner(moved, ENEMY_ID)) {
      const hitEnemy = distanceSquared(moved.x, moved.y, nextEnemy.x, nextEnemy.y) <= (moved.radius + rhythmWizardsConfig.wizardRadius) * (moved.radius + rhythmWizardsConfig.wizardRadius);
      if (hitEnemy) {
        nextEnemy = applyDamageToActor(nextEnemy, moved.directDamage);
        events.push({ type: "player_hit_enemy", atSeconds, amount: moved.directDamage, x: nextEnemy.x, y: nextEnemy.y });
        const aoeApplied = applyProjectileAoe(moved, nextPlayer, nextEnemy, nextObstacles, events, atSeconds);
        nextPlayer = aoeApplied.player;
        nextEnemy = aoeApplied.enemy;
        nextObstacles = aoeApplied.obstacles;
        continue;
      }
    }

    if (canDamageOwner(moved, PLAYER_ID)) {
      const hitPlayer = distanceSquared(moved.x, moved.y, nextPlayer.x, nextPlayer.y) <= (moved.radius + rhythmWizardsConfig.wizardRadius) * (moved.radius + rhythmWizardsConfig.wizardRadius);
      if (hitPlayer) {
        nextPlayer = applyDamageToActor(nextPlayer, moved.directDamage);
        events.push({ type: "enemy_hit_player", atSeconds, amount: moved.directDamage, x: nextPlayer.x, y: nextPlayer.y });
        const aoeApplied = applyProjectileAoe(moved, nextPlayer, nextEnemy, nextObstacles, events, atSeconds);
        nextPlayer = aoeApplied.player;
        nextEnemy = aoeApplied.enemy;
        nextObstacles = aoeApplied.obstacles;
        continue;
      }
    }

    if (moved.x < 0 || moved.x > 1 || moved.y < 0 || moved.y > 1) {
      continue;
    }
    alive.push(moved);
  }

  return { projectiles: alive, player: nextPlayer, enemy: nextEnemy, obstacles: nextObstacles, events };
}

export function stepRhythmWizardsState(
  state: RhythmWizardsState,
  input: StepInput,
  beatTimelineSeconds: number[]
): { state: RhythmWizardsState; events: RhythmWizardsEvent[] } {
  if (state.ended) {
    return { state, events: [] };
  }

  const nextRandom = createSeededRandom((state.seed + Math.floor(input.heardTimeSeconds * 1000)) >>> 0);
  const clampedDt = clamp(input.dtSeconds, 0.001, 0.05);
  let nextState: RhythmWizardsState = {
    ...state,
    timeSeconds: input.heardTimeSeconds,
  };
  const events: RhythmWizardsEvent[] = [];

  const ai = decideEnemyAction(nextState, clampedDt, beatTimelineSeconds, nextRandom);
  nextState = {
    ...nextState,
    ai: ai.nextState,
    obstacles: nextState.obstacles.map((obstacle) => updateObstacleMotion(obstacle, clampedDt, rhythmWizardsConfig, nextRandom)),
  };

  const playerStep = resolveActorAction(
    nextState,
    nextState.player,
    clampedDt,
    rhythmWizardsConfig.playerMoveSpeed,
    input.playerMoveDir,
    input.heardTimeSeconds,
    events
  );
  nextState = { ...playerStep.state, player: playerStep.actor };

  const enemyStep = resolveActorAction(
    nextState,
    nextState.enemy,
    clampedDt,
    rhythmWizardsConfig.enemyMoveSpeed,
    ai.moveDir,
    input.heardTimeSeconds,
    events
  );
  nextState = { ...enemyStep.state, enemy: enemyStep.actor };

  if (ai.shouldCast && !nextState.enemy.defeated && nextState.enemy.cooldownRemainingSeconds <= 0 && !isMovementLocked(nextState.enemy.action)) {
    const aiBeat = evaluateBeatSync(
      input.heardTimeSeconds,
      beatTimelineSeconds,
      {
        perfect: 0.04,
        great: 0.08,
        good: 0.13,
        poor: 0.2,
      },
      rhythmWizardsConfig.beatBonusDamageMultiplier,
      rhythmWizardsConfig.beatAoeRadius
    );
    const castResult = castSpell(nextState, {
      owner: ENEMY_ID,
      targetX: ai.targetX,
      targetY: ai.targetY,
      heardTimeSeconds: input.heardTimeSeconds,
      judgement: aiBeat.judgement,
      bonusMultiplier: aiBeat.bonusMultiplier,
      aoeRadius: aiBeat.aoeRadius,
    });
    nextState = castResult.state;
    events.push(...castResult.events);
  }

  const moved = moveProjectiles(
    nextState.projectiles,
    clampedDt,
    nextState.player,
    nextState.enemy,
    nextState.obstacles,
    input.heardTimeSeconds
  );
  nextState = {
    ...nextState,
    projectiles: moved.projectiles,
    player: moved.player,
    enemy: moved.enemy,
    obstacles: moved.obstacles,
  };
  events.push(...moved.events);

  if (nextState.player.defeated && nextState.player.action === "death" && nextState.player.actionElapsedSeconds >= nextState.player.actionDurationSeconds && !nextState.ended) {
    nextState = { ...nextState, ended: true, winner: ENEMY_ID };
    events.push({ type: "player_defeated", atSeconds: input.heardTimeSeconds, x: nextState.player.x, y: nextState.player.y });
  } else if (nextState.enemy.defeated && nextState.enemy.action === "death" && nextState.enemy.actionElapsedSeconds >= nextState.enemy.actionDurationSeconds && !nextState.ended) {
    nextState = { ...nextState, ended: true, winner: PLAYER_ID };
    events.push({ type: "enemy_defeated", atSeconds: input.heardTimeSeconds, x: nextState.enemy.x, y: nextState.enemy.y });
  }

  return { state: nextState, events };
}

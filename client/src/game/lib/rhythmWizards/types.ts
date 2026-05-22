export type WizardOwner = "player" | "enemy";
export type MoveDirection = -1 | 0 | 1;
export type CombatJudgement = "perfect" | "great" | "good" | "none";
export type DamageTier = "healthy" | "damaged" | "critical" | "defeated";
export type WizardAction = "idle" | "move_left" | "move_right" | "attack" | "stagger" | "death";
export type WizardAiDifficulty = "novice" | "apprentice" | "adept" | "master" | "archmage";

export interface PendingAttack {
  targetX: number;
  targetY: number;
  heardTimeSeconds: number;
  judgement: CombatJudgement;
  bonusMultiplier: number;
  aoeRadius: number;
}

export interface WizardActorState {
  owner: WizardOwner;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  moveDir: MoveDirection;
  cooldownRemainingSeconds: number;
  castFlashRemainingSeconds: number;
  hitFlashRemainingSeconds: number;
  defeated: boolean;
  pendingDefeat: boolean;
  action: WizardAction;
  actionElapsedSeconds: number;
  actionDurationSeconds: number;
  actionToken: number;
  pendingAttack: PendingAttack | null;
  attackSpawned: boolean;
}

export interface ObstacleState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  health: number;
  maxHealth: number;
  moveDir: MoveDirection;
  speed: number;
  decisionRemainingSeconds: number;
  destroyed: boolean;
  hitFlashRemainingSeconds: number;
}

export interface ProjectileState {
  id: string;
  owner: WizardOwner;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  directDamage: number;
  aoeDamage: number;
  aoeRadius: number;
  ttlRemainingSeconds: number;
  beatJudgement: CombatJudgement;
}

export interface RhythmWizardsAiState {
  moveDecisionRemainingSeconds: number;
  castDecisionRemainingSeconds: number;
}

export interface RhythmWizardsState {
  aiDifficulty: WizardAiDifficulty;
  timeSeconds: number;
  seed: number;
  nextProjectileId: number;
  ended: boolean;
  winner: WizardOwner | "draw" | null;
  player: WizardActorState;
  enemy: WizardActorState;
  obstacles: ObstacleState[];
  projectiles: ProjectileState[];
  ai: RhythmWizardsAiState;
}

export interface RhythmWizardsConfig {
  arenaMinX: number;
  arenaMaxX: number;
  playerY: number;
  enemyY: number;
  wizardRadius: number;
  obstacleMinX: number;
  obstacleMaxX: number;
  playerMoveSpeed: number;
  enemyMoveSpeed: number;
  projectileSpeed: number;
  projectileRadius: number;
  projectileLifetimeSeconds: number;
  castCooldownSeconds: number;
  moveFrameMs: number;
  attackFrameMs: number;
  staggerFrameMs: number;
  deathFrameMs: number;
  playerHealth: number;
  enemyHealth: number;
  obstacleHealth: number;
  directDamageBase: number;
  beatBonusDamageMultiplier: number;
  aoeDamageMultiplier: number;
  obstacleDamageMultiplier: number;
  beatAoeRadius: number;
  obstacleRandomIdleChance: number;
  obstacleDecisionMinSeconds: number;
  obstacleDecisionMaxSeconds: number;
  obstacleSpeedMin: number;
  obstacleSpeedMax: number;
}

export interface SpellCastRequest {
  owner: WizardOwner;
  targetX: number;
  targetY: number;
  heardTimeSeconds: number;
  judgement: CombatJudgement;
  bonusMultiplier: number;
  aoeRadius: number;
}

export interface StepInput {
  dtSeconds: number;
  heardTimeSeconds: number;
  playerMoveDir: MoveDirection;
}

export interface RhythmWizardsEvent {
  type:
    | "player_cast"
    | "enemy_cast"
    | "player_hit_enemy"
    | "enemy_hit_player"
    | "projectile_hit_obstacle"
    | "obstacle_destroyed"
    | "enemy_defeated"
    | "player_defeated";
  atSeconds: number;
  amount?: number;
  obstacleId?: string;
  judgement?: CombatJudgement;
  x?: number;
  y?: number;
}

import type { DamageTier, WizardAction, WizardOwner } from "./types";
import { runtimeConfig } from "../../config/runtime";

const ROOT = "/game-graphics/rhythm-wizards";

export interface SpriteAnimationSpec {
  frames: number;
  frameDurationMs: number;
  loop: boolean;
}

export interface SpriteAsset {
  src: string;
  animation?: SpriteAnimationSpec;
}

export interface WizardSpriteSet {
  idle: SpriteAsset;
  moveLeft: SpriteAsset;
  moveRight: SpriteAsset;
  attack: SpriteAsset;
  stagger: SpriteAsset;
  death: SpriteAsset;
}

export interface ObstacleSpriteSet {
  healthy: SpriteAsset;
  damaged: SpriteAsset;
  critical: SpriteAsset;
  defeated: SpriteAsset;
}

export const rhythmWizardsAssets: {
  battlefield: SpriteAsset;
  player: WizardSpriteSet;
  enemy: WizardSpriteSet;
  obstacle1: ObstacleSpriteSet;
  obstacle2: ObstacleSpriteSet;
  controls: { left: SpriteAsset; right: SpriteAsset };
} = {
  battlefield: { src: `${ROOT}/battlefield/background.png` },
  player: {
    idle: { src: `${ROOT}/wizards/player/idle.png`, animation: { frames: 1, frameDurationMs: 120, loop: true } },
    moveLeft: { src: `${ROOT}/wizards/player/move-left-strip.png`, animation: { frames: 2, frameDurationMs: runtimeConfig.gameRhythmWizardsMoveFrameMs, loop: true } },
    moveRight: { src: `${ROOT}/wizards/player/move-right-strip.png`, animation: { frames: 2, frameDurationMs: runtimeConfig.gameRhythmWizardsMoveFrameMs, loop: true } },
    attack: { src: `${ROOT}/wizards/player/attack-strip.png`, animation: { frames: 9, frameDurationMs: runtimeConfig.gameRhythmWizardsAttackFrameMs, loop: false } },
    stagger: { src: `${ROOT}/wizards/player/stagger-strip.png`, animation: { frames: 7, frameDurationMs: runtimeConfig.gameRhythmWizardsStaggerFrameMs, loop: false } },
    death: { src: `${ROOT}/wizards/player/death-strip.png`, animation: { frames: 6, frameDurationMs: runtimeConfig.gameRhythmWizardsDeathFrameMs, loop: false } },
  },
  enemy: {
    idle: { src: `${ROOT}/wizards/enemy/idle.png`, animation: { frames: 1, frameDurationMs: 120, loop: true } },
    moveLeft: { src: `${ROOT}/wizards/enemy/move-left-strip.png`, animation: { frames: 2, frameDurationMs: runtimeConfig.gameRhythmWizardsMoveFrameMs, loop: true } },
    moveRight: { src: `${ROOT}/wizards/enemy/move-right-strip.png`, animation: { frames: 2, frameDurationMs: runtimeConfig.gameRhythmWizardsMoveFrameMs, loop: true } },
    attack: { src: `${ROOT}/wizards/enemy/attack-strip.png`, animation: { frames: 9, frameDurationMs: runtimeConfig.gameRhythmWizardsAttackFrameMs, loop: false } },
    stagger: { src: `${ROOT}/wizards/enemy/stagger-strip.png`, animation: { frames: 7, frameDurationMs: runtimeConfig.gameRhythmWizardsStaggerFrameMs, loop: false } },
    death: { src: `${ROOT}/wizards/enemy/death-strip.png`, animation: { frames: 6, frameDurationMs: runtimeConfig.gameRhythmWizardsDeathFrameMs, loop: false } },
  },
  obstacle1: {
    healthy: { src: `${ROOT}/obstacles/obstacle-1-healthy.png` },
    damaged: { src: `${ROOT}/obstacles/obstacle-1-damaged.png` },
    critical: { src: `${ROOT}/obstacles/obstacle-1-critical.png` },
    defeated: { src: `${ROOT}/obstacles/obstacle-1-defeated.png` },
  },
  obstacle2: {
    healthy: { src: `${ROOT}/obstacles/obstacle-2-healthy.png` },
    damaged: { src: `${ROOT}/obstacles/obstacle-2-damaged.png` },
    critical: { src: `${ROOT}/obstacles/obstacle-2-critical.png` },
    defeated: { src: `${ROOT}/obstacles/obstacle-2-defeated.png` },
  },
  controls: {
    left: { src: `${ROOT}/controls/left.png` },
    right: { src: `${ROOT}/controls/right.png` },
  },
};

export function getDamageTier(health: number, maxHealth: number, defeated: boolean): DamageTier {
  if (defeated || health <= 0 || maxHealth <= 0) return "defeated";
  const ratio = Math.max(0, Math.min(1, health / maxHealth));
  if (ratio <= 0.33) return "critical";
  if (ratio <= 0.66) return "damaged";
  return "healthy";
}

export function selectWizardSprite(
  owner: WizardOwner,
  action: WizardAction
): SpriteAsset {
  const set = owner === "player" ? rhythmWizardsAssets.player : rhythmWizardsAssets.enemy;
  if (action === "move_left") return set.moveLeft;
  if (action === "move_right") return set.moveRight;
  if (action === "attack") return set.attack;
  if (action === "stagger") return set.stagger;
  if (action === "death") return set.death;
  return set.idle;
}

export function selectObstacleSprite(index: number, tier: DamageTier): SpriteAsset {
  const set = index === 0 ? rhythmWizardsAssets.obstacle1 : rhythmWizardsAssets.obstacle2;
  return set[tier];
}

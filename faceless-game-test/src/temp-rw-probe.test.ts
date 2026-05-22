import { describe, test } from "vitest";
import { castSpell, createRhythmWizardsState, stepRhythmWizardsState } from "../../client/src/game/lib/rhythmWizards/simulation";

const beatTimeline = Array.from({ length: 200 }, (_, i) => 0.5 + i * 0.5);

describe("rw probe", () => {
  test("probe hits", () => {
    let state = createRhythmWizardsState("normal", 1234);
    let heard = 0;
    let nextCastAt = 0;
    let ph = 0;
    let eh = 0;
    let oh = 0;

    for (let i = 0; i < 1800; i += 1) {
      if (heard >= nextCastAt && state.player.cooldownRemainingSeconds <= 0 && state.player.action === "idle") {
        state = castSpell(state, {
          owner: "player",
          targetX: state.enemy.x,
          targetY: state.enemy.y,
          heardTimeSeconds: heard,
          judgement: "none",
          bonusMultiplier: 1,
          aoeRadius: 0,
        }).state;
        nextCastAt = heard + 0.7;
      }
      heard += 1 / 60;
      const stepped = stepRhythmWizardsState(state, { dtSeconds: 1 / 60, heardTimeSeconds: heard, playerMoveDir: 0 }, beatTimeline);
      state = stepped.state;
      ph += stepped.events.filter((e) => e.type === "enemy_hit_player").length;
      eh += stepped.events.filter((e) => e.type === "player_hit_enemy").length;
      oh += stepped.events.filter((e) => e.type === "projectile_hit_obstacle").length;
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ph, eh, oh, playerHp: state.player.health, enemyHp: state.enemy.health }));
  });
});

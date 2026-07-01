## Goal

Extend the shared rhythm-game library metadata contract so published rhythm-game assets can declare which game modes they support.

## Current State

- The shared library contract already carries rhythm-game volume and game-availability metadata.
- It does not yet carry mode compatibility.
- The site game code currently treats:
  - `step_arrows` as primary
  - `orb_beat` as separate
  - `laser_shoot` as falling back to `step_arrows`

## Scope

1. Add supported-mode metadata to the shared rhythm-game contract.
2. Keep the change backward compatible for older rhythm-game items.
3. Leave deeper consumer filtering for follow-up work unless a direct compile/runtime update is required immediately.

## Implementation Approach

- Add a `supportedGameModes` object to the shared rhythm-game metadata schema and types.
- Use explicit booleans for:
  - `stepArrows`
  - `orbBeat`
  - `laserShoot`
- Default behavior for older records should remain sensible at the consumer edge.

## Affected Files

- `docs/plans/rhythm-game-mode-availability-2026-07-01.md`
- `shared/src/schemas/rhythmGame.ts`
- `shared/src/types/rhythmGame.ts`
- `shared/src/index.ts`

## Tradeoffs

- Adding a compact object now is simpler than inventing a broader game-capability matrix.
- We are encoding current reality instead of promising cross-mode compatibility we do not actually have.

## Risks

- Consumers that assume the field always exists must still handle older published records.

## Validation

- TypeScript compile for the shared package and any immediate consumers.

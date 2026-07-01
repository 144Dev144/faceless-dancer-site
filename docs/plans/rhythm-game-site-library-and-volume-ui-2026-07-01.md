## Goal

Polish the site-side rhythm-game experience so published Dance Station levels are understandable and browsable.

This phase focuses on:

1. showing rhythm-game mode compatibility clearly in the library UI
2. replacing the temporary volume dropdown in the game menu with grouped volume sections

This phase does **not** perform an aggressive backfill or migration of existing rhythm-game data.

## Current State

- The site can now bridge published `rhythm_game` library items into the playable game catalog.
- Library cards do not yet surface rhythm-game-specific metadata well.
- The game menu currently uses a temporary volume filter dropdown.
- Existing rhythm-game data already in legacy storage must remain untouched and playable.

## Scope

### Library UI

- Extend library cards so rhythm-game assets show:
  - game-enabled state
  - volume label
  - supported modes

### Game Menu

- Replace the temporary volume dropdown with grouped volume sections in the song browser.
- Keep the existing song-card behavior, audio preview flow, difficulty selection, scoring path, and dance-off compatibility.

## Implementation Approach

### Library cards

- Read rhythm-game metadata directly from the existing `LibraryItem.metadata`.
- Normalize mode labels for display:
  - Step Arrows
  - Orb Beat
  - Rhythm Wizards
- Add these as factual badges instead of verbose copy.

### Grouped game menu

- Keep a flat `songs` state for logic and lookup.
- Build grouped render sections from `songs` by volume metadata.
- Preserve the existing selected-song mechanics by targeting song cards directly via `data-song-id`.
- Keep volume grouping purely presentational so runtime/game logic does not fork.

## Affected Files

- `docs/plans/rhythm-game-site-library-and-volume-ui-2026-07-01.md`
- `client/src/components/library/LibraryAssetCard.tsx`
- `client/src/game/components/GameView.tsx`
- `client/src/styles.css`

## Tradeoffs

- Grouping by volume in the view layer is safer than introducing a new catalog abstraction now.
- Keeping the existing catalog and selection mechanics avoids risking regressions in preview, start-game, and score flows.

## Risks

- Grouped sections add more DOM structure inside the rolodex, so spacing and scroll focus need to stay clean.
- Some older rhythm-game items may still have sparse metadata; display logic must handle that without breaking cards.

## Validation

1. Open the public library and confirm rhythm-game cards show volume and supported modes.
2. Open the game menu and confirm songs are grouped by volume.
3. Confirm selecting a song in any volume still:
   - highlights correctly
   - previews correctly
   - starts correctly
4. Confirm official legacy songs remain present and playable.

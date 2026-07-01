## Goal

Change the game song browser so it loads by volume instead of loading the full catalog up front.

The browser should:

1. let the player choose a volume from a styled dropdown
2. show the song count for each volume in that dropdown
3. load only 10 songs at a time for the selected volume
4. append the next page only when the user scrolls through the rolodex

## Current State

- The game menu currently loads `/api/public/songs/enabled` as one full list.
- Songs are now grouped visually by volume, but the full catalog still arrives in one payload.
- This is too expensive as the catalog grows.

## Scope

### Server

1. Extend the public song catalog endpoint to support:
   - `volumeId`
   - `limit`
   - `offset`
2. Add a lightweight volume summary endpoint or include volume counts in the catalog response.
3. Keep existing song summary shape stable while adding:
   - total count for the selected volume page
   - volume counts for the selector

### Client

1. Replace the grouped-all-volumes view with:
   - volume selector
   - lazy/incremental paging inside the rolodex
2. Load only the first 10 songs for the selected volume initially.
3. Detect near-end scroll and fetch the next page.
4. Preserve:
   - song selection
   - preview audio
   - mode selection
   - difficulty selection
   - start-game flow

## Implementation Approach

### API

- Add paged loading to `/api/public/songs/enabled`.
- Return:
  - `songs`
  - `total`
  - `hasMore`
  - `volumes` with `{ volumeId, volumeLabel, officialVolume, songCount }`
- Keep filtering non-destructive and based on existing catalog rows.

### Client

- Keep a dedicated selected volume state.
- Reset rolodex paging when volume changes.
- Request:
  - first page on initial load
  - next page when scroll reaches the end threshold
- Use a styled select for volume choice with labels like:
  - `Faceless Volume 1 (24)`
  - `Hip Hop (8)`

## Affected Files

- `docs/plans/rhythm-game-volume-paging-2026-07-01.md`
- `server/src/modules/game/routes.ts`
- possibly `server/src/modules/library/rhythmGameLibrary.ts`
- `client/src/game/components/GameView.tsx`
- `client/src/styles.css`

## Tradeoffs

- Server-side paging is the correct fix; client-only grouping still leaves startup slow.
- Keeping the existing endpoint and extending it is safer than inventing a separate song-browser API.

## Risks

- Scroll-triggered paging can duplicate requests if not guarded carefully.
- Selection/preview state must reset cleanly when the volume changes.
- Official and creator volumes need stable sorting so the selector does not jump around.

## Validation

1. Load the game menu and confirm only one volume page is fetched.
2. Confirm the volume selector shows song counts.
3. Scroll to the end of the rolodex and confirm the next 10 songs append.
4. Change volume and confirm:
   - song list resets
   - first page loads for that volume
   - selection/preview stay sane
5. Confirm legacy official songs still load and play normally.

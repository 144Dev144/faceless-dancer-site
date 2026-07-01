## Goal

Make published `rhythm_game` library items actually playable in Faceless Dance Stage.

That means:

1. published rhythm-game items marked as game-enabled must appear in the site game catalog
2. their supported game modes must be respected
3. their creator volume metadata must be available to the game UI so players can browse by volume
4. existing score and dance-off flows must keep working

## Current State

- The public library can already store and publish `rhythm_game` items.
- Legacy official songs/charts still drive the live game catalog through:
  - `game_songs`
  - legacy saved beat entry storage
- The game UI currently loads playable songs from `/api/public/songs/enabled`.
- Scores and dance-offs still depend on `game_songs` rows.
- Published creator rhythm-game items are not yet bridged into that runtime path.

## Scope

### Server

1. Add a bridge between published `rhythm_game` library items and `game_songs`.
2. Expose creator-published rhythm-game items through the public game endpoints.
3. Respect:
   - `gameEnabled`
   - `supportedGameModes`
   - rhythm-game volume metadata
4. Keep legacy official songs working without regression.

### Client

1. Extend the game song summary shape with:
   - volume metadata
   - creator metadata where available
   - supported-mode metadata if needed
2. Add basic volume-aware discovery in the game menu.
3. Continue to use the existing per-song mode buttons, but only for modes actually available for that song.

## Implementation Approach

### 1. Catalog bridge

- Keep `game_songs` as the authoritative catalog row used by scores and dance-offs.
- When a public library item of kind `rhythm_game` is published or updated:
  - if it is game-enabled, upsert a matching `game_songs` row keyed by the library item id
  - if it is revoked or marked not game-enabled, disable the corresponding `game_songs` row
- Do not duplicate the media files into a second storage system yet.

### 2. Runtime asset adapter

- Add a server-side adapter that can read a published `rhythm_game` library item and present it like a playable beat entry:
  - chart JSON
  - audio stream
  - optional cover image
- Public game endpoints should first try legacy beat-entry storage, then fall back to the published-library rhythm-game adapter.

### 3. Mode and volume metadata

- Derive available game modes from the chart itself, then intersect that with `supportedGameModes`.
- Return volume metadata in `/api/public/songs/enabled` so the client can group or filter by volume.
- Keep `laser_shoot` behavior aligned with the existing `step_arrows` fallback model.

### 4. Client game menu

- Add a volume selector or grouped browsing affordance in the song menu.
- Keep the current song-selection flow, but filter the visible songs by selected volume.
- Show creator-published songs and official songs in one coherent catalog.

## Affected Files

- `docs/plans/rhythm-game-catalog-bridge-2026-07-01.md`
- `server/src/modules/library/routes.ts`
- `server/src/modules/library/officialRhythmGames.ts`
- `server/src/modules/game/routes.ts`
- `server/src/modules/game/service.ts`
- new server helper module for published rhythm-game catalog/runtime bridging
- `client/src/game/components/GameView.tsx`
- possibly `client/src/game/types/beat.ts` or local summary types if extraction is worthwhile

## Tradeoffs

- Using `game_songs` as the bridge avoids breaking scores and dance-offs.
- Reading chart/audio directly from published library files avoids redundant file copies.
- This preserves the legacy runtime while giving published creator content a real path into the game.

## Risks

- Library rhythm-game items may be missing required files or malformed chart JSON.
- Older published rhythm-game items may need metadata defaults for supported modes.
- The client game menu can become cluttered if volume browsing is not handled cleanly.

## Validation

1. Publish a rhythm-game asset from Dance Station with game enabled.
2. Confirm a `game_songs` row exists and is enabled for that item.
3. Confirm `/api/public/songs/enabled` includes it with the right:
   - available modes
   - difficulty counts
   - volume metadata
4. Confirm the game menu can browse/select it.
5. Start a game on it and confirm:
   - chart loads
   - audio plays
   - score submission still works
6. Revoke the item and confirm it disappears from the enabled song catalog.

## Goal

Support creator rhythm-game volumes in the public library, and expose the site's legacy saved-beat catalog as the first official volume: `Faceless Volume 1`.

## Current State

- Public library items live in the `library_items` / `library_files` tables with generic `metadata_json`.
- Legacy rhythm-game songs/charts still live in the older saved-beat storage flow and are not library items.
- Dance Station can already publish `rhythm_game` library items, but volume/game-specific metadata is not yet standardized.

## Approach

### 1. Shared schema

Define a canonical shared metadata contract for rhythm-game library items:

- `game_enabled`
- `volume_id`
- `volume_label`
- `volume_slug`
- `official_volume`
- `legacy_catalog_source`
- optional ordering/display metadata

This stays inside generic library item metadata, so we do not need a new table just to begin.

### 2. Legacy official volume adapter

Do not migrate legacy source data yet.

Instead:

- synthesize legacy saved-beat entries into public-library-shaped `rhythm_game` items
- expose them through the library list/detail APIs
- assign them to:
  - `volume_id = "faceless-volume-1"`
  - `volume_label = "Faceless Volume 1"`
  - `official_volume = true`

This makes them immediately available to Dance Station import flows and library browsing without destructive migration.

### 3. Public library routes

Extend `/api/library` and `/api/library/:id` so they can include synthetic official rhythm-game items alongside DB-backed library items.

### 4. Future compatibility

Keep the shared metadata contract simple so later we can:

- add creator-owned volume tables if needed
- add player-facing volume browsing/filtering
- materialize legacy items into first-class DB rows later without breaking consumers

## Affected Files

- `shared/src/schemas/library.ts`
- `shared/src/types/library.ts`
- `server/src/modules/library/routes.ts`
- new helper module for synthetic official rhythm-game library items
- possibly lightweight client typing helpers if needed

## Tradeoffs

- Synthetic official items avoid risky migration, but they do mean the library has two backing sources for a while.
- Keeping volume data in metadata is the fastest clean path now. Dedicated volume tables can come later if we need stronger querying/admin tooling.

## Validation

- `/api/library?kind=rhythm_game` returns:
  - DB-backed published rhythm-game items
  - synthetic official `Faceless Volume 1` items from legacy storage
- `/api/library/:id` resolves a synthetic official rhythm-game item correctly
- Dance Station can import one of those official items through the public library flow
- New Dance Station-published rhythm-game items can carry the same volume metadata contract

## Goal

Fix the Dance Stage song browser so load time scales with the requested volume page, not with the full enabled catalog.

The current behavior is wrong:

1. loading 10 songs takes as long as loading all songs
2. loading a volume with 1 song still takes as long as a large volume
3. the public song list path does full catalog hydration before filtering and paging

The target behavior is:

1. volume selection stays available with song counts
2. the first page loads quickly
3. additional pages append on scroll
4. per-song heavy work only happens for the requested page

## Current State

The hot path is `GET /api/public/songs/enabled` in `server/src/modules/game/routes.ts`.

Right now it:

1. calls `ensurePublishedRhythmCatalogFresh()`
2. loads all enabled songs
3. for every enabled song:
   - reads the playable entry
   - for published items, reads the library item again
   - downloads and parses the chart JSON from Bunny
4. only after that:
   - builds volume counts
   - filters by volume
   - applies `limit` and `offset`

That means request cost is tied to total enabled songs, even when the client asks for a single song or one 10-song page.

## Scope

### Server

Restructure the public song catalog path so it works in two stages:

1. cheap catalog selection
2. page-only summary hydration

Specifically:

1. keep `/api/public/songs/enabled` as the client endpoint
2. resolve the selected volume and page from cheap catalog data first
3. only hydrate song summaries for the requested page
4. stop downloading every chart file just to compute the visible page
5. keep the response shape stable for the client

### Client

Client changes should stay minimal. The current paging UI is already correct in shape.

Only adjust the client if the server response needs a small compatibility update.

## Implementation Approach

### 1. Split cheap catalog selection from heavy song hydration

Add a server-side path that first builds a lightweight enabled-song catalog:

- `beatEntryId`
- `title`
- `coverImageUrl` or cover reference
- volume metadata
- creator display name
- enough sort/filter fields to page by volume

This stage must not download chart JSON from Bunny.

Use that cheap catalog to:

1. build the volume list and counts
2. choose the active volume
3. filter songs for that volume
4. slice the requested page

Only after that should the server hydrate the selected page into full `EnabledSongSummary` rows.

### 2. Reduce duplicate published-item work

The current path reads published-library metadata twice for published songs:

1. once indirectly through playable-entry lookup
2. once again through published-item lookup

Refactor this so published library metadata is resolved once per requested page item and reused.

### 3. Stop using Bunny chart downloads for menu-only fields when possible

The menu needs:

- title
- cover
- volume
- creator
- game mode availability
- difficulty counts
- note counts

Where those fields already exist in DB-backed library metadata or a local cache, use that instead of downloading the chart file again.

If a small subset of beat/difficulty summary fields is missing from stored metadata, add a narrow cached summary layer rather than keeping full chart downloads in the list endpoint.

### 4. Keep catalog freshness out of the hot path where possible

`ensurePublishedRhythmCatalogFresh()` is acceptable as a background sync guard, but it is a bad fit for every public catalog request.

This pass should either:

1. narrow when it runs, or
2. keep it but ensure the expensive song-summary work no longer depends on it

The first step is to remove full per-song hydration from the request path. If the sync guard is still a measurable bottleneck after that, follow up by moving it behind a more explicit trigger or longer cache window.

## Affected Files

- `docs/plans/rhythm-game-song-list-performance-2026-07-01.md`
- `server/src/modules/game/routes.ts`
- `server/src/modules/library/rhythmGameLibrary.ts`
- possibly `server/src/modules/game/service.ts`
- possibly `shared/src/types/rhythmGame.ts` or related shared schemas if a cached summary shape is introduced
- possibly `client/src/game/components/GameView.tsx` if the response needs a small compatibility tweak

## Tradeoffs

- Keeping the same endpoint is lower risk than introducing a second public catalog endpoint.
- The fastest clean fix is to page/filter first and hydrate second.
- If difficulty/mode counts are only derivable from downloaded chart JSON today, we may need a cached summary field for published rhythm assets. That adds a small amount of write-time complexity to remove a large amount of read-time waste.

## Risks

1. Legacy official songs and published rhythm assets currently share one response path. The refactor must preserve both.
2. If mode/difficulty counts are not already persisted anywhere cheap, there is a risk of partial regression unless the summary source is chosen carefully.
3. Any caching of summary metadata must stay consistent when published rhythm assets are updated or revoked.

## Validation

1. Request `/api/public/songs/enabled?limit=10` and confirm the route only hydrates the requested page.
2. Request a volume with a single song and confirm response time is materially lower than before.
3. Confirm the volume dropdown still shows correct counts.
4. Confirm scrolling still appends additional pages correctly.
5. Confirm legacy official songs still appear, preview, and start normally.
6. Confirm published rhythm-game songs still show correct cover, creator, and game-mode availability.

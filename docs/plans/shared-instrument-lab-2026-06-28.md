# Shared Instrument Lab Module

## Goal

Stop maintaining a separate site Instrument Lab. The standalone Dance Station Instrument Lab is the source of truth and is currently working the way we want. We need to extract its framework-agnostic editor/runtime pieces into a shared module so both standalone Dance Station and the website use the same Instrument Lab implementation.

## Non-Negotiable Constraint

Do not break standalone Dance Station.

Standalone keeps its current working code path until the shared module is extracted and verified. The final standalone switch to the shared module happens in a separate commit after build/runtime checks pass.

## Source of Truth

Use the current standalone implementation in `D:\autotransition`:

- `src/autotransition/ui/static/index.html`
- `src/autotransition/ui/static/app.js`
- `src/autotransition/ui/static/styles.css`
- `src/autotransition/ui/static/instruments/`

Extract the working Instrument Lab behavior from those files rather than recreating it from memory or loosely porting concepts.

## Shared Repo

Create a shared package/repo:

- `D:\dance-station-instrument-lab`
- remote later: `https://github.com/The-Faceless-Dev/dance-station-instrument-lab.git`

The shared module should expose:

- Instrument Lab HTML renderer / mount function
- shared CSS
- instrument assets and bank metadata
- piano-roll state and drawing
- cursor/playhead model
- scroll/zoom/fit behavior
- track list and track state
- add/import track flows
- note create/move/resize/select/copy/paste/delete behavior
- keyboard and piano input
- playback and record timing
- render/save hooks

## Adapter Boundary

The shared module must not hardcode standalone or site storage.

It should call host adapters for:

- listing existing audio creations
- loading audio asset URLs/blobs
- saving rendered instrument tracks/clips
- showing status/toast messages
- loading user-imported instruments where supported

Standalone adapter:

- uses FastAPI/local filesystem endpoints already present in `D:\autotransition`
- preserves current local asset and instrument behavior

Site adapter:

- uses IndexedDB/private assets and site library helpers
- disables or hides backend-only paths until the site has matching support

## Extraction Strategy

1. Create the shared repo without changing standalone behavior.
2. Copy the exact current Instrument Lab HTML/CSS/JS slices from standalone into the shared repo.
3. Isolate dependencies behind adapter hooks, keeping logic otherwise as close as possible to standalone.
4. Add a small standalone-style demo page in the shared repo to verify the module outside either host.
5. Add the shared repo as a submodule to the site and embed it with the site adapter.
6. Verify the site uses the shared module instead of its current partial Instrument Lab.
7. Only after the site works, add the shared repo as a submodule to standalone and replace the standalone inline Instrument Lab with the shared module.
8. Verify standalone still works before committing the standalone switch.

## Site Changes

In `D:\faceless-dancer-site`:

- Remove the custom site-only Instrument Lab implementation from `DanceStationPage.tsx`.
- Mount the shared Instrument Lab module in the Instrument Lab tab.
- Keep session side panel available for shared module host controls where appropriate.
- Use the site adapter for private assets and save/export.

## Standalone Changes

In `D:\autotransition`:

- No functional change during extraction.
- Later, add the shared module as a submodule.
- Wire the standalone adapter to existing endpoints.
- Verify existing working behavior before committing.

## Verification

Shared module:

- open demo page and verify piano roll, cursor, scrolling, zoom, tracks, import, playback, recording, and render hooks.

Site:

- `npm run build`
- verify Instrument Lab tab uses shared UI and has the same editor behavior as standalone.

Standalone:

- before switch: run existing checks to capture baseline.
- after switch: run existing checks and manually verify Instrument Lab:
  - track list
  - add/import audio track
  - cursor placement
  - scroll/zoom/fit
  - long recording extension
  - note move/resize/select/copy/paste/delete
  - playback/record timing
  - render preview
  - save track and save clip

## Risks

- The current standalone Instrument Lab logic is embedded in a large `app.js`, so extraction must be incremental and careful.
- Some functionality depends on standalone-only APIs. Those must become adapter calls rather than being dropped or reimplemented differently.
- The site may need feature gating for SFZ/sample import until equivalent browser storage support is wired.

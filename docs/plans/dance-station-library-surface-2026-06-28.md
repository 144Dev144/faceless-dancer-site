# Dance Station Library Surface Plan

## Goal

Make the site Dance Station Library tab behave like an actual shared asset library instead of a browser-storage placeholder.

## Current Issues

- The Settings button toggles a settings section inline below the main panels, but the UI does not make that obvious enough and may appear to do nothing.
- The "Save Browser Draft" control was only a storage proof-of-life. It is not useful as a creator workflow.
- The Library tab should show private assets and public library items, not "browser-local drafts."
- Users need to upload audio/image assets into their private space, browse public items, and later publish private assets.
- The wording should use "Private Assets" for local/account workspace items.
- This is not yet the fully shared Dance Station UI from the local app. It is the first site shell that should evolve toward the shared adapter-based app.

## Approach

1. Replace the draft-saving UI with a Private Assets panel:
   - upload/select audio or image files
   - save them into browser workspace as private assets
   - list private assets with type, label, date, and local/private status
   - leave publish buttons gated until publish wiring for browser assets is complete

2. Add a Public Library panel inside Dance Station:
   - reuse the same public library API used by `/library`
   - show cards with title, type, creator display name, cover image fallback, tags, and audio preview where available
   - add an import action placeholder or browser-workspace import when a public file URL is available

3. Fix Settings visibility:
   - make Settings open as a clear right-side or full-width settings drawer/section with an active button state
   - rename storage language to "Private Assets" and "Browser Workspace Settings"

4. Begin sharing style and UI patterns:
   - reuse existing site library card styling where possible
   - keep the Dance Station shell layout compatible with the future shared app package
   - do not duplicate the full local app styling yet; define shared components/adapters next so local and site can converge cleanly

## Affected Files

- `client/src/pages/DanceStationPage.tsx`
- `client/src/styles.css`
- possibly `client/src/lib/danceStationWorkspace.ts`
- possibly `client/src/lib/api.ts`

## Tradeoffs

- Browser uploads can be saved as metadata and blobs in IndexedDB/OPFS now, but account sync and Bunny upload should still be explicit later actions.
- Public library browsing can reuse `/library` data immediately, but full import-to-private behavior may need a small workspace asset schema update.
- The current local Dance Station UI is not automatically shared yet. This step makes the site UI direction correct while the shared adapter package is built incrementally.

## Success Criteria

- Settings visibly opens and closes.
- No "draft" terminology remains in the Dance Station Library tab.
- Users can add private audio/image assets to their browser workspace.
- Users can browse public library items from inside Dance Station.
- The UI describes private assets, public assets, and publish/import direction clearly.

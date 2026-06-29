# Site Dance Station Browser Workspace

## Goal

Start the site-hosted Dance Station experience with a browser-local workspace that preserves work across normal browser sessions and makes the storage caveats clear to users.

## Approach

- Add a browser workspace storage helper backed by IndexedDB.
- Detect storage capabilities:
  - IndexedDB availability
  - Origin Private File System availability
  - persistent-storage grant status
- Request persistent storage with `navigator.storage.persist()` from the Browser Workspace settings UI.
- Add first-use storage guidance explaining:
  - browser-local work is per browser/device/site origin
  - clearing site data removes it
  - private/incognito sessions are not durable
  - browser storage may still be evicted under pressure unless persistent storage is granted
  - account sync/public publishing are the durable cross-device paths
- Keep the first-use popup informational only. Do not ask for persistence from the popup.
- Add a Help/Storage panel so users can revisit the caveats later.
- Add a small browser-local library shell that can create a draft item and list stored workspace items.
- Replace the placeholder landing page with a tool-first Dance Station app shell.

## Affected Files

- `client/src/lib/danceStationWorkspace.ts`
- `client/src/pages/DanceStationPage.tsx`
- `client/src/styles.css`

## Tradeoffs

- IndexedDB is the MVP persistence layer because it is broadly supported and needs no dependency.
- OPFS support is detected and shown but file-heavy workflows will be layered in later.
- This does not upload automatically. Sync/publish remains explicit.

## Risks

- Browser storage behavior varies, so the UI must keep the caveats visible.
- Local browser storage is not a replacement for account sync for important work.

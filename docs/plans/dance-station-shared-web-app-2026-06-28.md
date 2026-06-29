# Dance Station Shared Web App Plan

## Goal

Avoid building Dance Station features twice for the local app and the site. New web UI features should be built once and run in both places when practical.

## Problem

The current local Dance Station UI is a static JavaScript app served by FastAPI. The site is a Preact app with its own routing, auth, library, and browser storage. If both UIs evolve independently, every feature will need two implementations.

## Direction

Create a shared Dance Station web app layer with adapter boundaries:

- Local adapter: talks to local FastAPI endpoints, local filesystem-backed library, ACE-Step runtime, Side-Step, AudioMass, local generated files, and the site/library bridge for Bunny-backed public/account assets.
- Site adapter: talks to browser workspace storage, public/account library APIs, Bunny-backed assets, AudioMass/browser editing, and future remote compute APIs.

The UI should be one product surface. Runtime capabilities should be enabled/disabled by the adapter instead of by maintaining separate UIs.

## Recommended Architecture

### 1. Shared Web App Package

Add a reusable frontend package, likely in the site repo first:

```text
shared-dance-station/
  src/
    app/
    components/
    tools/
    adapters/
    schemas/
    styles/
```

The site imports this package into `/dance-station`.

The local Python app can later serve the built version of this same package instead of the older static UI.

### 2. Adapter Interface

Define a stable interface for the app:

```ts
interface DanceStationAdapter {
  environment: "site" | "local";
  capabilities: DanceStationCapabilities;
  workspace: WorkspaceApi;
  library: LibraryApi;
  audio: AudioAssetApi;
  generation?: GenerationApi;
  extraction?: ExtractionApi;
  lokr?: LokrApi;
  editor?: AudioEditorApi;
}
```

The UI uses this interface only. It should not directly know whether it is running on the site or local app.

### 3. Capability Gating

Capabilities decide what the UI shows:

- `browserWorkspace`
- `publicLibraryImport`
- `publicLibraryPublish`
- `accountLibrarySync`
- `bunnyAssetDownload`
- `bunnyAssetUploadViaSite`
- `accountSync`
- `localFileAccess`
- `aceStepGeneration`
- `sideStepTraining`
- `audioMassEditor`
- `instrumentLab`
- `remoteCompute`

The site version starts with browser workspace, public library import, account sync/publish, AudioMass/browser-safe editing, and browser-safe import/export features.

The local version has the full local runtime capabilities plus the site integration capabilities. Local Dance Station should still be able to connect to the site, publish to Bunny through the site API, import Bunny-backed public library assets, sync account/private library items, and use public assets in local workflows.

### 4. Shared Schemas

Keep shared contracts in one place:

- library item
- library file
- workspace item
- audio asset
- generation job
- extraction job
- LoKr dataset/run
- import/export package

The site repo shared package should stay the source of truth for public API shapes. Dance Station can mirror generated or copied contracts until a package sharing strategy is finalized.

### 5. Local App Migration Strategy

Do not rewrite the local app all at once.

Phase migration:

1. Build the site Dance Station shell using the new adapter pattern.
2. Move reusable UI components/tools into the shared web package.
3. Add a local adapter that calls existing FastAPI endpoints.
4. Serve the shared web app build from FastAPI.
5. Retire old static local UI sections one tool at a time.

This lets the current local app keep working while new features move into the shared architecture.

## Immediate Site UI Plan

For the current site page:

- Remove the placeholder hero buttons.
- Make the first screen an actual app shell.
- Put tools first:
- Library
- Browser Workspace
- Audio Edit / AudioMass
  - Instrument Lab
  - Generation
  - Extraction
  - Training
- Disable or mark unavailable tools that need remote compute.
- Move browser persistence controls into Settings.
- Keep the first-use popup informational only:
  - no persistent-storage button
  - include caveat that extra browser storage protection can be requested in Browser Workspace settings.
- Add a Help/Storage menu so users can revisit storage behavior.

## Tradeoffs

- A shared adapter layer is more work up front than directly editing the site page.
- It prevents long-term drift between the site UI and local Dance Station UI.
- Not every local capability can run on the site immediately; capability gating keeps those differences explicit.

## Risks

- The current local UI is vanilla JavaScript while the site uses Preact, so migration needs to be incremental.
- Local-only Python/ACE/Side-Step behavior must stay behind adapter methods.
- Browser storage and remote compute will never behave exactly like local filesystem/runtime behavior, so the UI must label storage and execution context clearly.
- AudioMass can run in both contexts, but the file handoff differs: local uses FastAPI/local files, while site uses browser blobs/workspace storage and explicit sync/export actions.

## Success Criteria

- A new Dance Station tool added to the shared web app can run on the site and local app by implementing adapter methods, not by rebuilding the UI twice.
- Site users get a real Dance Station app surface immediately.
- Local users keep the full local runtime experience during migration.

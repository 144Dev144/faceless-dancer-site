# Dance Station Audio Edit and Instrument Lab Plan

## Goal

Bring the Audio Edit and Instrument Lab tabs online in the site-hosted Dance Station experience without requiring ACE-Step, Side-Step, or local filesystem access.

## Current State

- The site Dance Station page has a real Library tab with Private Assets and Public Library browsing.
- Audio Edit and Instrument Lab are currently disabled placeholder panels.
- The local Dance Station app already has:
  - vendored AudioMass served at `/audiomass/`
  - an Audio Edit tab with asset selection, iframe loading, and edit saving
  - a large Instrument Lab with tracks, piano roll editing, keyboard input, sample/synth instruments, render, and clip saving
- The site does not yet serve AudioMass assets or have browser-native instrument rendering code.

## Approach

### 1. Audio Edit Site MVP

Enable the Audio Edit tab with:

- Private asset picker filtered to audio-capable assets.
- File upload fallback for direct audio editing.
- Embedded editor frame area.
- Save Edited Result panel that saves an uploaded/exported audio file back into Private Assets as an `edit` item.

Implementation choice:

- First pass uses a browser-safe AudioMass launch/iframe if the site can serve a copied or shared AudioMass bundle.
- If vendoring AudioMass into the site is too large for this step, the UI still exposes the correct workflow with a clear editor-unavailable state and save/import path.

Near-term asset handoff:

- Private audio asset blobs can be converted to object URLs and loaded into the editor frame query string if AudioMass supports the same `ds_audio` and `ds_name` parameters used locally.
- Public imported assets with CDN URLs can use those URLs directly.

### 2. Instrument Lab Site MVP

Enable Instrument Lab with a focused browser-native first version:

- Clip label, BPM, bars, octave, and instrument selection.
- Built-in synth instrument bank based on the local app defaults.
- Computer-key note input using the same key map: `A W S E D F T G Y H U J K`.
- Clickable piano keyboard.
- Simple note list/sequence capture.
- Play/Stop using Web Audio.
- Render to WAV using `OfflineAudioContext`.
- Save rendered clip into Private Assets as an `instrument` item.

This first site version should not attempt to port the full local piano-roll editor in one commit. The full editor can follow once the shared package/adapters are in place.

### 3. Shared Direction

Keep code shaped for the future shared app:

- Extract small reusable helpers where useful:
  - audio asset URL creation from private/public workspace items
  - WAV encoding
  - instrument definitions
  - note/key mapping
- Do not tie site Instrument Lab to local FastAPI endpoints.
- Save site-created edits/instrument clips into the same Private Assets workspace used by Library.

## Affected Files

- `client/src/pages/DanceStationPage.tsx`
- `client/src/lib/danceStationWorkspace.ts`
- `client/src/styles.css`
- possibly `client/public/audiomass/` or another static asset location if AudioMass is copied into the site
- possibly new focused helpers under `client/src/lib/`

## Tradeoffs

- AudioMass is already a standalone app and not Preact-native. Embedding it keeps its full UI intact, but file handoff is less elegant than a native editor component.
- A full Instrument Lab port is large. The MVP gives users useful browser-native creation now while avoiding a brittle copy of the local static app.
- Private asset blobs in IndexedDB are practical for site-local work, but large files still depend on browser quota. Account sync/Bunny upload remains the durable path.

## Risks

- AudioMass may need small site-specific integration if its local `ds_audio` parameter assumes same-origin FastAPI paths.
- Browser autoplay/audio context rules require user interaction before playback.
- Offline rendering can be memory-heavy for long clips; cap the MVP duration conservatively.

## Success Criteria

- Audio Edit tab is available and no longer a placeholder.
- Users can select/upload an audio asset and save an edited/exported result into Private Assets.
- Instrument Lab tab is available and no longer a placeholder.
- Users can play notes with keyboard/clickable piano, render a short WAV, and save it into Private Assets.
- Build passes.

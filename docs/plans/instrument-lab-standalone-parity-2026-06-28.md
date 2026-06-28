# Instrument Lab Standalone Parity

## Goal

Bring the site Dance Station Instrument Lab in line with the standalone Dance Station Instrument Lab instead of treating it as a simplified sketchpad.

## Current Problems

- Render Preview and Save Clip are inside the Instrument Lab canvas area instead of the persistent Dance Station session side panel.
- The site Instrument Lab has no track list.
- Users cannot add additional instrument tracks.
- Users cannot import an existing creation/private asset as an audio track.
- The note display still looks like web page badges instead of the standalone piano-roll/editor notes.
- The editor lacks the standalone-style split between clip/tracks, performance editor, and side-panel render/session controls.

## Implementation Plan

1. Restructure Instrument Lab state in `client/src/pages/DanceStationPage.tsx`
   - Replace the single `instrumentNotes` source of truth with `instrumentTracks`.
   - Track fields:
     - `id`
     - `label`
     - `kind: "instrument" | "audio"`
     - `instrumentId`
     - `notes`
     - `muted`
     - `playDuringRecord`
     - `volume`
     - `audioUrl` / `sourceTitle` for imported creations.
   - Keep an active track id.
   - Preserve existing recording/playback helpers but route notes to the active instrument track.

2. Match the standalone layout
   - Left panel:
     - Clip settings
   - Center panel:
     - Performance Editor
     - Active track readout
     - Play / Stop / Record / Clear
     - Piano roll area
     - Piano keys
   - Session side panel:
     - Instrument status
     - Track list
     - Add Track
     - Import creation as audio track
     - Creation/library interaction controls
     - Render Preview
     - Save Track
     - Save Clip / composite
     - preview audio
   - Use the session side panel as the holder for creation interactions and track operations so the main editor does not get squeezed.

3. Make imported creations usable as tracks
   - Reuse the existing workspace item audio URL helpers.
   - Let users choose audio assets from Private Assets.
   - Add selected assets as `audio` tracks with label, mute, volume, and play-during-record toggle.
   - For this pass, audio tracks will be visible/listed and available for playback/render planning. If full browser-side audio mixing needs a deeper decode/mix pass, isolate that as the next follow-up rather than blocking the UI parity.

4. Fix note rendering to match standalone direction
   - Use rectangular note blocks with subtle teal fill and border.
   - No gradient badges.
   - Pitch rows and beat grid visible.
   - Cursor/playhead remains visible during playback/recording.
   - Notes render for the active instrument track, not a global single list.

5. Move render/save controls out of the Instrument Lab body
   - Add `InstrumentLabSessionControls` to the existing session side panel.
   - Only show it while the Instrument Lab tab is active.
   - Keep Audio Edit workspace controls in the same side panel when Audio Edit is active.

## Files Affected

- `client/src/pages/DanceStationPage.tsx`
- `client/src/styles.css`

## Risks / Tradeoffs

- This is still browser-side Instrument Lab, not the full standalone Python backend. The UI and browser rendering can match the standalone workflow, but server-only features like uploaded SFZ parsing are not part of this pass.
- Imported audio track mixing may need a follow-up if the first pass only wires selection/listing/playback state. The state shape will be built so mixing can be added cleanly.
- Keeping all of this in one page file is getting large. If this grows further, the next cleanup should split Instrument Lab into its own client component module.

## Verification

- Run `npm run build`.
- Manually confirm:
  - Instrument Lab shows track list and add/import track controls.
  - Render/save controls are in the side panel.
  - Notes render in standalone-style blocks.
  - Cursor appears in the piano-roll area.
  - Recording writes notes to the active instrument track.

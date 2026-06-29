# Dance Station Audio Tools Completion Plan

## Goal

Make the site Dance Station Audio Edit and Instrument Lab tabs behave like real production tools, not placeholders.

## Problems To Fix

### Audio Edit

- Native AudioMass File > Open / Save actions are not working reliably in the embedded site iframe.
- The site removed redundant outer controls, but there is still no Dance Station-native import/export path inside AudioMass.
- Users need to move creations/edits/private assets into and out of AudioMass without managing separate browser controls around it.

### Instrument Lab

- Current site Instrument Lab is a minimal sketchpad.
- It does not support recording.
- It does not have tracks, imported/backing assets, or save track vs save composite behavior.
- The layout looks like generic site cards instead of a focused music tool.

## AudioMass Direction

The shared `dance-station-audiomass` repo should own the Dance Station-specific AudioMass adapter behavior.

Add adapter-driven File menu entries inside AudioMass:

- `Open from Dance Station`
- `Save to Dance Station`
- `Export to Dance Station`

These should use `postMessage` between the iframe and parent app.

### Parent -> AudioMass

The site parent should provide:

- list of available Private Assets
- selected audio asset URL/blob URL
- label and metadata for import

Messages:

```text
dance-station:asset-list
dance-station:load-audio
```

### AudioMass -> Parent

AudioMass should emit:

```text
dance-station:audiomass-ready
dance-station:request-assets
dance-station:request-save
dance-station:exported-audio
dance-station:error
```

The parent app should save exported audio into Private Assets as `edit`.

### Native File Open/Save

Also debug native File > Open / Save inside the iframe:

- verify the AudioMass menu click triggers `RequestLoadLocalFile`
- verify the dynamically created file input is appended in the iframe document
- verify browser policy is not blocking `input.click()` inside the iframe
- verify download anchor click is not blocked
- if needed, add explicit `allow="downloads"` and a user-gesture-safe fallback button inside AudioMass.

## Site Audio Edit UI

Keep the site Audio Edit tab clean:

- no duplicate source picker above the editor
- no duplicate save controls below the editor
- iframe fills the tool panel
- all creation import/export actions happen from AudioMass menus or its Dance Station adapter UI

## Instrument Lab Direction

Upgrade Instrument Lab from sketchpad to a proper tool layout:

### Layout

Use a workbench layout:

- left rail: clip settings, instrument, tracks
- center: transport + piano roll/timeline editor
- right rail: render/save, clips/assets

Avoid marketing-card styling. Use dense, quiet tool panels.

### Core Features

- Transport:
  - Play
  - Stop
  - Record
  - count-in before recording
  - status/progress

- Tracks:
  - add instrument track
  - import Private Asset / Public imported audio as audio track
  - mute
  - play during record toggle
  - volume
  - active track selection

- Recording:
  - computer keyboard records notes against transport time
  - on-screen piano records notes when recording is active
  - note start/duration stored in beats

- Editing:
  - visible timeline/piano roll
  - click to add notes
  - select notes
  - delete selected notes
  - basic quantize
  - scroll/zoom can follow in the next pass if too large for this one

- Saving:
  - save active instrument track as `instrumenttrack`
  - save composite as `instrument`
  - save project metadata so clips can be reopened later

## Affected Repos

### `D:\dance-station-audiomass`

- Add adapter menu/event behavior.
- Fix or instrument native open/save behavior.

### `D:\faceless-dancer-site`

- Add parent-side AudioMass message bridge.
- Save AudioMass exports into Private Assets.
- Replace Instrument Lab MVP with workbench layout and recording/tracks.
- Keep the shared submodule pointer updated after AudioMass changes.

### `D:\autotransition`

- Update submodule pointer after AudioMass adapter changes.
- No local app UI behavior should regress.

## Verification

- Site `npm run build`
- Dance Station AudioMass serving test after submodule bump:

```powershell
conda run -n autotransition python -m pytest tests/test_ui_api.py -k audiomass
```

Manual verification:

- AudioMass iframe loads actual AudioMass.
- File > Open from disk works.
- File > Export/Download works.
- Open from Dance Station lists private/imported audio assets.
- Save to Dance Station creates a Private Asset edit.
- Instrument Lab can record notes, play them back, render, and save.

## Risks

- Browser download and file-picker behavior from iframes can vary. If iframe-native open/save remains unreliable, Dance Station adapter menu actions become the primary supported workflow.
- Instrument Lab recording and editing can get large quickly; implement the reliable core first, then improve zoom/scroll/advanced editing.

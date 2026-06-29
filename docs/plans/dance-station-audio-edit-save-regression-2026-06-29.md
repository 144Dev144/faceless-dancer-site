## Goal

Fix the site Dance Station Audio Edit asset-save regression introduced by the stricter label requirement.

## Scope

- Restore automatic asset-name seeding when audio is loaded into Audio Edit.
- Improve save failure feedback so required-name or export failures do not look like a silent no-op.

## Files

- `client/src/pages/DanceStationPage.tsx`

## Approach

1. Seed `audioEditLabel` from the loaded asset title when opening a private asset into Audio Edit.
2. Listen for AudioMass loaded/export error messages and mirror them into the save-status pill.
3. Keep the explicit required-name guard, but make it obvious when that is what blocked the save.

## Risks

- Native file-open actions inside AudioMass itself may still need separate name propagation if they bypass the host-side asset loader.

## Verification

- Run the site build.
- Confirm opening a private asset pre-fills the asset name and saving creates a new private asset entry.

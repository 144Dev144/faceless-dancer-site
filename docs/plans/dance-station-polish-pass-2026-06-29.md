## Goal

Polish a few remaining Dance Station site UI details around card readability, Instrument Lab naming, and redundant labels.

## Scope

- Add the same readability fade overlay to private asset card backgrounds that public cards already use.
- Require a user-provided label for Instrument Lab clip saves.
- Remove the `Available` status label from available Dance Station tool tabs.
- Remove `Creator workspace` from the Dance Station header.

## Files

- `client/src/pages/DanceStationPage.tsx`
- `client/src/styles.css`

## Approach

1. Make available tool cards omit the top status line entirely while keeping `COMING SOON` for unavailable tools.
2. Update the header title to just use the product naming without the extra subtitle text.
3. Add a save-name guard for Instrument Lab clip saves so saved assets use an explicit label.
4. Apply a dark gradient overlay to private asset cards when they use custom/public cover imagery.

## Risks

- Instrument Lab users now need to provide a label before saving clips, so the UI should fail with a clear message instead of silently falling back.

## Verification

- Run the site build.
- Confirm private cards stay readable over images and Instrument Lab refuses unnamed clip saves.

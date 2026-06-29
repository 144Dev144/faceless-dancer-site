## Goal

Simplify the site Dance Station settings flow so it behaves like a true mode instead of an extra overlay panel.

## Scope

- When settings is open, replace the normal tab content with settings content in the main panel.
- Remove the compact session bullets from the right panel outside settings mode.
- Reformat the settings-side status display from boxed chips into a cleaner label/value list.
- Remove the publish-token creation/revocation UI from the site Dance Station surface.

## Files

- `client/src/pages/DanceStationPage.tsx`
- `client/src/styles.css`

## Approach

1. Gate the main panel content on `showSettings` before tab content selection.
2. Replace the right-side session summary with simple text in normal mode.
3. Add a settings summary component for the right panel using indented label/value rows.
4. Remove the site-only publish-token UI and related local state/effects that are no longer surfaced.

## Risks

- Removing the publish-token UI means local-app token management stays outside the site surface for now.
- The settings mode needs to stay obviously dismissible so users can get back to tools quickly.

## Verification

- Run the site build.
- Check that opening settings hides tool content, shows settings, and closing returns to the previous tool tab.

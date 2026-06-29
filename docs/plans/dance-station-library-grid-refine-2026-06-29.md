## Goal

Refine the Dance Station library surfaces on the site so private and public assets read like a compact media library instead of a stacked form list.

## Scope

- Convert the private asset list inside Dance Station into square cards in a grid.
- Tighten button and pill sizing within both library sections.
- Remove filled button treatment from library actions in favor of bordered controls.
- Make public library images part of the full card background instead of a separate media block.
- Constrain both library grids to scrollable regions with endless-style scrolling inside the panel.

## Files

- `client/src/pages/DanceStationPage.tsx`
- `client/src/styles.css`

## Approach

1. Update the private asset card markup so each item can render as a square tile with compact metadata and action controls.
2. Update the public library card markup to use a background-image treatment on the card root while preserving creator, type, tags, and audio preview.
3. Add Dance Station-specific card/grid styling:
   - square aspect ratio
   - compact pills/buttons
   - bordered action buttons
   - max-height + internal overflow for both library sections
4. Keep the top-level `/library` page styling intact unless a shared class change would unintentionally affect it.

## Risks

- The shared `library-card` class is also used outside Dance Station, so the refinements need to stay scoped to Dance Station-specific selectors where possible.
- Square cards reduce vertical space for metadata, so content needs line clamps and tighter spacing to avoid overflow.

## Verification

- Run the site build.
- Check the Dance Station library sections visually in the browser after the CSS/markup changes.

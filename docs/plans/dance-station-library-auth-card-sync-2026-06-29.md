## Goal

Bring the site library and Dance Station library surfaces back into alignment while tightening auth-gated actions and the placeholder copy for unavailable remote-compute tools.

## Scope

- Reuse one library card component between the public `/library` page and the Dance Station public library surface.
- Restore full-card background images for public library cards.
- Let private assets in Dance Station choose a local custom card image from disk.
- Disable import/publish actions when the user is not signed in, with explicit button copy.
- Change remote-compute tool badges to `COMING SOON`.
- Simplify the unavailable tool panel copy to `Remote compute coming soon`.

## Files

- `client/src/components/library/LibraryAssetCard.tsx` (new)
- `client/src/pages/LibraryPage.tsx`
- `client/src/pages/DanceStationPage.tsx`
- `client/src/styles.css`

## Approach

1. Extract the public-library card markup into a shared component with an optional action slot.
2. Use that shared card in both the public library page and the Dance Station public library section.
3. Store private asset card-image files directly inside the existing IndexedDB workspace item metadata and render them as per-item card backgrounds.
4. Gate import/publish buttons on authenticated session state and make the disabled label explicit.
5. Update the remote-compute status text and panel copy without changing the inactive-shell structure.

## Risks

- The private card-image field stores another local `File` blob in IndexedDB metadata, which increases workspace storage usage for users who add custom covers.
- Shared card styling must stay flexible enough to work in both the page grid and the constrained Dance Station panel grid.

## Verification

- Run the site build.
- Confirm public cards show full-card backgrounds in both `/library` and `/dance-station`.
- Confirm signed-out import/publish buttons are disabled with the expected labels.

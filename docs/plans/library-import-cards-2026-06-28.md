# Library Import Cards

## Goal

Make public library items display as creator-aware cards and allow Dance Station to import public creations back into the local stack.

## Approach

- Include lightweight creator profile data in public library item API responses.
- Use a `cover` file role as card art when present; otherwise allow later fallback to a creator/site default image.
- Keep library files as CDN references in public API responses.
- Update the site library cards to show type, title, creator, cover art, counts, and playable audio.
- Update Dance Station to browse public site library items and import their CDN files into local storage.
- Mark imported items clearly in Dance Station with an `Imported` badge and creator label.

## Affected Files

- `server/src/modules/library/routes.ts`
- `shared/src/types/library.ts`
- `client/src/lib/api.ts`
- `client/src/pages/LibraryPage.tsx`
- `client/src/styles.css`
- Dance Station library publish/import modules and UI files.

## Risks

- Public imports may include large datasets; the first implementation downloads files sequentially and reports completion/failure.
- Some items may not include cover art yet, so cards need clean fallback styling.

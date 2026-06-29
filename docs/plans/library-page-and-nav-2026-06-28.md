# Library Page And Primary Nav

## Goal

Add the first site-facing public library surface and make the header navigation point to the main product areas:

- Home
- Dance Stage
- Library
- Dance Station

Dance Station on the site is only a placeholder in this pass. The compute-heavy Dance Station features stay disabled until a remote compute backend exists.

## Approach

- Add a `/library` client page that reads from the existing `/api/library` endpoint.
- Show public/published library items with kind, tags, description, metadata summary, and file counts.
- Add a `/dance-station` placeholder page explaining that the local app is the current full workstation and the browser version will come later.
- Update the top navigation to use page links rather than only section anchors.
- Keep the UI dark, premium, and consistent with the existing home page styling.

## Affected Files

- `client/src/App.tsx`
- `client/src/components/home/HomeTopNav.tsx`
- `client/src/lib/api.ts`
- `client/src/pages/LibraryPage.tsx`
- `client/src/pages/DanceStationPage.tsx`
- `client/src/styles.css`

## Tradeoffs

- The library page will be browse-only for now. Publishing, moderation, and uploads stay for later passes.
- The listing API currently returns item metadata without full file rows, so the page will gracefully show known item information and file counts when available.
- Dance Station is not embedded yet. The placeholder avoids implying ACE-Step/Side-Step compute works in the public site.

## Risks

- Empty public library state must look intentional until publishing is built.
- Header links should not break same-page section navigation from the home page.

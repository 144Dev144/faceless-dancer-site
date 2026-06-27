# Library Platform Branch Plan

## Goal

Add the first public-library foundation for Dance Station and the Faceless Dancer site without merging the two repos.

This branch establishes a shared TypeScript contract, a Postgres persistence draft, and thin API scaffolding that can later accept published Dance Station assets.

## Scope

First deliverables:

- Add shared library enums, record types, and Zod schemas in `shared/src`.
- Add Postgres tables for `library_items` and `library_files`.
- Add a small backend `library` module with public listing/detail routes and authenticated draft creation.
- Keep Bunny uploads out of this first pass unless needed by schema validation.
- Keep the frontend browse/publish UI for a later pass.

## Affected Files

- `shared/src/schemas/library.ts`
- `shared/src/types/library.ts`
- `shared/src/index.ts`
- `server/src/db/postgresMigrations/005_library_items.sql`
- `server/src/modules/library/routes.ts`
- `server/src/app.ts`

## Contract Direction

The site repo owns the canonical public schema because it already publishes the shared TypeScript package used by client/server code.

Dance Station will mirror the compatible Python model after this site contract exists.

## Tradeoffs

- The schema is intentionally broad enough for music, transitions, extractions, edits, instrument clips, datasets, LoKr adapters, rhythm-game assets, and tools.
- File upload handling is deferred so this first pass can validate the shape and DB boundaries before storage rules are locked in.
- Moderation is represented with status fields now; deeper audit workflows can come later.

## Risks

- The first schema may still need migration once real publish/import flows start.
- Dataset and adapter uploads will need stricter file-size and file-type rules before public submission.
- Dance Station local manifests must stay compatible with this contract without requiring the local app to become TypeScript-aware.

# Library Publishing And Binary Storage

## Goal

Allow Dance Station users to publish local library items to the Faceless Dancer public library. Media files should upload to Bunny CDN, while Postgres stores item metadata, file records, CDN object paths, public URLs, hashes, sizes, and ownership.

## Approach

### Site Repo

- Add creator publish tokens so local Dance Station can authenticate without needing browser cookies.
  - Store only token hashes in Postgres.
  - Allow authenticated users to create/revoke/list their publish tokens.
  - Accept `Authorization: Bearer <token>` on publishing endpoints.
- Add upload-backed library publishing endpoints.
  - Create or update a draft library item from metadata.
  - Upload one or more files with roles such as `audio`, `preview`, `dataset_manifest`, `dataset_sample`, `adapter_weights`, `metadata`, `project`, and `cover`.
  - Store each binary in Bunny under a predictable path such as `library/<ownerId>/<itemId>/<fileId>-<safeName>`.
  - Store file metadata in `library_files`, including MIME type, byte size, SHA-256, Bunny object path, public URL, file role, and optional JSON metadata.
  - Add item status endpoints for submit/publish flow.
- Keep public reads unchanged except that published items will now include usable CDN file URLs.
- Extend shared schemas for publish manifests and file roles where needed.

### Dance Station Repo

- Add configurable public library connection settings:
  - site base URL
  - creator publish token
- Add a publish action to Local Library items.
  - Use the local manifest metadata already indexed by Dance Station.
  - Upload referenced files from disk to the site API.
  - Show per-file upload progress/state where feasible.
  - Save returned remote item/file IDs back into the local manifest metadata.
- Support dataset publishing by uploading:
  - dataset manifest JSON
  - every sample audio file as `dataset_sample`
  - per-sample metadata in each file record
- Support adapter publishing by uploading:
  - adapter weights
  - training/run metadata
  - optional preview/reference audio if present

## Affected Files

### Site

- `server/src/db/postgresMigrations/*`
- `server/src/modules/auth/routes.ts`
- `server/src/modules/library/routes.ts`
- `server/src/modules/storage/bunnyStorage.ts`
- `shared/src/schemas/library.ts`
- `shared/src/types/library.ts`
- `client/src/lib/api.ts`
- site library/profile UI files if token management is added in this phase

### Dance Station

- `src/autotransition/library/schema.py`
- `src/autotransition/library/index.py`
- new publish client module under `src/autotransition/library/`
- `src/autotransition/ui/app.py`
- `src/autotransition/ui/static/app.js`
- `src/autotransition/ui/static/index.html`
- `src/autotransition/ui/static/styles.css`
- docs/readme updates after behavior is implemented

## Tradeoffs

- Use creator publish tokens for the local app instead of trying to reuse site cookies across origins.
- Upload files through the site API so Bunny paths, ownership, validation, and hashes are controlled server-side.
- Keep moderation flexible: first implementation can create drafts/submitted items; admin auto-publish can come later or be limited to admins.
- Do not put audio/images/videos/model weights in Postgres.

## Risks

- Large dataset uploads need clear progress and retry handling.
- Publish tokens must be revocable and stored carefully on the local machine.
- Bunny upload failures need resumable or repeatable behavior so partial publishes do not leave confusing library state.
- Cross-repo schema drift must be avoided by treating the site shared schema as the source of truth.

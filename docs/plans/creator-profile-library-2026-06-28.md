# Creator Profile Library Integration

## Goal

Add creator profile fields to authenticated users so public library items can be published with a stable creator identity. Profile media should be stored in Bunny CDN; Postgres should only keep text metadata and CDN object/path references.

## Approach

- Add optional user profile columns:
  - `display_name`
  - `creator_slug`
  - `bio`
  - `avatar_bunny_object_path`
  - `avatar_public_url`
  - `banner_bunny_object_path`
  - `banner_public_url`
  - `creator_profile_updated_at`
- Add shared schemas/types for profile updates and media kind validation.
- Extend auth session responses with `creatorProfile` so the site and Dance Station can show "publishing as" context.
- Add authenticated profile update endpoints:
  - text update for display name, slug, and bio
  - media upload for avatar/banner images using Bunny storage
- Update client API/session types to carry creator profile data.

## Affected Files

- `server/src/db/postgresMigrations/006_creator_profiles.sql`
- `server/src/modules/auth/routes.ts`
- `shared/src/schemas/auth.ts`
- `shared/src/types/auth.ts`
- `client/src/lib/api.ts`
- `client/src/hooks/useSession.ts`
- `client/src/components/WalletAuthCard.tsx`

## Tradeoffs

- Store profile media as Bunny object path plus public URL, not binary database blobs.
- Keep creator profile fields on `users` for now instead of a separate `creator_profiles` table because this is one profile per authenticated user.
- Use nullable unique `creator_slug` so users can publish before choosing a public handle.

## Risks

- Existing deployments need the new migration run before profile endpoints are used.
- Slug uniqueness is enforced in Postgres; duplicate slug attempts must return a clear API error.

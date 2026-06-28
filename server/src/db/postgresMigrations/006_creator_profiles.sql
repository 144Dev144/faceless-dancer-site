ALTER TABLE users
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS creator_slug TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS avatar_bunny_object_path TEXT,
  ADD COLUMN IF NOT EXISTS avatar_public_url TEXT,
  ADD COLUMN IF NOT EXISTS banner_bunny_object_path TEXT,
  ADD COLUMN IF NOT EXISTS banner_public_url TEXT,
  ADD COLUMN IF NOT EXISTS creator_profile_updated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_creator_slug
  ON users (creator_slug)
  WHERE creator_slug IS NOT NULL;

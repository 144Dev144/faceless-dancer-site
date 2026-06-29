CREATE TABLE IF NOT EXISTS creator_publish_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_creator_publish_tokens_user_id
  ON creator_publish_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_creator_publish_tokens_active
  ON creator_publish_tokens (user_id, revoked_at);

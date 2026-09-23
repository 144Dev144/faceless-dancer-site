CREATE TABLE IF NOT EXISTS remote_generation_assets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('video_generation', 'video_chain')),
  job_id TEXT NOT NULL,
  chain_id TEXT,
  parent_job_id TEXT,
  parent_chain_id TEXT,
  title TEXT NOT NULL,
  object_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  proxy_url TEXT,
  manifest_object_path TEXT,
  manifest_public_url TEXT,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  duration_seconds DOUBLE PRECISION,
  frame_rate DOUBLE PRECISION,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT remote_generation_assets_owner_job_kind_unique UNIQUE (owner_user_id, job_id, asset_kind),
  CONSTRAINT remote_generation_assets_chain_id_unique UNIQUE (owner_user_id, chain_id)
);

CREATE INDEX IF NOT EXISTS idx_remote_generation_assets_owner_updated
  ON remote_generation_assets (owner_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_remote_generation_assets_owner_job
  ON remote_generation_assets (owner_user_id, job_id);

CREATE INDEX IF NOT EXISTS idx_remote_generation_assets_owner_parent
  ON remote_generation_assets (owner_user_id, parent_job_id, parent_chain_id);

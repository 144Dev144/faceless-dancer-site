CREATE TABLE IF NOT EXISTS library_items (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id),
  visibility TEXT NOT NULL DEFAULT 'private',
  status TEXT NOT NULL DEFAULT 'draft',
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_lineage_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  license TEXT,
  attribution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_library_items_status ON library_items(status);
CREATE INDEX IF NOT EXISTS idx_library_items_visibility ON library_items(visibility);
CREATE INDEX IF NOT EXISTS idx_library_items_kind ON library_items(kind);
CREATE INDEX IF NOT EXISTS idx_library_items_owner_user_id ON library_items(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_library_items_tags_gin ON library_items USING GIN (tags_json);

CREATE TABLE IF NOT EXISTS library_files (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_provider TEXT NOT NULL DEFAULT 'bunny',
  path TEXT NOT NULL,
  public_url TEXT,
  sha256 TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_library_files_item_id ON library_files(item_id);
CREATE INDEX IF NOT EXISTS idx_library_files_role ON library_files(role);

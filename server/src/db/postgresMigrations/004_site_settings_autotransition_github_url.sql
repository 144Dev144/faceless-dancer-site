ALTER TABLE site_settings
ADD COLUMN IF NOT EXISTS autotransition_github_url TEXT;

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  destination TEXT NOT NULL CHECK (destination IN ('page','profile')),
  format TEXT NOT NULL CHECK (format IN ('text','photo','reel')),
  caption TEXT NOT NULL,
  media_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','published','manual_required','failed')),
  scheduled_at TEXT,
  published_at TEXT,
  platform_post_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_posts_status_schedule
ON posts(status, scheduled_at);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT,
  event TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

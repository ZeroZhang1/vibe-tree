CREATE TABLE IF NOT EXISTS hourly_usage (
  user_id TEXT NOT NULL,
  hour_start_utc TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  app_version TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, hour_start_utc),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hourly_usage_hour ON hourly_usage(hour_start_utc);
CREATE INDEX IF NOT EXISTS idx_hourly_usage_user ON hourly_usage(user_id);

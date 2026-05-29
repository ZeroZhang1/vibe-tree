CREATE TABLE IF NOT EXISTS tree_devices (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  alias TEXT,
  platform TEXT,
  first_seen_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  app_version TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tree_model_stats (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  date TEXT NOT NULL,
  source TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id, date, source, model),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tree_devices_user ON tree_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_tree_model_stats_user ON tree_model_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_tree_model_stats_device ON tree_model_stats(user_id, device_id);

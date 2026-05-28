CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  avatar_url TEXT,
  profile_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_usage (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  xp INTEGER NOT NULL,
  app_version TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tree_events (
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  device_id TEXT,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  app_version TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, event_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tree_achievements (
  user_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  app_version TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, achievement_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

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

CREATE TABLE IF NOT EXISTS usage_preferences (
  user_id TEXT NOT NULL,
  range TEXT NOT NULL,
  favorite_agent_label TEXT,
  favorite_agent_percent INTEGER,
  favorite_model TEXT,
  favorite_period TEXT,
  favorite_period_start INTEGER,
  favorite_period_end INTEGER,
  peak_tokens_per_minute INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, range),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_limits (
  user_id TEXT PRIMARY KEY,
  last_synced_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  method TEXT NOT NULL,
  status INTEGER,
  actor_id TEXT,
  ip_hash TEXT,
  country TEXT,
  user_agent TEXT,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON daily_usage(date);
CREATE INDEX IF NOT EXISTS idx_daily_usage_user ON daily_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_tree_events_user_created ON tree_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tree_events_device ON tree_events(user_id, device_id);
CREATE INDEX IF NOT EXISTS idx_tree_achievements_user ON tree_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_tree_devices_user ON tree_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_tree_model_stats_user ON tree_model_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_tree_model_stats_device ON tree_model_stats(user_id, device_id);
CREATE INDEX IF NOT EXISTS idx_usage_preferences_user ON usage_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(type);

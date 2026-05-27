PRAGMA foreign_keys = OFF;

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

DROP TABLE IF EXISTS tree_events_privacy_migration;
CREATE TABLE tree_events_privacy_migration (
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

INSERT OR REPLACE INTO tree_events_privacy_migration (
  user_id,
  event_id,
  device_id,
  created_at,
  source,
  tokens,
  input_tokens,
  output_tokens,
  cache_read_tokens,
  cache_write_tokens,
  app_version,
  updated_at
)
SELECT
  user_id,
  event_id,
  device_id,
  created_at,
  'cloud-sync',
  tokens,
  input_tokens,
  output_tokens,
  cache_read_tokens,
  cache_write_tokens,
  app_version,
  updated_at
FROM tree_events;

DROP TABLE tree_events;
ALTER TABLE tree_events_privacy_migration RENAME TO tree_events;

CREATE TABLE IF NOT EXISTS tree_achievements (
  user_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  app_version TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, achievement_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

DROP TABLE IF EXISTS tree_achievements_privacy_migration;
CREATE TABLE tree_achievements_privacy_migration (
  user_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  app_version TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, achievement_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

INSERT OR REPLACE INTO tree_achievements_privacy_migration (
  user_id,
  achievement_id,
  unlocked_at,
  app_version,
  updated_at
)
SELECT
  user_id,
  achievement_id,
  unlocked_at,
  app_version,
  updated_at
FROM tree_achievements;

DROP TABLE tree_achievements;
ALTER TABLE tree_achievements_privacy_migration RENAME TO tree_achievements;

CREATE INDEX IF NOT EXISTS idx_tree_events_user_created ON tree_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tree_events_device ON tree_events(user_id, device_id);
CREATE INDEX IF NOT EXISTS idx_tree_achievements_user ON tree_achievements(user_id);

PRAGMA foreign_keys = ON;

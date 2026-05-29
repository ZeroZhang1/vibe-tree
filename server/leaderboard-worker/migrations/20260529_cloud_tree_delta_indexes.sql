CREATE TABLE IF NOT EXISTS tree_device_stats (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  entry_count INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  last_event_updated_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, device_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

INSERT INTO tree_device_stats (user_id, device_id, entry_count, tokens, last_event_updated_at, updated_at)
SELECT
  user_id,
  device_id,
  COUNT(*) AS entry_count,
  COALESCE(SUM(tokens), 0) AS tokens,
  MAX(updated_at) AS last_event_updated_at,
  MAX(updated_at) AS updated_at
FROM tree_events
WHERE device_id IS NOT NULL
GROUP BY user_id, device_id
ON CONFLICT(user_id, device_id) DO UPDATE SET
  entry_count = excluded.entry_count,
  tokens = excluded.tokens,
  last_event_updated_at = excluded.last_event_updated_at,
  updated_at = excluded.updated_at;

CREATE INDEX IF NOT EXISTS idx_tree_events_user_updated ON tree_events(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tree_achievements_user_updated ON tree_achievements(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tree_devices_user_updated ON tree_devices(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tree_device_stats_user ON tree_device_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_tree_device_stats_user_updated ON tree_device_stats(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tree_model_stats_user_updated ON tree_model_stats(user_id, updated_at);

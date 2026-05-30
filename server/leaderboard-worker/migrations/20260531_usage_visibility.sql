CREATE TABLE IF NOT EXISTS usage_visibility (
  user_id TEXT PRIMARY KEY,
  public_global INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

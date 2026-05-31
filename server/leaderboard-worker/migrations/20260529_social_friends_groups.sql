CREATE TABLE IF NOT EXISTS social_friendships (
  user_low TEXT NOT NULL,
  user_high TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_low, user_high),
  FOREIGN KEY (user_low) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (user_high) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (requester_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS social_groups (
  group_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon_emoji TEXT,
  visibility TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS social_group_members (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  share_usage INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES social_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS social_group_invites (
  invite_code_hash TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (group_id) REFERENCES social_groups(group_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_social_friendships_requester ON social_friendships(requester_user_id);
CREATE INDEX IF NOT EXISTS idx_social_friendships_status ON social_friendships(status);
CREATE INDEX IF NOT EXISTS idx_social_friendships_user_high ON social_friendships(user_high);
CREATE INDEX IF NOT EXISTS idx_social_groups_owner ON social_groups(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_social_group_members_user ON social_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_social_group_members_group_role ON social_group_members(group_id, role);
CREATE INDEX IF NOT EXISTS idx_social_group_invites_group ON social_group_invites(group_id);
CREATE INDEX IF NOT EXISTS idx_social_group_invites_creator ON social_group_invites(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_social_group_invites_expires ON social_group_invites(expires_at);

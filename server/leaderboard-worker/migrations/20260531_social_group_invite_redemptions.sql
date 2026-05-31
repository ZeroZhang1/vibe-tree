CREATE TABLE IF NOT EXISTS social_group_invite_redemptions (
  invite_code_hash TEXT NOT NULL,
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (invite_code_hash, user_id),
  FOREIGN KEY (invite_code_hash) REFERENCES social_group_invites(invite_code_hash) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES social_groups(group_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_social_group_invite_redemptions_user
  ON social_group_invite_redemptions(user_id);

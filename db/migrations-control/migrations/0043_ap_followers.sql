-- ActivityPub followers for Store and Repository actors

CREATE TABLE ap_followers (
  id TEXT PRIMARY KEY,
  target_actor_url TEXT NOT NULL,
  follower_actor_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ap_followers_target ON ap_followers (target_actor_url);
CREATE UNIQUE INDEX idx_ap_followers_unique ON ap_followers (target_actor_url, follower_actor_url);

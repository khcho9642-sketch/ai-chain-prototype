-- Apply once to the MEMBER_DB D1 binding before enabling Google login.
-- Google membership stays separate from the paused legacy community database.
CREATE TABLE IF NOT EXISTS member_users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
  created INTEGER NOT NULL,
  last_login INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS member_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES member_users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS member_sessions_expiry ON member_sessions(expires);
CREATE INDEX IF NOT EXISTS member_sessions_user ON member_sessions(user_id);
CREATE TABLE IF NOT EXISTS member_challenges (
  token_hash TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS member_challenges_expiry ON member_challenges(expires);
CREATE TABLE IF NOT EXISTS member_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS member_rate_limits_expiry ON member_rate_limits(expires);

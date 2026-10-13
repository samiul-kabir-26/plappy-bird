CREATE TABLE players (
  id               INTEGER PRIMARY KEY,
  external_user_id TEXT UNIQUE NOT NULL,
  display_name     TEXT NOT NULL,
  is_guest         INTEGER NOT NULL DEFAULT 0,
  best_score       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL
);

CREATE TABLE runs (
  id             TEXT PRIMARY KEY,
  player_id      INTEGER NOT NULL REFERENCES players(id),
  seed           INTEGER NOT NULL,
  config_version INTEGER NOT NULL,
  score          INTEGER NOT NULL DEFAULT 0,
  flaps          INTEGER,
  status         TEXT NOT NULL,            -- active | finished | rejected | removed
  reject_reason  TEXT,
  ticks          TEXT NOT NULL DEFAULT '[]', -- validated pipe-pass timestamps (game ms), staged until the run ends
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  duration_ms    INTEGER
);
CREATE INDEX idx_runs_board  ON runs(status, score DESC, ended_at);
CREATE INDEX idx_runs_player ON runs(player_id, started_at);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid       TEXT UNIQUE NOT NULL,
  type       TEXT NOT NULL,
  player_id  TEXT,
  run_id     TEXT,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_events_type   ON events(type, id);
CREATE INDEX idx_events_player ON events(player_id, id);

CREATE TABLE game_config (
  version    INTEGER PRIMARY KEY,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE assets (
  id         TEXT PRIMARY KEY,
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  kind       TEXT NOT NULL,                -- image | audio
  stored_as  TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  mode         TEXT NOT NULL,
  eyebrow      TEXT NOT NULL,
  title        TEXT NOT NULL,
  dateline     TEXT NOT NULL,
  place        TEXT NOT NULL,
  invitation   TEXT NOT NULL,
  brand_sub    TEXT NOT NULL,
  short_code   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id),
  source       TEXT NOT NULL,
  filename     TEXT NOT NULL,
  credit       TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photos_event ON photos(event_id, created_at);

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id),
  name         TEXT NOT NULL,
  text         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_event ON messages(event_id, created_at);

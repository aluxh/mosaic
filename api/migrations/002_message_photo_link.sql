ALTER TABLE messages ADD COLUMN photo_id TEXT REFERENCES photos(id);
CREATE INDEX IF NOT EXISTS idx_messages_photo ON messages(photo_id);

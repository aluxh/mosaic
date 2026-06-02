ALTER TABLE photos
ADD COLUMN focal_source TEXT NOT NULL DEFAULT 'unknown'
CHECK (focal_source IN ('unknown', 'detected', 'fallback', 'manual'));

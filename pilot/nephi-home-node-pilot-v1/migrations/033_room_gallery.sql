-- Room photos are object-storage metadata only. room_id is the formal room ID.
-- Validate the room in each scoped operation/read rather than cascading photo
-- deletion when legacy room writers replace then reinsert the same room rows.
CREATE TABLE IF NOT EXISTS room_gallery_photos (
  property_id text NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  room_id text NOT NULL CHECK (length(room_id) BETWEEN 1 AND 200),
  photo_id text NOT NULL UNIQUE CHECK (photo_id ~ '^[A-Za-z0-9_-]{32}$'),
  original_key text NOT NULL UNIQUE,
  preview_key text NOT NULL UNIQUE,
  position integer NOT NULL CHECK (position >= 0),
  ready boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, room_id, photo_id)
);
CREATE INDEX IF NOT EXISTS room_gallery_order ON room_gallery_photos(property_id,room_id,position,photo_id);

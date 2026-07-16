CREATE TABLE IF NOT EXISTS daily_room_notes (
  property_id text NOT NULL,
  room_id text NOT NULL,
  stay_date date NOT NULL,
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, room_id, stay_date),
  FOREIGN KEY (property_id, room_id)
    REFERENCES room_types(property_id, room_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS daily_room_notes_property_date_idx
  ON daily_room_notes(property_id, stay_date);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'daily_room_notes' AND column_name = 'room_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'daily_room_notes' AND column_name = 'inventory_id'
  ) THEN
    ALTER TABLE daily_room_notes DROP CONSTRAINT IF EXISTS daily_room_notes_property_id_room_id_fkey;
    ALTER TABLE daily_room_notes DROP CONSTRAINT IF EXISTS daily_room_notes_pkey;
    ALTER TABLE daily_room_notes RENAME COLUMN room_id TO inventory_id;
  END IF;
END $$;

ALTER TABLE daily_room_notes
  ADD COLUMN IF NOT EXISTS inventory_type text NOT NULL DEFAULT 'room';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'daily_room_notes'::regclass AND conname = 'daily_room_notes_inventory_type_check'
  ) THEN
    ALTER TABLE daily_room_notes
      ADD CONSTRAINT daily_room_notes_inventory_type_check
      CHECK (inventory_type IN ('room', 'bundle'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'daily_room_notes'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE daily_room_notes
      ADD CONSTRAINT daily_room_notes_pkey
      PRIMARY KEY (property_id, inventory_type, inventory_id, stay_date);
  END IF;
END $$;

-- Shared, property-scoped room presentation fields. Repeat-safe; legacy name is retained.
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS room_code text NOT NULL DEFAULT '';
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS highlights jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE room_types SET display_name = name
WHERE display_name IS NULL OR btrim(display_name) = '';

-- Rollback: application code may be reverted without dropping these columns.
-- Column removal is intentionally manual because it would destroy operator-entered data.

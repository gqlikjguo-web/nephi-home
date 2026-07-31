CREATE TABLE IF NOT EXISTS property_custom_replies (
  rule_id text PRIMARY KEY,
  property_id text NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  name text NOT NULL,
  topic text NOT NULL,
  scope text NOT NULL,
  room_type_id text,
  stay_start_date date,
  stay_end_date date,
  effective_start_date date NOT NULL,
  effective_end_date date NOT NULL,
  approved_reply text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (property_id, room_type_id) REFERENCES room_types(property_id, room_id) ON DELETE CASCADE,
  CHECK (topic IN ('booking_open','booking_paused','price_unannounced','room','bundle','parking_notice','facility_notice','checkin_checkout','lodging_rules','temporary_operation')),
  CHECK (scope IN ('all','room_only','bundle','room_type')),
  CHECK ((scope = 'room_type' AND room_type_id IS NOT NULL) OR (scope <> 'room_type' AND room_type_id IS NULL)),
  CHECK ((stay_start_date IS NULL AND stay_end_date IS NULL) OR (stay_start_date IS NOT NULL AND stay_end_date IS NOT NULL AND stay_start_date <= stay_end_date)),
  CHECK (effective_start_date <= effective_end_date),
  CHECK (length(trim(name)) > 0),
  CHECK (length(trim(approved_reply)) > 0)
);

CREATE INDEX IF NOT EXISTS property_custom_replies_property_idx
  ON property_custom_replies(property_id, created_at, rule_id);

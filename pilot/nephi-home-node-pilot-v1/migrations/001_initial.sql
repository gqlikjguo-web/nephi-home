CREATE TABLE IF NOT EXISTS properties (
  property_id text PRIMARY KEY, display_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS room_types (
  property_id text NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE, room_id text NOT NULL, name text NOT NULL,
  capacity integer NOT NULL, type text NOT NULL DEFAULT 'custom', description text NOT NULL DEFAULT '', position integer NOT NULL,
  PRIMARY KEY (property_id, room_id)
);
CREATE TABLE IF NOT EXISTS property_settings (
  property_id text PRIMARY KEY REFERENCES properties(property_id) ON DELETE CASCADE, settings jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS knowledge_items (
  property_id text NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE, knowledge_id text NOT NULL,
  question text NOT NULL, answer text NOT NULL, knowledge_key text, position integer NOT NULL, PRIMARY KEY (property_id, knowledge_id)
);
CREATE TABLE IF NOT EXISTS availability_days (
  property_id text NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE, stay_date date NOT NULL,
  room301 text NOT NULL, room302 text NOT NULL, room401 text NOT NULL, room402 text NOT NULL, whole_house text NOT NULL,
  PRIMARY KEY (property_id, stay_date)
);
CREATE TABLE IF NOT EXISTS availability_blocks (
  property_id text NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE, block_id text NOT NULL,
  room_id text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL, status text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (property_id, block_id)
);
CREATE TABLE IF NOT EXISTS conversation_states (
  property_id text NOT NULL, channel_id text NOT NULL, line_user_id text NOT NULL, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, channel_id, line_user_id)
);
CREATE TABLE IF NOT EXISTS message_logs (
  property_id text NOT NULL, channel_id text NOT NULL DEFAULT '', event_id text NOT NULL DEFAULT '', review_id text NOT NULL,
  line_user_id text NOT NULL DEFAULT '', processing_status text NOT NULL DEFAULT '', status text NOT NULL DEFAULT '', needs_review boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, review_id)
);
CREATE INDEX IF NOT EXISTS message_logs_event_idx ON message_logs(property_id, event_id);
CREATE INDEX IF NOT EXISTS message_logs_recent_idx ON message_logs(property_id, channel_id, line_user_id, created_at);
CREATE TABLE IF NOT EXISTS review_queue_items (
  property_id text NOT NULL, review_id text NOT NULL, status text NOT NULL, owner_action text, review_note text,
  resolved_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (property_id, review_id)
);
CREATE TABLE IF NOT EXISTS event_claims (
  property_id text NOT NULL, external_event_id text NOT NULL, channel_id text NOT NULL, review_id text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (property_id, external_event_id)
);

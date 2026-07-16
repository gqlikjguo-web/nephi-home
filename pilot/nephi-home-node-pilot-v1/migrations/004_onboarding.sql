ALTER TABLE room_types ADD COLUMN IF NOT EXISTS base_price integer NOT NULL DEFAULT 0;
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS weekday_price integer NOT NULL DEFAULT 0;
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS friday_price integer NOT NULL DEFAULT 0;
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS saturday_price integer NOT NULL DEFAULT 0;
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS onboarding_applications (
  application_id text PRIMARY KEY, draft_token_hash text NOT NULL, status text NOT NULL DEFAULT 'draft', core_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  property_id_suggestion text NOT NULL DEFAULT '', approved_property_id text, submitted_at timestamptz, approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS onboarding_room_types (
  application_id text NOT NULL REFERENCES onboarding_applications(application_id) ON DELETE CASCADE, room_key text NOT NULL, data jsonb NOT NULL, position integer NOT NULL, PRIMARY KEY(application_id,room_key)
);
CREATE TABLE IF NOT EXISTS onboarding_bundle_offers (
  application_id text NOT NULL REFERENCES onboarding_applications(application_id) ON DELETE CASCADE, bundle_key text NOT NULL, data jsonb NOT NULL, position integer NOT NULL, PRIMARY KEY(application_id,bundle_key)
);
CREATE TABLE IF NOT EXISTS onboarding_bundle_members (
  application_id text NOT NULL, bundle_key text NOT NULL, room_key text NOT NULL, position integer NOT NULL,
  PRIMARY KEY(application_id,bundle_key,room_key), FOREIGN KEY(application_id,bundle_key) REFERENCES onboarding_bundle_offers(application_id,bundle_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS onboarding_knowledge_items (
  application_id text NOT NULL REFERENCES onboarding_applications(application_id) ON DELETE CASCADE, knowledge_key text NOT NULL, data jsonb NOT NULL, position integer NOT NULL, PRIMARY KEY(application_id,knowledge_key)
);
CREATE TABLE IF NOT EXISTS onboarding_attachments (
  attachment_id text PRIMARY KEY, application_id text NOT NULL REFERENCES onboarding_applications(application_id) ON DELETE CASCADE,
  file_name text NOT NULL, content_type text NOT NULL, byte_size integer NOT NULL, sha256 text NOT NULL, content bytea NOT NULL,
  review_status text NOT NULL DEFAULT 'pending_review', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS onboarding_review_notes (
  note_id text PRIMARY KEY, application_id text NOT NULL REFERENCES onboarding_applications(application_id) ON DELETE CASCADE,
  action text NOT NULL, note text NOT NULL DEFAULT '', reviewer_property_id text, reviewer_username text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform_admin_grants (
  property_id text NOT NULL, username text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(property_id,username),
  FOREIGN KEY(property_id,username) REFERENCES admin_users(property_id,username) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS property_admin_invitations (
  token_hash text PRIMARY KEY, property_id text NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE, username text NOT NULL,
  expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inventory_availability_days (
  property_id text NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE, inventory_id text NOT NULL, stay_date date NOT NULL,
  status text NOT NULL CHECK(status IN ('available','closed')), remaining integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(property_id,inventory_id,stay_date)
);
CREATE INDEX IF NOT EXISTS onboarding_status_idx ON onboarding_applications(status,updated_at);
CREATE INDEX IF NOT EXISTS inventory_availability_range_idx ON inventory_availability_days(property_id,stay_date);

CREATE TABLE IF NOT EXISTS admin_identities (
  user_id text PRIMARY KEY,
  email text NOT NULL,
  normalized_email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_user_properties (
  user_id text NOT NULL REFERENCES admin_identities(user_id) ON DELETE CASCADE,
  property_id text NOT NULL,
  username text NOT NULL,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, property_id),
  UNIQUE(property_id, username),
  FOREIGN KEY(property_id, username) REFERENCES admin_users(property_id, username) ON DELETE CASCADE
);

ALTER TABLE admin_sessions DROP CONSTRAINT IF EXISTS admin_sessions_property_id_username_fkey;
ALTER TABLE admin_sessions ALTER COLUMN property_id DROP NOT NULL;
ALTER TABLE admin_sessions ALTER COLUMN username DROP NOT NULL;
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE property_admin_invitations ADD COLUMN IF NOT EXISTS email text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='admin_sessions_user_id_fkey') THEN
    ALTER TABLE admin_sessions ADD CONSTRAINT admin_sessions_user_id_fkey FOREIGN KEY(user_id) REFERENCES admin_identities(user_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='admin_sessions_property_id_username_fkey') THEN
    ALTER TABLE admin_sessions ADD CONSTRAINT admin_sessions_property_id_username_fkey FOREIGN KEY(property_id,username) REFERENCES admin_users(property_id,username) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS admin_user_properties_property_idx ON admin_user_properties(property_id);
CREATE INDEX IF NOT EXISTS admin_sessions_user_id_idx ON admin_sessions(user_id);

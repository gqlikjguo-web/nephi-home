CREATE TABLE IF NOT EXISTS property_line_setup_tokens (
  setup_id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  property_id text NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  used_at timestamptz,
  created_by_property_id text NOT NULL,
  created_by_username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_line_setup_tokens_property_idx
  ON property_line_setup_tokens(property_id, created_at DESC);

ALTER TABLE property_line_bindings
  ADD COLUMN IF NOT EXISTS last_webhook_observed_at timestamptz;

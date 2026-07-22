CREATE TABLE IF NOT EXISTS property_line_bindings (
  property_id text PRIMARY KEY REFERENCES properties(property_id) ON DELETE CASCADE,
  webhook_key text NOT NULL UNIQUE,
  channel_secret_encrypted jsonb NOT NULL,
  channel_access_token_encrypted jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_line_bindings_enabled_idx
  ON property_line_bindings(enabled);

ALTER TABLE property_line_bindings
  ADD COLUMN IF NOT EXISTS last_webhook_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_valid_webhook_at timestamptz;

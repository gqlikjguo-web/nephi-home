ALTER TABLE property_line_bindings
  ADD COLUMN IF NOT EXISTS last_webhook_at timestamptz;

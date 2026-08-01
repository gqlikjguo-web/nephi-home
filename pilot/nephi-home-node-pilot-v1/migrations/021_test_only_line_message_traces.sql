CREATE TABLE IF NOT EXISTS test_only_line_message_traces (
  property_id TEXT NOT NULL,
  channel_id_hash TEXT NOT NULL CHECK (channel_id_hash ~ '^[a-f0-9]{64}$'),
  event_id TEXT NOT NULL,
  event_timestamp TEXT NOT NULL DEFAULT '',
  line_user_hash TEXT NOT NULL CHECK (line_user_hash ~ '^[a-f0-9]{64}$'),
  message_text_hash TEXT NOT NULL CHECK (message_text_hash ~ '^[a-f0-9]{64}$'),
  trace_id TEXT NOT NULL DEFAULT '',
  stages JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_test_only_line_message_traces_expires_at
  ON test_only_line_message_traces (expires_at);

CREATE INDEX IF NOT EXISTS idx_test_only_line_message_traces_property_message
  ON test_only_line_message_traces (property_id, message_text_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_test_only_line_message_traces_trace_id
  ON test_only_line_message_traces (trace_id)
  WHERE trace_id <> '';

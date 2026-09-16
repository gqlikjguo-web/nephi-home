-- Independent commercial authority. NULL is unconfigured, never an unlimited allowance.
CREATE TABLE IF NOT EXISTS commercial_ai_controls (
  property_id TEXT PRIMARY KEY REFERENCES properties(property_id) ON DELETE CASCADE,
  monthly_limit BIGINT CHECK (monthly_limit >= 0 AND monthly_limit <= 9007199254740991),
  ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commercial_ai_monthly_usage (
  property_id TEXT NOT NULL REFERENCES commercial_ai_controls(property_id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  used BIGINT NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= 9007199254740991),
  PRIMARY KEY (property_id, period)
);

CREATE TABLE IF NOT EXISTS commercial_ai_handoffs (
  property_id TEXT NOT NULL REFERENCES commercial_ai_controls(property_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  human_controlled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, channel_id, line_user_id)
);

-- Same event uniqueness scope as event_claims. A month rollover cannot charge it again.
CREATE TABLE IF NOT EXISTS commercial_ai_message_ledger (
  property_id TEXT NOT NULL,
  event_id TEXT NOT NULL CHECK (event_id <> ''),
  channel_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  period TEXT NOT NULL,
  turn_id TEXT,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, event_id),
  FOREIGN KEY (property_id, period) REFERENCES commercial_ai_monthly_usage(property_id, period) ON DELETE CASCADE
);

-- An admitted attempt with NULL usage is an unknown result, never zero tokens.
CREATE TABLE IF NOT EXISTS commercial_ai_manual_authorizations (
  property_id TEXT NOT NULL REFERENCES commercial_ai_controls(property_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  test_session_id UUID REFERENCES new_core_test_sessions(test_session_id) ON DELETE CASCADE,
  admin_session_hash TEXT REFERENCES admin_sessions(token_hash) ON DELETE CASCADE,
  event_ids TEXT[] NOT NULL CHECK (cardinality(event_ids) > 0),
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, channel_id, line_user_id, turn_id),
  CHECK ((test_session_id IS NOT NULL) <> (admin_session_hash IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS commercial_ai_attempt_ledger (
  property_id TEXT NOT NULL REFERENCES commercial_ai_controls(property_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  line_user_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number IN (1, 2)),
  source TEXT NOT NULL DEFAULT 'guest_message' CHECK (source IN ('guest_message','manual_test')),
  event_ids TEXT[] NOT NULL CHECK (cardinality(event_ids) > 0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  outcome TEXT,
  input_tokens BIGINT CHECK (input_tokens >= 0),
  cached_input_tokens BIGINT CHECK (cached_input_tokens >= 0),
  output_tokens BIGINT CHECK (output_tokens >= 0),
  total_tokens BIGINT CHECK (total_tokens >= 0),
  PRIMARY KEY (property_id, channel_id, line_user_id, turn_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS new_core_test_sessions (
  test_session_id UUID PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
  state_v3 JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS new_core_test_turns (
  turn_id UUID PRIMARY KEY,
  test_session_id UUID NOT NULL REFERENCES new_core_test_sessions(test_session_id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK (generation > 0),
  trace_id UUID NOT NULL UNIQUE,
  occurred_at TIMESTAMPTZ NOT NULL,
  input_text TEXT NOT NULL CHECK (char_length(input_text) BETWEEN 1 AND 1000),
  predicted_response TEXT NOT NULL,
  safe_diagnostic JSONB NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'UNMARKED' CHECK (review_status IN ('UNMARKED','CORRECT','PROBLEM')),
  problem_category TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '' CHECK (char_length(review_note) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_new_core_test_turns_owner_recent ON new_core_test_turns(owner_id, property_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_new_core_test_turns_session ON new_core_test_turns(test_session_id, generation, occurred_at);

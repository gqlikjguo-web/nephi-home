-- Additive, independent guest feedback. No changes to existing property authority.
CREATE TABLE property_feedback_links (
 property_id text PRIMARY KEY REFERENCES properties(property_id),
 public_token text UNIQUE NOT NULL CHECK(public_token ~ '^[A-Za-z0-9_-]{43}$'),
 created_at timestamptz NOT NULL DEFAULT now(), rotated_at timestamptz
);
CREATE TABLE guest_feedback (
 id uuid PRIMARY KEY, property_id text NOT NULL REFERENCES properties(property_id),
 overall smallint NOT NULL CHECK(overall BETWEEN 1 AND 5),
 ratings jsonb NOT NULL DEFAULT '{}', positives text[] NOT NULL DEFAULT '{}', improvements text[] NOT NULL DEFAULT '{}',
 revisit text CHECK(revisit IN ('yes','maybe','no')),
 stay_date date, room_id text, room_name text,
 comment text NOT NULL DEFAULT '' CHECK(length(comment)<=2000),
 status text NOT NULL DEFAULT 'unviewed' CHECK(status IN ('unviewed','viewed','needs_improvement','improved')),
 internal_note text NOT NULL DEFAULT '' CHECK(length(internal_note)<=1000),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guest_feedback_history ON guest_feedback(property_id,created_at DESC,id DESC);
CREATE INDEX guest_feedback_status ON guest_feedback(property_id,status,created_at DESC);
-- Only transient abuse counters expire; feedback never expires.
CREATE TABLE feedback_rate_limits (
 property_id text NOT NULL REFERENCES properties(property_id), visitor_hash text NOT NULL,
 window_start timestamptz NOT NULL, attempts integer NOT NULL,
 PRIMARY KEY(property_id,visitor_hash)
);

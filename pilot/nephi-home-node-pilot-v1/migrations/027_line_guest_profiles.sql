-- Optional display metadata only; identity remains the existing conversation tuple.
CREATE TABLE line_guest_profiles (
  property_id text NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  line_user_id text NOT NULL,
  display_name text,
  fetched_at timestamptz,
  last_attempt_at timestamptz,
  next_refresh_at timestamptz NOT NULL DEFAULT now(),
  last_result text NOT NULL DEFAULT 'unfetched' CHECK (last_result IN
    ('unfetched','success','unavailable','forbidden','rate_limited','provider_error','invalid_response','source_mismatch')),
  credential_version text NOT NULL,
  source_destination text NOT NULL,
  source_event_id text NOT NULL,
  source_observed_at timestamptz NOT NULL DEFAULT now(),
  attempt_id text,
  lease_until timestamptz,
  PRIMARY KEY (property_id,channel_id,line_user_id),
  CHECK (length(display_name) BETWEEN 1 AND 256),
  CHECK ((attempt_id IS NULL) = (lease_until IS NULL))
);

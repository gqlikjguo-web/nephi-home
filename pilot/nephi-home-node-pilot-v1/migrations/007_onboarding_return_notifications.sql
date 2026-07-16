CREATE TABLE IF NOT EXISTS onboarding_resume_tokens (
  token_hash text PRIMARY KEY,
  application_id text NOT NULL REFERENCES onboarding_applications(application_id) ON DELETE CASCADE,
  review_note_id text NOT NULL UNIQUE REFERENCES onboarding_review_notes(note_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onboarding_email_deliveries (
  review_note_id text PRIMARY KEY REFERENCES onboarding_review_notes(note_id) ON DELETE CASCADE,
  application_id text NOT NULL REFERENCES onboarding_applications(application_id) ON DELETE CASCADE,
  recipient text NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','sending','sent','failed','not_configured')),
  provider_message_id text,
  last_error text,
  attempted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS onboarding_resume_application_idx ON onboarding_resume_tokens(application_id,expires_at);
CREATE INDEX IF NOT EXISTS onboarding_email_status_idx ON onboarding_email_deliveries(status,updated_at);

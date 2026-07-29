ALTER TABLE onboarding_applications
  ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_created_by_property_id text,
  ADD COLUMN IF NOT EXISTS invite_created_by_username text;

CREATE INDEX IF NOT EXISTS onboarding_active_invite_idx
  ON onboarding_applications(draft_token_hash, invite_expires_at)
  WHERE invite_revoked_at IS NULL;

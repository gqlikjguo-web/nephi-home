ALTER TABLE onboarding_applications
  ADD COLUMN IF NOT EXISTS submitted_snapshot jsonb;

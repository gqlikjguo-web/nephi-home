ALTER TABLE onboarding_applications
  ADD COLUMN IF NOT EXISTS approval_mode text,
  ADD COLUMN IF NOT EXISTS approved_by_property_id text,
  ADD COLUMN IF NOT EXISTS approved_by_username text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'onboarding_applications'::regclass
      AND conname = 'onboarding_applications_approval_mode_check'
  ) THEN
    ALTER TABLE onboarding_applications
      ADD CONSTRAINT onboarding_applications_approval_mode_check
      CHECK (approval_mode IS NULL OR approval_mode IN ('new', 'existing'));
  END IF;
END $$;

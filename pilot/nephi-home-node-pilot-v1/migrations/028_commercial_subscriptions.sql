-- Snapshot only pre-existing properties. Reapplying this file must not grant new properties.
DO $$ BEGIN
  IF to_regclass('commercial_ai_subscriptions') IS NULL THEN
    CREATE TABLE commercial_ai_subscriptions (
      property_id TEXT PRIMARY KEY REFERENCES properties(property_id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('legacy','active','disabled')),
      contract_start DATE,
      contract_end DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by JSONB,
      CHECK ((status='legacy' AND contract_start IS NULL AND contract_end IS NULL)
        OR (status IN ('active','disabled') AND contract_start IS NOT NULL
          AND contract_end IS NOT NULL AND contract_end>=contract_start))
    );
    INSERT INTO commercial_ai_subscriptions(property_id,status)
      SELECT property_id,'legacy' FROM properties;
  END IF;
END $$;

-- Monthly plan remains commercial_ai_controls.monthly_limit: no second quota authority.
CREATE TABLE IF NOT EXISTS commercial_ai_subscription_audit (
  audit_id BIGSERIAL PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor JSONB NOT NULL,
  previous_value JSONB NOT NULL,
  next_value JSONB NOT NULL
);

-- Property-scoped bundle entertainment facts. Repeat-safe and non-destructive.
ALTER TABLE bundle_offers
  ADD COLUMN IF NOT EXISTS entertainment_amenities jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Existing rows remain unknown ([]). Legacy FAQ text is intentionally not
-- inferred into provided=true facts.

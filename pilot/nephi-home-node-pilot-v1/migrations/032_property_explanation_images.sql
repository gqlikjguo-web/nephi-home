CREATE TABLE IF NOT EXISTS property_explanation_images (
  property_id text NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  canonical_id text NOT NULL CHECK (length(canonical_id) BETWEEN 1 AND 120),
  public_id text NOT NULL UNIQUE CHECK (public_id ~ '^[A-Za-z0-9_-]{32}$'),
  original_content bytea NOT NULL CHECK (octet_length(original_content) BETWEEN 1 AND 2097152),
  preview_content bytea NOT NULL CHECK (octet_length(preview_content) BETWEEN 1 AND 262144),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, canonical_id)
);

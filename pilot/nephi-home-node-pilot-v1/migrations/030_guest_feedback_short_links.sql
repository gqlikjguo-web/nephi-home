-- 96 CSPRNG bits: first 48 random bits from each of two independent UUID v4s.
-- The selected bits exclude UUID version/variant bits. 12 bytes -> 16 base64url chars.
ALTER TABLE property_feedback_links ADD COLUMN short_public_id text NOT NULL DEFAULT
 translate(encode(decode(
  substr(replace(gen_random_uuid()::text,'-',''),1,12) ||
  substr(replace(gen_random_uuid()::text,'-',''),1,12), 'hex'),'base64'),'+/','-_');
ALTER TABLE property_feedback_links ADD CONSTRAINT property_feedback_links_short_public_id_key UNIQUE(short_public_id);
ALTER TABLE property_feedback_links ADD CONSTRAINT property_feedback_links_short_public_id_check CHECK(short_public_id ~ '^[A-Za-z0-9_-]{16}$');
-- Provision existing properties, including those that have never opened Feedback.
-- Existing long tokens are untouched. New legacy tokens retain 244 random bits.
INSERT INTO property_feedback_links(property_id,public_token)
 SELECT property_id,rtrim(translate(encode(decode(
  replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),
  'hex'),'base64'),'+/','-_'),'=') FROM properties
 ON CONFLICT(property_id) DO NOTHING;
-- Future properties are provisioned atomically on first authorized Feedback use.
-- No feedback/history or other operational table is changed.

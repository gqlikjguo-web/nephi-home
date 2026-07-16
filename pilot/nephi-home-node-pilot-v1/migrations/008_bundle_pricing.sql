ALTER TABLE bundle_offers ADD COLUMN IF NOT EXISTS monday_thursday_price numeric(12,2);
ALTER TABLE bundle_offers ADD COLUMN IF NOT EXISTS friday_price numeric(12,2);
ALTER TABLE bundle_offers ADD COLUMN IF NOT EXISTS saturday_holiday_price numeric(12,2);
ALTER TABLE bundle_offers ADD COLUMN IF NOT EXISTS sunday_price numeric(12,2);

UPDATE bundle_offers SET monday_thursday_price=base_price WHERE monday_thursday_price IS NULL;
UPDATE bundle_offers SET friday_price=base_price WHERE friday_price IS NULL;
UPDATE bundle_offers SET saturday_holiday_price=base_price WHERE saturday_holiday_price IS NULL;
UPDATE bundle_offers SET sunday_price=base_price WHERE sunday_price IS NULL;

ALTER TABLE bundle_offers ALTER COLUMN monday_thursday_price SET DEFAULT 0;
ALTER TABLE bundle_offers ALTER COLUMN friday_price SET DEFAULT 0;
ALTER TABLE bundle_offers ALTER COLUMN saturday_holiday_price SET DEFAULT 0;
ALTER TABLE bundle_offers ALTER COLUMN sunday_price SET DEFAULT 0;
ALTER TABLE bundle_offers ALTER COLUMN monday_thursday_price SET NOT NULL;
ALTER TABLE bundle_offers ALTER COLUMN friday_price SET NOT NULL;
ALTER TABLE bundle_offers ALTER COLUMN saturday_holiday_price SET NOT NULL;
ALTER TABLE bundle_offers ALTER COLUMN sunday_price SET NOT NULL;

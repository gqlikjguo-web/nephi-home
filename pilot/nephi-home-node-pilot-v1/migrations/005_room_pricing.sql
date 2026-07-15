ALTER TABLE room_types ADD COLUMN IF NOT EXISTS monday_thursday_price numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS saturday_holiday_price numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS sunday_price numeric(12,2) NOT NULL DEFAULT 0;
UPDATE room_types SET monday_thursday_price=CASE WHEN monday_thursday_price=0 THEN weekday_price ELSE monday_thursday_price END,saturday_holiday_price=CASE WHEN saturday_holiday_price=0 THEN saturday_price ELSE saturday_holiday_price END,sunday_price=CASE WHEN sunday_price=0 THEN weekday_price ELSE sunday_price END;
UPDATE property_settings SET settings=jsonb_set(settings,'{currency}',to_jsonb(COALESCE(NULLIF(settings->>'currency',''),'TWD')),true) WHERE NOT settings?'currency' OR settings->>'currency'='';
CREATE TABLE IF NOT EXISTS room_price_overrides(property_id text NOT NULL,room_id text NOT NULL,stay_date date NOT NULL,price numeric(12,2) NOT NULL CHECK(price>=0),currency text NOT NULL DEFAULT 'TWD',updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(property_id,room_id,stay_date),FOREIGN KEY(property_id,room_id) REFERENCES room_types(property_id,room_id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS room_price_overrides_range_idx ON room_price_overrides(property_id,stay_date);

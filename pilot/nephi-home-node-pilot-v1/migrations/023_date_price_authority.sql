ALTER TABLE room_price_overrides ADD COLUMN bundle_id text;
ALTER TABLE room_price_overrides ADD COLUMN price_type text;
ALTER TABLE room_price_overrides DROP CONSTRAINT room_price_overrides_pkey;
ALTER TABLE room_price_overrides ALTER COLUMN room_id DROP NOT NULL;
ALTER TABLE room_price_overrides ALTER COLUMN price DROP NOT NULL;

ALTER TABLE room_price_overrides
  ADD CONSTRAINT room_price_overrides_bundle_fk
  FOREIGN KEY(property_id,bundle_id) REFERENCES bundle_offers(property_id,bundle_id) ON DELETE CASCADE;
ALTER TABLE room_price_overrides
  ADD CONSTRAINT room_price_overrides_inventory_check
  CHECK(num_nonnulls(room_id,bundle_id)=1);
ALTER TABLE room_price_overrides
  ADD CONSTRAINT room_price_overrides_price_type_check
  CHECK(price_type IS NULL OR price_type IN ('monday_thursday','friday','saturday_holiday','sunday'));
ALTER TABLE room_price_overrides
  ADD CONSTRAINT room_price_overrides_value_check
  CHECK(num_nonnulls(price,price_type)=1);

CREATE UNIQUE INDEX room_price_overrides_room_date_uidx
  ON room_price_overrides(property_id,room_id,stay_date) WHERE room_id IS NOT NULL;
CREATE UNIQUE INDEX room_price_overrides_bundle_date_uidx
  ON room_price_overrides(property_id,bundle_id,stay_date) WHERE bundle_id IS NOT NULL;

CREATE TABLE property_date_price_classifications(
  property_id text NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  stay_date date NOT NULL,
  price_type text NOT NULL CHECK(price_type IN ('monday_thursday','friday','saturday_holiday','sunday')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(property_id,stay_date)
);

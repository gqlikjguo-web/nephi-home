CREATE TABLE IF NOT EXISTS bundle_offers (
  property_id TEXT NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
  bundle_id TEXT NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  base_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(property_id,bundle_id)
);
CREATE TABLE IF NOT EXISTS bundle_offer_members (
  property_id TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(property_id,bundle_id,room_id),
  FOREIGN KEY(property_id,bundle_id) REFERENCES bundle_offers(property_id,bundle_id) ON DELETE CASCADE,
  FOREIGN KEY(property_id,room_id) REFERENCES room_types(property_id,room_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS bundle_availability_days (
  property_id TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  stay_date DATE NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('available','closed')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(property_id,bundle_id,stay_date),
  FOREIGN KEY(property_id,bundle_id) REFERENCES bundle_offers(property_id,bundle_id) ON DELETE CASCADE
);

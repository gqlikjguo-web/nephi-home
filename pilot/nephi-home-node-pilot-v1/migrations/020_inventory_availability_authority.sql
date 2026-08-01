WITH legacy_room_status AS (
  SELECT
    availability.property_id,
    rooms.room_id AS inventory_id,
    availability.stay_date,
    to_jsonb(availability) ->> rooms.room_id AS status
  FROM availability_days availability
  JOIN room_types rooms ON rooms.property_id = availability.property_id
  WHERE to_jsonb(availability) ->> rooms.room_id IN ('available', 'closed')
)
INSERT INTO inventory_availability_days(property_id, inventory_id, stay_date, status, remaining)
SELECT
  property_id,
  inventory_id,
  stay_date,
  status,
  CASE WHEN status = 'available' THEN 1 ELSE 0 END
FROM legacy_room_status
ON CONFLICT(property_id, inventory_id, stay_date) DO UPDATE SET
  status = EXCLUDED.status,
  remaining = EXCLUDED.remaining,
  updated_at = now();

WITH legacy_dates AS (
  SELECT property_id, stay_date
  FROM availability_days
),
bundle_status AS (
  SELECT
    bundles.property_id,
    bundles.bundle_id AS inventory_id,
    legacy_dates.stay_date,
    CASE
      WHEN count(inventory.inventory_id) = count(members.room_id)
        AND bool_and(inventory.status = 'available')
      THEN 'available'
      ELSE 'closed'
    END AS status
  FROM bundle_offers bundles
  JOIN bundle_offer_members members
    ON members.property_id = bundles.property_id
   AND members.bundle_id = bundles.bundle_id
  JOIN legacy_dates ON legacy_dates.property_id = bundles.property_id
  LEFT JOIN inventory_availability_days inventory
    ON inventory.property_id = members.property_id
   AND inventory.inventory_id = members.room_id
   AND inventory.stay_date = legacy_dates.stay_date
  GROUP BY bundles.property_id, bundles.bundle_id, legacy_dates.stay_date
)
INSERT INTO inventory_availability_days(property_id, inventory_id, stay_date, status, remaining)
SELECT
  property_id,
  inventory_id,
  stay_date,
  status,
  CASE WHEN status = 'available' THEN 1 ELSE 0 END
FROM bundle_status
ON CONFLICT(property_id, inventory_id, stay_date) DO UPDATE SET
  status = EXCLUDED.status,
  remaining = EXCLUDED.remaining,
  updated_at = now();

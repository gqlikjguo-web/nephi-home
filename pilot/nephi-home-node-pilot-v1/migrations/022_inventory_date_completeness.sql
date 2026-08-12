WITH managed_dates AS (
  SELECT DISTINCT property_id, stay_date
  FROM inventory_availability_days
),
enabled_inventory AS (
  SELECT property_id, room_id AS inventory_id
  FROM room_types
  WHERE enabled = true
  UNION ALL
  SELECT property_id, bundle_id AS inventory_id
  FROM bundle_offers
  WHERE enabled = true
)
INSERT INTO inventory_availability_days(property_id, inventory_id, stay_date, status, remaining)
SELECT dates.property_id, inventory.inventory_id, dates.stay_date, 'closed', 0
FROM managed_dates dates
JOIN enabled_inventory inventory ON inventory.property_id = dates.property_id
ON CONFLICT(property_id, inventory_id, stay_date) DO NOTHING;

ALTER TABLE platform_admin_grants ADD COLUMN IF NOT EXISTS granted_user_id text;
ALTER TABLE platform_admin_grants ADD COLUMN IF NOT EXISTS granted_email_snapshot text;

UPDATE platform_admin_grants grant_row
SET granted_user_id=membership.user_id,
    granted_email_snapshot=identity.email
FROM admin_user_properties membership
JOIN admin_identities identity ON identity.user_id=membership.user_id
WHERE membership.property_id=grant_row.property_id
  AND membership.username=grant_row.username
  AND grant_row.granted_user_id IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='platform_admin_grants_granted_user_id_fkey') THEN
    ALTER TABLE platform_admin_grants
      ADD CONSTRAINT platform_admin_grants_granted_user_id_fkey
      FOREIGN KEY(granted_user_id) REFERENCES admin_identities(user_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION reject_platform_admin_grant_audit_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.granted_user_id IS DISTINCT FROM NEW.granted_user_id
     OR OLD.granted_email_snapshot IS DISTINCT FROM NEW.granted_email_snapshot THEN
    RAISE EXCEPTION 'platform admin grant audit is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_admin_grant_audit_immutable ON platform_admin_grants;
CREATE TRIGGER platform_admin_grant_audit_immutable
BEFORE UPDATE OF granted_user_id,granted_email_snapshot ON platform_admin_grants
FOR EACH ROW EXECUTE FUNCTION reject_platform_admin_grant_audit_update();

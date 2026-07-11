-- ══════════════════════════════════════════════════════════════
-- Introduces a real, server-controlled admin role and tightens
-- platform_settings write access.
--
-- is_admin lives as its own profiles column, not in user_metadata (which
-- users can edit on their own accounts). It's intentionally not writable
-- through /api/profile or any other user-facing route — only via the
-- service-role client.
-- Run in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Belt-and-suspenders: a trigger enforces that is_admin can only change
-- via the service-role client, regardless of what any future policy or
-- route allows on the rest of the row.
CREATE OR REPLACE FUNCTION prevent_self_admin_promotion()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin AND auth.role() <> 'service_role' THEN
    NEW.is_admin := OLD.is_admin;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS profiles_prevent_self_admin_promotion ON profiles;
CREATE TRIGGER profiles_prevent_self_admin_promotion
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_self_admin_promotion();

-- platform_settings is only ever updated through the app route using the
-- service-role client (which bypasses RLS anyway), so a separate
-- client-writable UPDATE policy served no purpose. Public read stays
-- (used by the availability API).
DROP POLICY IF EXISTS "settings_host_update" ON platform_settings;

-- After this migration, grant admin to the initial owner account(s) via
-- /dashboard/admin (see app/api/admin/users/route.ts), or directly:
--   UPDATE profiles SET is_admin = true WHERE id = '<user-uuid>';

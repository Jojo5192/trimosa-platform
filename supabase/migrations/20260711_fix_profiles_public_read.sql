-- ══════════════════════════════════════════════════════════════
-- Restricts profiles SELECT to the owning row only.
--
-- No code path needs public read access: every server-side display of
-- another user's profile (e.g. host info on a listing page) already goes
-- through the service-role client, which bypasses RLS regardless. The
-- remaining "profiles_own_write" policy (FOR ALL) already covers owner
-- SELECT/INSERT/UPDATE/DELETE.
--
-- Run in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "profiles_public_read" ON profiles;

-- Owner-only Policy erneuern, falls sie fehlt (idempotent)
DROP POLICY IF EXISTS "profiles_own_write" ON profiles;
CREATE POLICY "profiles_own_write"
  ON profiles FOR ALL
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

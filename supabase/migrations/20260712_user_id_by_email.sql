-- ══════════════════════════════════════════════════════════════
-- Helper to look up an auth.users id by email from server code.
--
-- The Supabase JS client can't query the `auth` schema directly
-- (it isn't exposed through PostgREST), so
-- `supabaseAdmin.schema('auth').from('users')` always returned nothing —
-- which silently broke the admin/host grant-by-email flow in
-- app/api/admin/users/route.ts. This SECURITY DEFINER function runs with
-- owner rights and is only reachable via the service-role client (the
-- admin route already gates every caller on is_admin).
-- Run in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;

-- Only the service-role key should call this (defense in depth).
REVOKE ALL ON FUNCTION get_user_id_by_email(text) FROM public, anon, authenticated;

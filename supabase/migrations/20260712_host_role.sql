-- ══════════════════════════════════════════════════════════════
-- Echtes Gastgeber-Rollenmodell (analog is_admin).
--
-- Bisher lag "ist Gastgeber" nur in user_metadata.role — vom Nutzer selbst
-- editierbar (supabase.auth.updateUser({data})) und nur ein Navigations-
-- Flag. Bei Single-Host soll die Gastgeber-Rolle nur von TRIMOSA vergeben
-- werden. is_host lebt daher als profiles-Spalte, nur per Service-Role
-- setzbar, und listings-INSERT wird an is_host gebunden — so kann sich
-- niemand selbst zum Gastgeber machen und ein Inserat auf die Startseite
-- setzen.
-- Run in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_host BOOLEAN NOT NULL DEFAULT false;

-- Bestehender TRIMOSA-Gastgeber-Account behält seinen Zugang.
UPDATE profiles SET is_host = true
  WHERE id IN (SELECT id FROM auth.users WHERE email = 'goergen@trimosa.de');

-- Trigger gegen Selbst-Beförderung erweitern: is_host wie is_admin nur per
-- Service-Role änderbar. (Ersetzt die Funktion aus
-- 20260711_admin_role_and_settings_rls.sql.)
CREATE OR REPLACE FUNCTION prevent_self_admin_promotion()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
      NEW.is_admin := OLD.is_admin;
    END IF;
    IF NEW.is_host IS DISTINCT FROM OLD.is_host THEN
      NEW.is_host := OLD.is_host;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- listings-INSERT nur noch für echte Gastgeber (host_id muss auth.uid()
-- sein UND der Nutzer muss is_host haben).
DROP POLICY IF EXISTS "listings_host_insert" ON listings;
CREATE POLICY "listings_host_insert" ON listings FOR INSERT TO authenticated
  WITH CHECK (
    host_id = auth.uid()
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_host = true)
  );

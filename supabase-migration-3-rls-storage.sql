-- ══════════════════════════════════════════════════════════════
-- TRIMOSA Migration 3 — RLS für Listings + Storage-Bucket
-- Run in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- ── 1. Listings: RLS aktivieren + Policies ──────────────────

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "listings_public_read"   ON listings;
DROP POLICY IF EXISTS "listings_host_update"   ON listings;
DROP POLICY IF EXISTS "listings_host_insert"   ON listings;
DROP POLICY IF EXISTS "listings_host_delete"   ON listings;

-- Alle können aktive Inserate lesen
CREATE POLICY "listings_public_read"
  ON listings FOR SELECT
  USING (true);

-- Gastgeber können ihre eigenen Inserate aktualisieren
CREATE POLICY "listings_host_update"
  ON listings FOR UPDATE
  USING  (host_id = auth.uid())
  WITH CHECK (host_id = auth.uid());

-- Gastgeber können neue Inserate anlegen
CREATE POLICY "listings_host_insert"
  ON listings FOR INSERT
  TO authenticated
  WITH CHECK (host_id = auth.uid());

-- Gastgeber können ihre eigenen Inserate löschen
CREATE POLICY "listings_host_delete"
  ON listings FOR DELETE
  USING (host_id = auth.uid());

-- ── 2. Bookings: RLS aktivieren + Policies ──────────────────

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bookings_guest_read"    ON bookings;
DROP POLICY IF EXISTS "bookings_host_read"     ON bookings;
DROP POLICY IF EXISTS "bookings_guest_insert"  ON bookings;
DROP POLICY IF EXISTS "bookings_host_update"   ON bookings;

-- Gäste sehen ihre eigenen Buchungen
CREATE POLICY "bookings_guest_read"
  ON bookings FOR SELECT
  USING (guest_id = auth.uid());

-- Gastgeber sehen Buchungen für ihre Inserate
CREATE POLICY "bookings_host_read"
  ON bookings FOR SELECT
  USING (
    listing_id IN (
      SELECT id FROM listings WHERE host_id = auth.uid()
    )
  );

-- Eingeloggte Nutzer können Buchungen anlegen
CREATE POLICY "bookings_guest_insert"
  ON bookings FOR INSERT
  TO authenticated
  WITH CHECK (guest_id = auth.uid());

-- Gastgeber können Buchungsstatus aktualisieren
CREATE POLICY "bookings_host_update"
  ON bookings FOR UPDATE
  USING (
    listing_id IN (
      SELECT id FROM listings WHERE host_id = auth.uid()
    )
  );

-- ── 3. Storage Bucket + Policies ────────────────────────────

-- Bucket erstellen (falls noch nicht vorhanden)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'listing-images',
  'listing-images',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 10485760,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Storage RLS
DROP POLICY IF EXISTS "listing_images_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "listing_images_auth_upload"   ON storage.objects;
DROP POLICY IF EXISTS "listing_images_auth_delete"   ON storage.objects;
DROP POLICY IF EXISTS "listing_images_auth_update"   ON storage.objects;

-- Jeder kann Bilder lesen (Public Bucket)
CREATE POLICY "listing_images_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'listing-images');

-- Eingeloggte Nutzer können hochladen
CREATE POLICY "listing_images_auth_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'listing-images');

-- Eingeloggte Nutzer können ihre eigenen Dateien aktualisieren
CREATE POLICY "listing_images_auth_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'listing-images');

-- Eingeloggte Nutzer können Dateien löschen
CREATE POLICY "listing_images_auth_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'listing-images');

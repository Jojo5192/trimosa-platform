-- 🔒 Website-Audit 14.10.2026, kritischer Punkt 1 (HANDOFF §337/§343): Die Policy listings_public_read
-- (USING true, baseline_schema.sql:300) machte ALLE Spalten der Inserate-Tabelle mit dem öffentlichen
-- Anon-Key per REST lesbar — inklusive cleaning_token (NFC-Fertigmeldung /reinigung/<token>), locks
-- (Schloss-IDs), guide (Gästemappe mit WLAN-Passwort und Türcode-Text) und google_api_key.
--
-- Lösung: Spaltenrechte statt Policy-Umbau. Die Zeilen bleiben öffentlich lesbar (es ist eine Inserate-
-- Seite), aber anon/authenticated bekommen SELECT nur auf die unkritischen Spalten. service_role (alle
-- Server-Zugriffe über supabaseAdmin: Inserate-Seiten, NFC-Seite, Gästemappe, Team-Tools) ist von
-- Spaltenrechten nicht betroffen — jeder, der den NFC-Sticker scannt, kann weiterhin als gereinigt melden.
-- Der einzige Cookie-Client-Leser mit select('*') (app/dashboard/page.tsx) wurde auf eine Spaltenliste
-- umgestellt; INSERT/UPDATE-Rechte bleiben unverändert (Smoobu-Sync, Inserat anlegen).
--
-- Hinweis für später: Neue Spalten sind für anon/authenticated danach automatisch NICHT lesbar (sicherer
-- Standard). Braucht ein Cookie-Client-Zugriff eine neue öffentliche Spalte:
--   GRANT SELECT (spalte) ON public.listings TO anon, authenticated;

DO $$
DECLARE
  gesperrt text[] := ARRAY[
    'cleaning_token', 'locks', 'guide', 'google_api_key',                 -- Geheimnisse / Zugangsdaten
    'address', 'checkin_instructions', 'important_notes',                 -- interne Texte (Server rendert selbst)
    'cleaning_responsible', 'cleaning_minutes', 'google_place_id',
    'revyoos_property_id', 'reviews_synced_at', 'guest_summary_updated_at',
    'location_group', 'airbnb_url', 'booking_url', 'vrbo_url'            -- Team-intern, kein Client braucht sie
  ];
  frei_auth text;
  frei_anon text;
BEGIN
  -- authenticated: alles außer der Sperrliste (smoobu_id bleibt — app/api/smoobu/sync liest/filtert sie
  -- über den Cookie-Client des eingeloggten Gastgebers)
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO frei_auth
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'listings'
    AND NOT (column_name = ANY (gesperrt));

  -- anon: zusätzlich ohne smoobu_id
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO frei_anon
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'listings'
    AND NOT (column_name = ANY (gesperrt || ARRAY['smoobu_id']));

  IF frei_auth IS NULL OR frei_anon IS NULL THEN
    RAISE EXCEPTION 'listings-Spalten nicht gefunden — Migration abgebrochen';
  END IF;

  -- Tabellenweites SELECT weg (sonst wirken Spaltenrechte nicht), dann Spalten-Allowlist
  REVOKE SELECT ON public.listings FROM anon, authenticated;
  EXECUTE format('GRANT SELECT (%s) ON public.listings TO authenticated', frei_auth);
  EXECUTE format('GRANT SELECT (%s) ON public.listings TO anon', frei_anon);

  -- Selbsttest: has_column_privilege sieht auch tabellenweite Rechte — bleibt eines bestehen (REVOKE eines fremden
  -- Grantors endet nur mit WARNING), bricht die Migration hier hart ab statt still „erfolgreich" zu enden
  IF has_column_privilege('anon', 'public.listings', 'cleaning_token', 'SELECT')
     OR has_column_privilege('authenticated', 'public.listings', 'cleaning_token', 'SELECT')
     OR has_column_privilege('anon', 'public.listings', 'guide', 'SELECT')
     OR has_column_privilege('authenticated', 'public.listings', 'locks', 'SELECT') THEN
    RAISE EXCEPTION 'listings: tabellenweites SELECT für anon/authenticated nicht entzogen — Grantor prüfen (\dp listings)';
  END IF;
  IF NOT has_column_privilege('anon', 'public.listings', 'title', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.listings', 'smoobu_id', 'SELECT') THEN
    RAISE EXCEPTION 'listings: Allowlist-GRANT nicht wirksam';
  END IF;

  RAISE NOTICE 'listings: SELECT für authenticated auf % Spalten, für anon auf % Spalten beschränkt',
    array_length(string_to_array(frei_auth, ', '), 1), array_length(string_to_array(frei_anon, ', '), 1);
END $$;

-- PostgREST-Schema-Cache neu laden (Spaltenrechte prüft Postgres sofort, Embedding-Metadaten sind gecacht)
NOTIFY pgrst, 'reload schema';

-- Prüfung danach (im SQL-Editor):
--   SELECT grantee, string_agg(column_name, ', ' ORDER BY column_name)
--   FROM information_schema.column_privileges
--   WHERE table_name = 'listings' AND privilege_type = 'SELECT' AND grantee IN ('anon', 'authenticated')
--   GROUP BY grantee;
-- Erwartung: weder cleaning_token noch locks, guide, google_api_key tauchen auf.
-- Empfehlung: google_api_key prüfen (SELECT id, google_api_key IS NOT NULL FROM listings) und ggf. leeren/rotieren —
-- die Spalte wird im Code nirgends gelesen, war aber bisher öffentlich abrufbar.

-- ⚖️ Audit 14.10.2026 (UWG Anhang Nr. 23b, § 5b Abs. 3 UWG): Das Siegel „✓ Verifizierter Aufenthalt" stand auch an
-- Google-Rezensionen, obwohl Google keinen Aufenthalt prüft. Import (lib/reviews-sync.ts) setzt verified jetzt nur noch
-- für Airbnb/Booking/FeWo-direkt (dort können nur Gäste nach einem Aufenthalt bewerten); Bestand nachziehen:
UPDATE public.reviews SET verified = false WHERE source = 'google' AND verified = true;
-- Kontrolle: SELECT source, verified, count(*) FROM reviews GROUP BY 1, 2 ORDER BY 1, 2;

-- KI-Zusammenfassung der Gästebewertungen ("Das sagen unsere Gäste" auf der
-- Listing-Detailseite). Erzeugt server-seitig beim Review-Sync (Button im
-- ListingEditor bzw. täglicher Cron) aus den importierten Review-Texten.
alter table public.listings
  add column if not exists guest_summary text,
  add column if not exists guest_summary_updated_at timestamptz;

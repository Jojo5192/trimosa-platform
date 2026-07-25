-- §204: Auto-Nachrichten für MEHRERE Wohnungen (bisher: alle ODER genau eine)
-- listing_ids (jsonb-Array von listing-UUIDs) ergänzt listing_id;
-- null/leer = alle Wohnungen. Bestehende Einzel-Zuordnungen werden übernommen.
alter table public.auto_messages add column if not exists listing_ids jsonb;

update public.auto_messages
   set listing_ids = jsonb_build_array(listing_id)
 where listing_id is not null
   and listing_ids is null;

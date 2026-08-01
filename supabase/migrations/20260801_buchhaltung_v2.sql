-- 💶 BUCHHALTUNG v2 (§242): Vollbild-Oberfläche /buchhaltung.
-- Vom Inhaber im Supabase-SQL-Editor ausführen.

-- Interne Wohnungs-Zuordnung je Beleg (NUR App-Auswertung — sevdesk kennt
-- pro Beleg genau EINE Kostenstelle = Standort, §240-Doktrin):
-- { modus: 'allgemein'|'standort'|'wohnung'|'split', standort?, listingIds? }
alter table public.beleg_inbox
  add column if not exists zuordnung jsonb;

-- Verknüpfung Protokollzeile ↔ sevdesk-Beleg (für Beleg-Viewer + Zuordnung
-- der direkt nach sevdesk gelaufenen Belege)
alter table public.beleg_inbox
  add column if not exists sevdesk_voucher_id text;

create index if not exists beleg_inbox_voucher_idx
  on public.beleg_inbox (sevdesk_voucher_id);

-- Push-Kategorie „Buchhaltung" (nur Admins bekommen diese Pushes überhaupt;
-- hiermit zusätzlich je Nutzer abschaltbar)
alter table public.profiles
  add column if not exists push_buchhaltung boolean not null default true;

-- §271: Belege der TRIMOSA Immobilien UG aus der Beleg-Inbox nach
-- BuchhaltungsButler buchen (Upload + Zahlungs-Zuordnung + Buchung mit
-- Kostenstelle). firma unterscheidet die "Andere Gesellschaft"-Entscheidung
-- (ug = BB-Pipeline, gbr = nur Archiv); bb_* trägt den Sync-Zustand.
alter table public.beleg_inbox add column if not exists firma text;
alter table public.beleg_inbox add column if not exists bb_status text;
alter table public.beleg_inbox add column if not exists bb_receipt_id text;
-- Zahlungen, denen der Beleg in BB bereits ZUGEORDNET wurde (CSV) — wird je
-- Transaktion SOFORT persistiert (Review §271: Teilfehler-Retry darf nie
-- doppelt zuordnen/buchen)
alter table public.beleg_inbox add column if not exists bb_transaction_ids text;
-- Zahlungen, zu denen die BUCHUNG (Posting) bereits angelegt wurde (CSV)
alter table public.beleg_inbox add column if not exists bb_posted_ids text;
-- final gewählte BB-Kostenstelle (KI liest sie aus dem Beleg — Liefer-/
-- Leistungsadresse/Objektname gegen die vorhandenen BB-Kostenstellen;
-- Fallback = Standard-Kostenstelle aus den Settings)
alter table public.beleg_inbox add column if not exists bb_kostenstelle text;
alter table public.beleg_inbox add column if not exists bb_detail text;
-- Sonderfaelle: abweichende(r) Zahlbetraege (Globus-Anzahlung verrechnet,
-- Endres in 2 Tranchen) als Array [25000.00, 9123.48]; null = betrag.
alter table public.beleg_inbox add column if not exists bb_match_betraege jsonb;

create index if not exists beleg_inbox_bb_status_idx
  on public.beleg_inbox (bb_status) where bb_status is not null;

-- Review §271: mail_key war nur indiziert, nicht unique — der
-- select-then-insert-Dedupe (Mail-Scan + Kanzem-Import) braucht die harte
-- Grenze gegen Doppel-Zeilen. (Sollte das Anlegen an Alt-Duplikaten
-- scheitern: Duplikate zuerst bereinigen, dann erneut ausführen.)
create unique index if not exists beleg_inbox_mail_key_uniq
  on public.beleg_inbox (mail_key) where mail_key is not null;

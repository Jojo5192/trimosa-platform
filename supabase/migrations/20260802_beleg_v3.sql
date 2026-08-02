-- 🧾 BUCHHALTUNGSMODUL v3 (§243ad): KI-Analyse VORAB gespeichert +
-- Team-Beleg-Einreichung (Dienstleister/Mitarbeiter laden hoch, sehen nichts).
-- Vom Inhaber im Supabase-SQL-Editor ausführen.

alter table public.beleg_inbox
  add column if not exists ki_analyse jsonb,
  add column if not exists eingereicht_von uuid references public.profiles(id) on delete set null,
  add column if not exists eingereicht_ort text,
  add column if not exists eingereicht_notiz text;

create index if not exists beleg_inbox_voucher_idx on public.beleg_inbox (sevdesk_voucher_id);

-- 🧾 BELEG-INBOX (§238): Belege aus dem Mail-Scan, die NICHT eindeutig der
-- TRIMOSA Apartments & Homes eGbR zuzuordnen sind (die Postfächer dienen
-- DREI Firmen: eGbR + Immobilien UG + GbR) — der Inhaber entscheidet in
-- der App über Gesellschaft + Kostenstelle. Vom Inhaber im
-- Supabase-SQL-Editor ausführen.

create table if not exists public.beleg_inbox (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'mail',
  mail_key text,
  mailbox text,
  from_addr text,
  subject text,
  lieferant text,
  betrag numeric(10,2),
  beleg_datum date,
  belegnummer text,
  ki_hinweis text,
  -- [{ path, name }] im privaten Storage-Bucket 'belege'
  files jsonb not null default '[]'::jsonb,
  -- offen | sevdesk (→ A&H hochgeladen) | andere (andere Gesellschaft) | verworfen
  status text not null default 'offen',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists beleg_inbox_status_idx on public.beleg_inbox (status, created_at desc);
create index if not exists beleg_inbox_mail_key_idx on public.beleg_inbox (mail_key);

alter table public.beleg_inbox enable row level security;

-- 🧾 Lexoffice-Rechnungen (§158): eine Rechnung je Buchung, erstellt um
-- 15:00 am Anreisetag (Cron) bzw. on-demand ab Anreisetag. lexoffice_id
-- null = Erstellung fehlgeschlagen (error enthält den Grund, manueller
-- Retry über die Team-API). RLS deny-all → nur Service-Role.
create table if not exists public.lexoffice_invoices (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings(id) on delete cascade unique,
  lexoffice_id  text,
  voucher_number text,
  amount        numeric,
  status        text not null default 'erstellt',  -- erstellt | fehler
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.lexoffice_invoices enable row level security;

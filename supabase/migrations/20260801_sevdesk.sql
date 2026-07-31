-- 🧾 sevdesk-Migration (§234): Zuordnung Smoobu-Reservierung → sevdesk-
-- Rechnung (Idempotenz + Gast-Download später). Vom Inhaber im
-- Supabase-SQL-Editor ausführen.

create table if not exists public.sevdesk_invoices (
  id uuid primary key default gen_random_uuid(),
  -- Quelle ist SMOOBU (Jahres-Neuaufbau §234) — booking_id nur wenn die
  -- Reservierung auch in unserer bookings-Tabelle liegt
  smoobu_reservation_id bigint not null,
  booking_id uuid references public.bookings(id) on delete set null,
  sevdesk_id text,
  invoice_number text,
  amount numeric(10,2),
  -- 'angelegt' (saveInvoice ok, Rest offen) | 'erstellt' (fertig gebucht) | 'fehler'
  status text not null default 'angelegt',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sevdesk_invoices_smoobu_idx
  on public.sevdesk_invoices (smoobu_reservation_id);

alter table public.sevdesk_invoices enable row level security;

-- 💶 Reinigungs-Rechnungen: hochgeladene Monats-Rechnungen der Reinigungs-
-- kräfte + KI-Abgleich gegen die erwarteten Kosten aus dem Planer.
-- RLS ohne Policies = deny-all; Zugriff nur über Service-Role-APIs
-- (/api/cleaning-invoices, Admins/Gastgeber).

create table if not exists public.cleaning_invoices (
  id uuid primary key default gen_random_uuid(),
  month text not null,                                            -- 'YYYY-MM'
  person_id uuid references public.profiles(id) on delete set null,  -- null = Gesamt-Rechnung
  file_url text not null,
  file_name text,
  amount_expected numeric,                                        -- Prognose zum Prüfzeitpunkt
  amount_invoiced numeric,                                        -- von der KI aus der Rechnung gelesen
  analysis jsonb,                                                 -- {positionen, differenz, einschaetzung, auffaelligkeiten}
  status text not null default 'neu',                             -- neu | geprueft | fehler
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists cleaning_invoices_month_idx
  on public.cleaning_invoices (month);

alter table public.cleaning_invoices enable row level security;

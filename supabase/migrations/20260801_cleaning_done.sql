-- 🧹 Reinigungs-Abschluss vor Ort (§231): NFC-Token je Wohnung +
-- Bestätigungs-Tabelle. Vom Inhaber im Supabase-SQL-Editor ausführen.

alter table public.listings
  add column if not exists cleaning_token uuid not null default gen_random_uuid();

create unique index if not exists listings_cleaning_token_idx
  on public.listings (cleaning_token);

create table if not exists public.cleaning_confirmations (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  -- Reinigungs-Slot = Abreisetag der zugehörigen Buchung
  slot_date date not null,
  confirmed_at timestamptz not null default now(),
  person_id uuid references public.profiles(id) on delete set null,
  person_name text,
  -- 'bestaetigt' (Team-Code heute am Schloss benutzt) | 'unbestaetigt' | 'nicht_pruefbar'
  verify_status text not null default 'nicht_pruefbar',
  source text not null default 'nfc'
);

create unique index if not exists cleaning_confirmations_slot_idx
  on public.cleaning_confirmations (listing_id, slot_date);

-- RLS ohne Policies = deny-all; Zugriff nur über die Service-Role (API)
alter table public.cleaning_confirmations enable row level security;

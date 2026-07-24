-- ☎️ §183: Anruf-Protokolle des KI-Telefon-Assistenten (ElevenLabs Post-Call-
-- Webhook). Basis für Telefonnotizen im Gast-Thread + das Transkript-Lernen
-- (Phase 2b). RLS ohne Policies = deny-all, nur Service-Role.
create table if not exists public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id text unique not null,
  booking_id uuid references public.bookings(id) on delete set null,
  caller_number text,
  summary text,
  transcript text,
  guest_inquiry boolean default false,
  learned_at timestamptz,
  created_at timestamptz default now()
);

alter table public.voice_calls enable row level security;

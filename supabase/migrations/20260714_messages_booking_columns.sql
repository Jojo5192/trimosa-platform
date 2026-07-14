-- Fundament-Fix für die Unified Inbox: Die messages-Tabelle kannte bisher NUR
-- die conversations-Welt (conversation_id/sender_id NOT NULL) — der komplette
-- Buchungs-Chat-Code (booking_id/sender_type, Smoobu-Sync externer Gäste)
-- schrieb ins Leere. Diese Migration ergänzt die Buchungs-Welt:
--   booking_id  → Thread externer Gäste (Airbnb/Booking via Smoobu)
--   sender_type → 'guest' | 'host' | 'system' (externe Gäste haben keine User-ID)

alter table public.messages alter column conversation_id drop not null;
alter table public.messages alter column sender_id drop not null;

alter table public.messages
  add column if not exists booking_id uuid references public.bookings(id) on delete cascade,
  add column if not exists sender_type text;

create index if not exists idx_messages_booking
  on public.messages (booking_id) where booking_id is not null;

-- Jede Nachricht gehört zu genau einer Welt
alter table public.messages drop constraint if exists messages_thread_check;
alter table public.messages add constraint messages_thread_check
  check (conversation_id is not null or booking_id is not null);

-- 📖 Digitale Gästemappe (Phase 1):
--  listings.guide       — Block-Inhalte aus dem Gästemappen-Builder (jsonb)
--  bookings.portal_token — unguessbarer Link-Token je Buchung (/mappe/<token>)
alter table public.listings
  add column if not exists guide jsonb not null default '{}'::jsonb;

alter table public.bookings
  add column if not exists portal_token uuid not null default gen_random_uuid();

update public.bookings set portal_token = gen_random_uuid() where portal_token is null;

create unique index if not exists bookings_portal_token_idx
  on public.bookings (portal_token);

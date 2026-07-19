-- Buchungs-Push-Präferenz (Pascal §99.1): Push bei neuen Buchungen/Anfragen
-- im ⚙️-Tab der Team-App abschaltbar (Chefs sehen den Betrag, Staff nicht).
alter table public.profiles
  add column if not exists push_bookings boolean not null default true;

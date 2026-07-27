-- §221: bookings.total_price war INTEGER -> alle Portal-Preise wurden beim
-- Import auf ganze Euro gerundet (1.086,31 EUR -> 1.086) und landeten so auch
-- auf den Rechnungen. Cent-genau speichern.
alter table public.bookings
  alter column total_price type numeric(10,2) using total_price::numeric(10,2);

-- Separate notification address for host alerts (e.g. fewo@trimosa.de).
-- Booking/request emails fall back to the host's login email when empty.
alter table public.profiles add column if not exists notification_email text;

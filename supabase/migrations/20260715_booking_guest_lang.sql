-- Mehrsprachige Buchungs-Mails: Sprache des Gasts zum Buchungszeitpunkt
-- (uilang-Cookie), damit die Eingangsbestätigung in seiner Sprache rausgeht.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS guest_lang text;

-- §305 Stummschalter für Auto-Nachrichten je Buchung (Pascal, 9. September 2026)
-- msg_mute: NULL = normal · 'alle' = nur noch die Check-out-Anleitung (vor_abreise)
--           · 'bewertung' = keine Danke-/Bewertungs-Nachricht (nach_abreise)
-- msg_mute_reason: 'manuell (<Name>)' oder 'KI: Beschwerde im Chat erkannt (<Datum>)'
-- Idempotent; Code ist deploy-sicher (ohne Spalten → keine Stummschaltung, sonst unverändert).
alter table public.bookings
  add column if not exists msg_mute text,
  add column if not exists msg_mute_reason text;

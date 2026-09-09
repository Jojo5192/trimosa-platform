-- §309 Early-Check-in-Sperre je Buchung (Pascal, 9./10. September 2026)
-- early_checkin_blocked: manuell gesetzt (Gastkarte) → keine „Früher Check-in möglich"-Nachricht.
-- Automatisch gesperrt wird zusätzlich ohne Spalte, wenn am Anreisetag eine offene Aufgabe für die Wohnung
-- eingeplant ist (tasks.due_date = check_in) — siehe lib/early-checkin.ts.
alter table public.bookings
  add column if not exists early_checkin_blocked boolean not null default false,
  add column if not exists early_checkin_block_reason text;

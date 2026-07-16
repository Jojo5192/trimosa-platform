-- Sichtbarkeit PRO AUFGABE: welche Gruppe darf sie (zusätzlich zum
-- Zugewiesenen) einsehen. Default 'admin' = nur Admins/Gastgeber —
-- Admin-Aufgaben sind damit für Mitarbeiter/Dienstleister unsichtbar,
-- außer die Aufgabe ist ihnen direkt zugewiesen.
--   'admin' → nur Admins/Gastgeber
--   'team'  → Admins + Mitarbeiter
--   'alle'  → Admins + Mitarbeiter + Dienstleister

alter table public.tasks
  add column if not exists visibility text not null default 'admin';

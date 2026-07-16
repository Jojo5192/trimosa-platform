-- Generischer Key/Value-Store für App-Einstellungen (Service-Role-only).
-- Erster Nutzer: 'task_permissions' — vom Admin konfigurierbare Aufgaben-Rechte
-- je Rolle (Mitarbeiter/Dienstleister): sehen (alle/eigene) + anlegen/zuteilen.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

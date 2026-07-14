-- Team-Rolle für die Unified Chat-Inbox: Mitarbeiter:innen (z. B. Büro) dürfen
-- alle Gäste-Chats sehen und beantworten, ohne Gastgeber- oder Admin-Rechte.
-- Vergabe über /dashboard/admin (Service-Role); Selbst-Beförderung ist durch
-- den Trigger für ALLE drei Rollen-Flags blockiert.

alter table public.profiles
  add column if not exists is_staff boolean not null default false;

create or replace function prevent_self_admin_promotion()
returns trigger as $$
begin
  if new.is_admin is distinct from old.is_admin and auth.role() <> 'service_role' then
    new.is_admin := old.is_admin;
  end if;
  if new.is_host is distinct from old.is_host and auth.role() <> 'service_role' then
    new.is_host := old.is_host;
  end if;
  if new.is_staff is distinct from old.is_staff and auth.role() <> 'service_role' then
    new.is_staff := old.is_staff;
  end if;
  return new;
end;
$$ language plpgsql security definer;

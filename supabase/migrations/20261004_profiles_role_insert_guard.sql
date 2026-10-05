-- 🔒 Rollen-Flags auch beim ANLEGEN der eigenen Profilzeile schützen (Sicherheits-Fund 4.10.2026,
-- aufgefallen bei der Prüfung der KI-Auto-Antworten: „Modus nur durch is_admin").
--
-- Lücke (aus den Migrationsdateien abgeleitet): Die Policy »profiles_own_write« gilt FOR ALL — ein
-- angemeldeter Nutzer darf die EIGENE Profilzeile also auch einfügen und löschen. Der Schutz
-- trg_prevent_self_admin_promotion greift aber nur BEFORE UPDATE. Wer (noch) keine Profilzeile hat
-- oder die eigene löscht, könnte über die Supabase-REST-API { id: <eigene uid>, is_admin: true }
-- einfügen und sich so zum Admin machen.
--
-- Fix: BEFORE INSERT werden die Rollen-Flags auf false gesetzt, sobald ein angemeldeter Nutzer
-- (auth.uid() gesetzt) einfügt. Die Service-Role (alle Server-Routen über supabaseAdmin, auth.uid()
-- ist dort null) bleibt unberührt und darf Rollen weiterhin setzen.
-- jsonb_populate_record statt direkter Zuweisung: fehlt eine der Spalten in dieser Datenbank noch,
-- wird der Schlüssel einfach ignoriert (kein Laufzeitfehler beim Registrieren).
-- Idempotent.
--
-- VORHER im SQL-Editor prüfen, wer heute Rollen hat (es dürfen nur bekannte Team-Mitglieder sein):
--   select id, display_name, is_admin, is_host, is_staff, is_provider
--     from public.profiles where is_admin or is_host or is_staff or is_provider;

create or replace function public.prevent_self_role_insert()
returns trigger as $$
begin
  if auth.uid() is not null then
    new := jsonb_populate_record(
      new,
      '{"is_admin": false, "is_host": false, "is_staff": false, "is_provider": false}'::jsonb
    );
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_prevent_self_role_insert on public.profiles;
create trigger trg_prevent_self_role_insert
  before insert on public.profiles
  for each row execute function public.prevent_self_role_insert();

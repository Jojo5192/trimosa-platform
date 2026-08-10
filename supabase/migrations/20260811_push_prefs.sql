-- §254: Zentrale Push-Präferenzen als jsonb (erweiterbar ohne weitere Migrationen).
-- Speichert je Kategorie nur die ABWEICHUNG vom Default (true) — d. h. nur
-- explizit ausgeschaltete Kategorien stehen als false drin.
alter table profiles add column if not exists push_prefs jsonb not null default '{}'::jsonb;

-- Bestehende Einzel-Flags (nur die AUS-Zustände) einmalig übernehmen.
update profiles set push_prefs = jsonb_strip_nulls(jsonb_build_object(
  'guestChats',  case when push_guest_chats = false then to_jsonb(false) else null end,
  'teamChats',   case when push_team_chats  = false then to_jsonb(false) else null end,
  'bookings',    case when push_bookings     = false then to_jsonb(false) else null end,
  'buchhaltung', case when push_buchhaltung  = false then to_jsonb(false) else null end
))
where push_prefs = '{}'::jsonb;

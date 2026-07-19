-- 🧹 Reinigungs-Management (Inhaber-Wunsch 19.07.):
-- Verantwortliche Person + durchschnittliche Reinigungsdauer je Wohnung.
alter table public.listings
  add column if not exists cleaning_responsible uuid references public.profiles(id) on delete set null;
alter table public.listings
  add column if not exists cleaning_minutes int;

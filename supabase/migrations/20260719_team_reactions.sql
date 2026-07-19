-- ❤️ iMessage-Tapbacks im internen Team-Chat (Inhaber-Wunsch 19.07.):
-- Reaktionen je Nachricht als { "❤️": [userId, …], "👍": […] }.
alter table public.team_messages
  add column if not exists reactions jsonb not null default '{}'::jsonb;

-- 💬 Antworten auf Nachrichten im Intern-Chat (Dominik, §121.1):
-- reply_to_id verweist auf die zitierte Nachricht (iMessage-Stil).
-- Code ist deploy-sicher (Select/Insert mit Retry ohne die Spalte),
-- Migration trotzdem zeitgleich mit dem Push ausführen.

alter table public.team_messages
  add column if not exists reply_to_id uuid references public.team_messages(id) on delete set null;

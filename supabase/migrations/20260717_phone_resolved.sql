-- „📞 Per Telefonat geklärt": Markierung auf der letzten Gast-Nachricht eines
-- Threads (wie no_reply_needed) — der Thread zählt dann nicht mehr als
-- unbeantwortet; der Wochenbericht weist telefonisch geklärte separat aus.
alter table public.messages
  add column if not exists phone_resolved boolean not null default false;

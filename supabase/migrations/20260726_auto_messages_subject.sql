-- §208: eigener E-Mail-Betreff je Auto-Nachricht (Platzhalter erlaubt);
-- null = bisheriger Standard „Infos zu deinem Aufenthalt — <Wohnung>".
alter table public.auto_messages add column if not exists subject text;

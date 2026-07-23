-- 📨 Auto-Nachrichten (§148-Nachtrag): E-Mail-Schalter je Vorlage.
-- send_email: Website-Gäste bekommen die Nachricht zusätzlich zur
-- Chat-Nachricht als E-Mail (Default AN). AUS = nur Chat. Portal-Gäste
-- unberührt (laufen über Smoobu; E-Mail dort nur als Fallback).
alter table public.auto_messages
  add column if not exists send_email boolean not null default true;

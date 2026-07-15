-- Inbox: "Keine Antwort erforderlich" — Flag auf der jeweils letzten Nachricht
-- eines Threads. Kommt danach eine neue Gast-Nachricht, zählt der Thread
-- automatisch wieder als unbeantwortet (neue letzte Nachricht ohne Flag).
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS no_reply_needed boolean;

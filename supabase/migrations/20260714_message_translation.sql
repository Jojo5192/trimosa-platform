-- Chat-Live-Übersetzung (Etappe 2): Jede Nachricht kennt ihre Ursprungssprache
-- und trägt eine deutsche Fassung fürs Team.
--   lang        → erkannte Sprache des Originals (ISO-639-1, z. B. 'nl')
--   content_de  → deutsche Fassung (null wenn Original bereits deutsch)
-- Eingehende Gast-Nachrichten werden beim ersten Laden einmalig übersetzt
-- (Batch, gecacht); ausgehende Team-Antworten werden vor dem Senden in die
-- Gastsprache übersetzt — content = gesendete Fassung, content_de = Original.

alter table public.messages
  add column if not exists lang text,
  add column if not exists content_de text;

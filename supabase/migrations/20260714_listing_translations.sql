-- Mehrsprachigkeit Phase 1: KI-Übersetzungen der Inseratsinhalte (EN/FR/NL).
-- Struktur: { "en": { "title", "description", "rooms": { "<roomId>": { "name", "description" } },
--                     "src_hash", "updated_at" }, "fr": {...}, "nl": {...} }
-- src_hash = Fingerabdruck der deutschen Quelle → veraltete Übersetzungen erkennbar.
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS translations jsonb;

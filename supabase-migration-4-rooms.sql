-- ══════════════════════════════════════════════════════════════
-- TRIMOSA Migration 4 — Räume (rooms) pro Inserat
-- Run in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- Räume als JSONB Array.
-- Struktur jedes Raums:
-- {
--   "id":          "uuid-string",
--   "name":        "Wohnzimmer",
--   "description": "optional",
--   "features":    ["Schlafcouch", "Smart-TV"],
--   "images":      ["https://...url1", "https://...url2"]
-- }

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS rooms JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ══════════════════════════════════════════════════════════════
-- Buchungsmodus pro Inserat statt pro Gastgeber.
--
-- allow_instant_booking / allow_requests / min_request_nights lagen bisher
-- auf profiles (galten für alle Inserate eines Hosts). Sie ziehen jetzt auf
-- listings um, damit jedes Inserat eigen konfigurierbar ist. Die
-- profiles-Spalten bleiben als "Standard für neue Inserate" bestehen.
--
-- Bestehende Inserate werden mit den bisherigen Host-Werten vorbelegt, damit
-- sich das Verhalten für sie nicht ändert.
-- Run in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS allow_instant_booking BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_requests        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS min_request_nights    INTEGER NOT NULL DEFAULT 1;

-- Bestehende Inserate mit den aktuellen Host-Einstellungen vorbelegen.
UPDATE listings l
SET allow_instant_booking = COALESCE(p.allow_instant_booking, true),
    allow_requests        = COALESCE(p.allow_requests, true),
    min_request_nights    = COALESCE(p.min_request_nights, 1)
FROM profiles p
WHERE p.id = l.host_id;

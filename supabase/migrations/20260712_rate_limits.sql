-- ══════════════════════════════════════════════════════════════
-- Backing table for lib/rate-limit.ts — throttles anonymous/low-friction
-- write endpoints (e.g. registration) against automated abuse. Only ever
-- accessed via the service-role client; RLS is enabled with no policies
-- so it's deny-all for the anon/authenticated keys as defense in depth.
-- Run in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS rate_limits (
  key          text PRIMARY KEY,
  count        integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

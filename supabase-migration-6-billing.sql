-- ══════════════════════════════════════════════════════════════
-- Migration 6: Host Billing Info
-- Run in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- Add billing columns to profiles table
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS billing_name       TEXT,        -- Rechnungsempfänger / Firmenname
  ADD COLUMN IF NOT EXISTS billing_address    TEXT,        -- Straße + Hausnummer
  ADD COLUMN IF NOT EXISTS billing_city       TEXT,        -- Stadt
  ADD COLUMN IF NOT EXISTS billing_zip        TEXT,        -- PLZ
  ADD COLUMN IF NOT EXISTS billing_country    TEXT DEFAULT 'Deutschland',
  ADD COLUMN IF NOT EXISTS billing_tax_id     TEXT,        -- USt-ID oder Steuer-Nr.
  ADD COLUMN IF NOT EXISTS iban               TEXT,        -- IBAN
  ADD COLUMN IF NOT EXISTS bic                TEXT,        -- BIC
  ADD COLUMN IF NOT EXISTS account_holder     TEXT,        -- Kontoinhaber
  ADD COLUMN IF NOT EXISTS onboarding_step    INT DEFAULT 0; -- wie weit ist der Host beim Setup

-- RLS: hosts can only read/update their own profile
-- (policies should already exist from earlier migration)

-- Migration 11: New fields for detail page redesign
-- Run in Supabase SQL Editor

-- Floor plan image URL
ALTER TABLE listings ADD COLUMN IF NOT EXISTS floor_plan_url TEXT;

-- Detailed house rules (rich text / multiline)
ALTER TABLE listings ADD COLUMN IF NOT EXISTS house_rules_details TEXT;

-- Check-in instructions (rich text / multiline)
ALTER TABLE listings ADD COLUMN IF NOT EXISTS checkin_instructions TEXT;

-- Important notes / hints for guests
ALTER TABLE listings ADD COLUMN IF NOT EXISTS important_notes TEXT;

-- City extracted from address (for display without full address)
ALTER TABLE listings ADD COLUMN IF NOT EXISTS city TEXT;

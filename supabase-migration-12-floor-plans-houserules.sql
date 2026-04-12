-- Migration 12: Multiple floor plans + structured house rules
-- Run in Supabase SQL Editor

-- Convert single floor_plan_url to array for multiple floor plans
ALTER TABLE listings ADD COLUMN IF NOT EXISTS floor_plan_urls TEXT[] DEFAULT '{}';
-- Migrate existing data if any
UPDATE listings SET floor_plan_urls = ARRAY[floor_plan_url] WHERE floor_plan_url IS NOT NULL AND floor_plan_url != '' AND (floor_plan_urls IS NULL OR floor_plan_urls = '{}');

-- Structured house rules (Airbnb-style toggle fields)
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rule_pets_allowed BOOLEAN DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rule_events_allowed BOOLEAN DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rule_smoking_allowed BOOLEAN DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rule_quiet_hours BOOLEAN DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rule_quiet_start TEXT DEFAULT '22:00';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rule_quiet_end TEXT DEFAULT '07:00';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rule_commercial_photo BOOLEAN DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rule_max_guests INTEGER;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rule_additional_rules TEXT;

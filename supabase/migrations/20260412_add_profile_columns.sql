-- Add optional profile columns that may be missing from older DB schemas
-- Safe to run multiple times (uses IF NOT EXISTS)

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS account_type  text  DEFAULT 'person',
  ADD COLUMN IF NOT EXISTS company_name  text,
  ADD COLUMN IF NOT EXISTS vat_id        text;

-- Back-fill: set account_type = 'person' for any existing rows that have NULL
UPDATE profiles
  SET account_type = 'person'
  WHERE account_type IS NULL;

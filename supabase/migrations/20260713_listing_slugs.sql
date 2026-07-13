-- Speaking URLs: each listing gets a stable slug derived from its title.
-- Old UUID links keep working via a 301 redirect in the app.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS slug text;

-- Generate slugs from titles (lowercase, umlauts transliterated, non-alnum → "-")
UPDATE listings SET slug = trim(both '-' from
  regexp_replace(
    replace(replace(replace(replace(lower(title), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'),
    '[^a-z0-9]+', '-', 'g'))
WHERE slug IS NULL OR slug = '';

-- Deduplicate collisions by appending a short id fragment
WITH d AS (
  SELECT id, row_number() OVER (PARTITION BY slug ORDER BY created_at) AS rn
  FROM listings
)
UPDATE listings l SET slug = l.slug || '-' || left(l.id::text, 4)
FROM d WHERE d.id = l.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS listings_slug_key ON listings (slug);

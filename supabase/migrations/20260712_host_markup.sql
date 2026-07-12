-- Per-host price markup: each host sets one markup that applies to all their
-- listings, replacing the single platform-wide markup. Seeded from the old
-- platform value so prices don't change on rollout.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS markup_pct numeric(5,2) NOT NULL DEFAULT 0;

UPDATE profiles
SET markup_pct = COALESCE((SELECT platform_markup_pct FROM platform_settings WHERE id = 1), 0)
WHERE is_host = true;

-- markup_pct is written only via the authenticated /api/settings route (service
-- role); it is not a self-promotion-style privilege, so no extra RLS is needed
-- beyond the existing profile policies. platform_settings stays in place but is
-- no longer read for pricing.

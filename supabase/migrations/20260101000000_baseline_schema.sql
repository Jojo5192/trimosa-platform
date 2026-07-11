-- ══════════════════════════════════════════════════════════════
-- TRIMOSA — Baseline schema
--
-- Consolidated from the live production database (project ferienplattform,
-- introspected via information_schema/pg_catalog on 2026-07-12), replacing
-- the previously scattered supabase-migration-*.sql files in the repo root
-- and the old supabase/migrations/ files. This is the single source of
-- truth going forward — a fresh Supabase project can be brought to the
-- current schema by running this file alone. Written idempotently
-- (IF NOT EXISTS / DROP ... IF EXISTS) so it's also safe to re-run against
-- the already-provisioned production database.
--
-- Later migrations (dated after this file) are incremental changes on top
-- of this baseline — do not fold them back in here; add a new file instead.
-- ══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── profiles ─────────────────────────────────────────────────
-- One row per auth.users id. Holds host- and guest-facing profile data,
-- host billing/payout details, host Smoobu credentials, and per-user
-- notification/booking preferences. id is not admin-writable through
-- any app route.

CREATE TABLE IF NOT EXISTS profiles (
  id                              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name                    text NOT NULL DEFAULT '',
  bio                              text NOT NULL DEFAULT '',
  avatar_url                       text,
  languages                        text[] DEFAULT '{}',
  location                         text DEFAULT '',
  response_time                    text DEFAULT '',
  member_since                     date DEFAULT CURRENT_DATE,
  updated_at                       timestamptz DEFAULT now(),
  billing_name                     text,
  billing_address                  text,
  billing_city                     text,
  billing_zip                      text,
  billing_country                  text DEFAULT 'Deutschland',
  billing_tax_id                   text,
  iban                             text,
  bic                              text,
  account_holder                   text,
  onboarding_step                  integer DEFAULT 0,
  default_cancellation_policy      text DEFAULT 'moderat',
  notif_new_booking                boolean DEFAULT true,
  notif_booking_cancelled          boolean DEFAULT true,
  notif_new_message                boolean DEFAULT true,
  notif_payment_received           boolean DEFAULT true,
  notif_monthly_invoice            boolean DEFAULT true,
  allow_instant_booking            boolean DEFAULT true,
  allow_requests                   boolean DEFAULT true,
  min_request_nights               integer DEFAULT 1,
  guest_notif_booking_confirmed    boolean DEFAULT true,
  guest_notif_booking_cancelled    boolean DEFAULT true,
  guest_notif_new_message          boolean DEFAULT true,
  guest_notif_payment              boolean DEFAULT true,
  guest_first_name                 text,
  guest_last_name                  text,
  guest_street                     text,
  guest_city                       text,
  guest_zip                        text,
  guest_country                    text DEFAULT 'Deutschland',
  smoobu_api_key                   text,
  smoobu_channel_id                bigint,
  account_type                     text DEFAULT 'person',
  company_name                     text,
  vat_id                           text,
  phone                            text,
  is_admin                         boolean NOT NULL DEFAULT false
);

-- ── listings ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS listings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at              timestamptz DEFAULT timezone('utc', now()),
  title                   text NOT NULL,
  description             text,
  location                text NOT NULL,
  price_per_night         integer NOT NULL,
  max_guests              integer NOT NULL,
  bedrooms                integer NOT NULL,
  images                  text[],
  host_id                 uuid REFERENCES auth.users(id),
  is_active               boolean DEFAULT true,
  smoobu_id               text,
  bathrooms               smallint DEFAULT 1,
  amenities               text[] DEFAULT '{}',
  address                 text DEFAULT '',
  latitude                numeric(9,6),
  longitude               numeric(9,6),
  house_rules             text DEFAULT '',
  check_in_time           text DEFAULT '15:00',
  check_out_time          text DEFAULT '11:00',
  min_stay                smallint DEFAULT 1,
  rooms                   jsonb NOT NULL DEFAULT '[]',
  cancellation_policy     text DEFAULT 'moderat',
  cancel_free_days        integer,
  cancel_free_percent     integer,
  cancel_partial_days     integer,
  cancel_partial_percent  integer,
  floor_plan_url          text,
  house_rules_details     text,
  checkin_instructions    text,
  important_notes         text,
  city                    text,
  floor_plan_urls         text[] DEFAULT '{}',
  rule_pets_allowed       boolean DEFAULT false,
  rule_events_allowed     boolean DEFAULT false,
  rule_smoking_allowed    boolean DEFAULT false,
  rule_quiet_hours        boolean DEFAULT false,
  rule_quiet_start        text DEFAULT '22:00',
  rule_quiet_end          text DEFAULT '07:00',
  rule_commercial_photo   boolean DEFAULT false,
  rule_max_guests         integer,
  rule_additional_rules   text,
  floor_plan_labels       text[] DEFAULT '{}',
  airbnb_url              text,
  booking_url             text,
  vrbo_url                text,
  google_place_id         text,
  google_api_key          text,
  revyoos_property_id     text,
  airbnb_score            numeric,
  airbnb_review_count     integer,
  booking_score           numeric,
  booking_review_count    integer,
  google_score            numeric,
  google_review_count     integer
);

-- ── bookings ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bookings (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                    timestamptz DEFAULT timezone('utc', now()),
  listing_id                    uuid REFERENCES listings(id),
  guest_id                      uuid REFERENCES auth.users(id),
  check_in                      date NOT NULL,
  check_out                     date NOT NULL,
  total_price                   integer NOT NULL,
  status                        text DEFAULT 'pending',   -- pending | confirmed | cancelled
  smoobu_reservation_id         bigint,
  channel                       text DEFAULT 'direct',
  source                        text DEFAULT 'trimosa',   -- trimosa | smoobu_webhook
  adults                        smallint DEFAULT 1,
  children                      smallint DEFAULT 0,
  message                       text DEFAULT '',
  guest_name                    text,
  guest_email                   text,
  booking_type                  text DEFAULT 'request',   -- request | instant
  guest_price_suggestion        numeric,
  guest_note                    text,
  stripe_payment_intent_id      text,
  stripe_checkout_session_id    text,
  payment_status                text DEFAULT 'unpaid',    -- unpaid | pending | paid
  paid_at                       timestamptz,
  refunded_at                   timestamptz,
  stripe_refund_id              text
);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_smoobu_reservation_id_idx
  ON bookings (smoobu_reservation_id) WHERE smoobu_reservation_id IS NOT NULL;

-- DB-level guard against overlapping confirmed stays for the same listing,
-- independent of the application-level availability check.
DO $$ BEGIN
  ALTER TABLE bookings
    ADD CONSTRAINT bookings_no_overlapping_confirmed
    EXCLUDE USING gist (
      listing_id WITH =,
      daterange(check_in, check_out, '[)') WITH &&
    )
    WHERE (status = 'confirmed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── conversations ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        uuid REFERENCES listings(id) ON DELETE SET NULL,
  booking_id        uuid REFERENCES bookings(id) ON DELETE SET NULL,
  guest_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  host_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_name        text,
  listing_title     text,
  last_message_at   timestamptz DEFAULT now(),
  created_at        timestamptz DEFAULT now(),
  host_name         text
);

-- ── messages ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content             text NOT NULL,
  read_at             timestamptz,
  created_at          timestamptz DEFAULT now(),
  smoobu_message_id   text
);

CREATE UNIQUE INDEX IF NOT EXISTS messages_smoobu_message_id_idx
  ON messages (smoobu_message_id) WHERE smoobu_message_id IS NOT NULL;

-- ── reviews ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id          uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  source              text NOT NULL DEFAULT 'trimosa',  -- trimosa | airbnb | booking | google | vrbo
  source_review_id    text,
  author_name         text NOT NULL,
  author_avatar       text,
  rating              numeric(2,1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text         text,
  language             text DEFAULT 'de',
  review_date          date NOT NULL,
  verified             boolean DEFAULT false,
  booking_id           uuid,
  guest_id             uuid,
  created_at           timestamptz DEFAULT now(),
  UNIQUE (listing_id, source, source_review_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_listing ON reviews (listing_id);
CREATE INDEX IF NOT EXISTS idx_reviews_source ON reviews (listing_id, source);
CREATE INDEX IF NOT EXISTS idx_reviews_date ON reviews (listing_id, review_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_booking_idx
  ON reviews (booking_id) WHERE source = 'trimosa';

-- ── platform_settings ────────────────────────────────────────
-- Single-row table (id always 1) for the platform-wide price markup.

CREATE TABLE IF NOT EXISTS platform_settings (
  id                    integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  platform_markup_pct   numeric(5,2) NOT NULL DEFAULT 0,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (id, platform_markup_pct)
VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════
-- Functions & triggers
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- is_admin can only be changed via the service-role client (server routes
-- using supabaseAdmin) — this trigger blocks it on any other path,
-- including a user's own profile update.
CREATE OR REPLACE FUNCTION prevent_self_admin_promotion()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin AND auth.role() <> 'service_role' THEN
    NEW.is_admin := OLD.is_admin;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS profiles_prevent_self_admin_promotion ON profiles;
CREATE TRIGGER profiles_prevent_self_admin_promotion
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_self_admin_promotion();

-- ══════════════════════════════════════════════════════════════
-- Row Level Security
-- ══════════════════════════════════════════════════════════════

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- profiles: owner-only. No public read — every server-side display of
-- another user's profile goes through the service-role client anyway.
DROP POLICY IF EXISTS "profiles_own_write" ON profiles;
CREATE POLICY "profiles_own_write" ON profiles FOR ALL
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- listings: public read, host manages own
DROP POLICY IF EXISTS "listings_public_read" ON listings;
CREATE POLICY "listings_public_read" ON listings FOR SELECT USING (true);
DROP POLICY IF EXISTS "listings_host_insert" ON listings;
CREATE POLICY "listings_host_insert" ON listings FOR INSERT TO authenticated
  WITH CHECK (host_id = auth.uid());
DROP POLICY IF EXISTS "listings_host_update" ON listings;
CREATE POLICY "listings_host_update" ON listings FOR UPDATE
  USING (host_id = auth.uid()) WITH CHECK (host_id = auth.uid());
DROP POLICY IF EXISTS "listings_host_delete" ON listings;
CREATE POLICY "listings_host_delete" ON listings FOR DELETE
  USING (host_id = auth.uid());

-- bookings: guest sees/creates own, host sees/updates bookings on own listings
DROP POLICY IF EXISTS "bookings_guest_read" ON bookings;
CREATE POLICY "bookings_guest_read" ON bookings FOR SELECT
  USING (guest_id = auth.uid());
DROP POLICY IF EXISTS "bookings_host_read" ON bookings;
CREATE POLICY "bookings_host_read" ON bookings FOR SELECT
  USING (listing_id IN (SELECT id FROM listings WHERE host_id = auth.uid()));
DROP POLICY IF EXISTS "bookings_guest_insert" ON bookings;
CREATE POLICY "bookings_guest_insert" ON bookings FOR INSERT TO authenticated
  WITH CHECK (guest_id = auth.uid());
DROP POLICY IF EXISTS "bookings_host_update" ON bookings;
CREATE POLICY "bookings_host_update" ON bookings FOR UPDATE
  USING (listing_id IN (SELECT id FROM listings WHERE host_id = auth.uid()));

-- conversations: only the two participants
DROP POLICY IF EXISTS "authenticated can create conversation" ON conversations;
CREATE POLICY "authenticated can create conversation" ON conversations FOR INSERT
  WITH CHECK (auth.uid() = guest_id);
DROP POLICY IF EXISTS "members can view conversation" ON conversations;
CREATE POLICY "members can view conversation" ON conversations FOR SELECT
  USING (auth.uid() = host_id OR auth.uid() = guest_id);
DROP POLICY IF EXISTS "members can update conversation" ON conversations;
CREATE POLICY "members can update conversation" ON conversations FOR UPDATE
  USING (auth.uid() = host_id OR auth.uid() = guest_id);

-- messages: only members of the parent conversation
DROP POLICY IF EXISTS "members can view messages" ON messages;
CREATE POLICY "members can view messages" ON messages FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND (c.host_id = auth.uid() OR c.guest_id = auth.uid())
  ));
DROP POLICY IF EXISTS "members can send messages" ON messages;
CREATE POLICY "members can send messages" ON messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND (c.host_id = auth.uid() OR c.guest_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS "members can mark messages read" ON messages;
CREATE POLICY "members can mark messages read" ON messages FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = messages.conversation_id
      AND (c.host_id = auth.uid() OR c.guest_id = auth.uid())
  ));

-- reviews: public read; hosts import for own listings; guests review own
-- completed, confirmed stay only (booking must belong to the same listing).
DROP POLICY IF EXISTS reviews_select ON reviews;
CREATE POLICY reviews_select ON reviews FOR SELECT USING (true);
DROP POLICY IF EXISTS reviews_insert_host ON reviews;
CREATE POLICY reviews_insert_host ON reviews FOR INSERT
  WITH CHECK (listing_id IN (SELECT id FROM listings WHERE host_id = auth.uid()));
DROP POLICY IF EXISTS reviews_insert_guest ON reviews;
CREATE POLICY reviews_insert_guest ON reviews FOR INSERT
  WITH CHECK (
    source = 'trimosa'
    AND guest_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = reviews.booking_id
        AND b.guest_id = auth.uid()
        AND b.listing_id = reviews.listing_id
        AND b.status = 'confirmed'
        AND b.check_out < CURRENT_DATE
    )
  );
DROP POLICY IF EXISTS reviews_update_host ON reviews;
CREATE POLICY reviews_update_host ON reviews FOR UPDATE
  USING (
    listing_id IN (SELECT id FROM listings WHERE host_id = auth.uid())
    AND source <> 'trimosa'
  );
DROP POLICY IF EXISTS reviews_delete_host ON reviews;
CREATE POLICY reviews_delete_host ON reviews FOR DELETE
  USING (
    listing_id IN (SELECT id FROM listings WHERE host_id = auth.uid())
    AND source <> 'trimosa'
  );

-- platform_settings: public read only (needed for the availability API).
-- Writes only ever go through the service-role client from an
-- admin-gated route (see app/api/settings/route.ts) — no client-writable
-- UPDATE policy exists on purpose.
DROP POLICY IF EXISTS "settings_public_read" ON platform_settings;
CREATE POLICY "settings_public_read" ON platform_settings FOR SELECT USING (true);

-- ══════════════════════════════════════════════════════════════
-- Storage: listing-images bucket
-- ══════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('listing-images', 'listing-images', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 10485760,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "listing_images_public_read" ON storage.objects;
CREATE POLICY "listing_images_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'listing-images');

-- Listing photo uploads go through a server-side, ownership-checked route
-- using the service-role client (bypasses RLS). The only client-side
-- (browser-key) write path is the avatar uploader, always targeting
-- avatars/<own-uid>.*.
DROP POLICY IF EXISTS "listing_images_own_avatar_upload" ON storage.objects;
CREATE POLICY "listing_images_own_avatar_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'listing-images' AND name LIKE 'avatars/' || auth.uid()::text || '.%');
DROP POLICY IF EXISTS "listing_images_own_avatar_update" ON storage.objects;
CREATE POLICY "listing_images_own_avatar_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'listing-images' AND name LIKE 'avatars/' || auth.uid()::text || '.%');
DROP POLICY IF EXISTS "listing_images_own_avatar_delete" ON storage.objects;
CREATE POLICY "listing_images_own_avatar_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'listing-images' AND name LIKE 'avatars/' || auth.uid()::text || '.%');

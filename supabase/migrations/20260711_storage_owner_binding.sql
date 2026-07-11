-- ══════════════════════════════════════════════════════════════
-- Binds client-side storage writes to the current user's own avatar file.
--
-- Listing photo uploads always go through a server-side route
-- (app/api/listings/[id]/upload/route.ts) that checks listing ownership
-- and uses the service-role client, which bypasses RLS regardless. The
-- only write path that goes through the browser client (and is therefore
-- subject to RLS) is the avatar uploader in components/AvatarCropper.tsx,
-- which always targets avatars/<own-uid>.*.
-- Run in Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "listing_images_auth_upload" ON storage.objects;
DROP POLICY IF EXISTS "listing_images_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "listing_images_auth_delete" ON storage.objects;

CREATE POLICY "listing_images_own_avatar_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'listing-images'
    AND name LIKE 'avatars/' || auth.uid()::text || '.%'
  );

CREATE POLICY "listing_images_own_avatar_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'listing-images'
    AND name LIKE 'avatars/' || auth.uid()::text || '.%'
  );

CREATE POLICY "listing_images_own_avatar_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'listing-images'
    AND name LIKE 'avatars/' || auth.uid()::text || '.%'
  );

-- listing_images_public_read (SELECT, bucket_id = 'listing-images') bleibt
-- unverändert — der Bucket ist bewusst öffentlich lesbar.

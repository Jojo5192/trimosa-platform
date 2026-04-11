-- Migration 7: Cancellation policies, notifications, chat, delete listings

-- Cancellation policy per listing
ALTER TABLE listings ADD COLUMN IF NOT EXISTS cancellation_policy TEXT DEFAULT 'moderat';

-- Default cancellation policy per host (in profiles)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS default_cancellation_policy TEXT DEFAULT 'moderat',
  ADD COLUMN IF NOT EXISTS notif_new_booking     BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notif_booking_cancelled BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notif_new_message     BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notif_payment_received BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notif_monthly_invoice  BOOLEAN DEFAULT TRUE;

-- Conversations (one thread per guest per listing)
CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      UUID REFERENCES listings(id) ON DELETE SET NULL,
  booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,
  guest_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  host_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guest_name      TEXT,
  listing_title   TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content         TEXT NOT NULL,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- RLS conversations
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view conversation" ON conversations
  FOR SELECT USING (auth.uid() = host_id OR auth.uid() = guest_id);

CREATE POLICY "authenticated can create conversation" ON conversations
  FOR INSERT WITH CHECK (auth.uid() = guest_id);

CREATE POLICY "members can update conversation" ON conversations
  FOR UPDATE USING (auth.uid() = host_id OR auth.uid() = guest_id);

-- RLS messages
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view messages" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id
        AND (c.host_id = auth.uid() OR c.guest_id = auth.uid())
    )
  );

CREATE POLICY "members can send messages" ON messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id
        AND (c.host_id = auth.uid() OR c.guest_id = auth.uid())
    )
  );

CREATE POLICY "members can mark messages read" ON messages
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id
        AND (c.host_id = auth.uid() OR c.guest_id = auth.uid())
    )
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;

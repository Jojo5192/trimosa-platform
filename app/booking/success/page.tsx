import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { stripe } from '@/lib/stripe'
import { createReservation, sendMessageToGuest } from '@/lib/smoobu'
import Link from 'next/link'

export default async function BookingSuccessPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const params = await searchParams
  const sessionId = params.session_id

  let booking: Record<string, unknown> | null = null
  let listing: { title: string; location: string; smoobu_id: string | null; host_id: string; cancellation_policy: string | null } | null = null
  let conversationId: string | null = null
  let smoobuError: string | null = null

  if (sessionId) {
    try {
      // ── Ask Stripe directly — this is the source of truth ────────────
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      const bookingId = session.metadata?.bookingId
      const bookingType = session.metadata?.bookingType ?? 'request'
      const stripePaid = (session as unknown as { payment_status: string }).payment_status === 'paid'

      console.log('[SuccessPage] Stripe session:', {
        id: sessionId,
        bookingId,
        bookingType,
        stripePaid,
      })

      if (bookingId && stripePaid) {
        // Load booking + listing
        const { data } = await supabaseAdmin
          .from('bookings')
          .select('*, listings(title, location, smoobu_id, host_id, cancellation_policy)')
          .eq('id', bookingId)
          .maybeSingle()

        if (data) {
          booking = data
          const l = data.listings as { title: string; location: string; smoobu_id: string | null; host_id: string; cancellation_policy: string | null } | null
          listing = l

          // ─── Ensure DB is up to date (webhook might not have fired) ──
          const needsDbUpdate =
            data.payment_status !== 'paid' ||
            (bookingType === 'instant' && data.status !== 'confirmed')

          if (needsDbUpdate) {
            console.log('[SuccessPage] Updating DB: payment_status=paid', bookingType === 'instant' ? ', status=confirmed' : '')
            await supabaseAdmin
              .from('bookings')
              .update({
                payment_status: 'paid',
                paid_at: data.paid_at ?? new Date().toISOString(),
                stripe_payment_intent_id: data.stripe_payment_intent_id
                  ?? (session as unknown as { payment_intent?: string }).payment_intent
                  ?? null,
                ...(bookingType === 'instant' ? { status: 'confirmed' } : {}),
              })
              .eq('id', bookingId)
          }

          // ─── Push to Smoobu for instant bookings (if webhook hasn't done it yet) ───
          const shouldPushToSmoobu = bookingType === 'instant' && l?.smoobu_id && !data.smoobu_reservation_id
          console.log('[SuccessPage] Smoobu push check:', {
            bookingType,
            smoobuId: l?.smoobu_id ?? null,
            existingReservationId: data.smoobu_reservation_id ?? null,
            shouldPush: shouldPushToSmoobu,
          })

          if (shouldPushToSmoobu && l?.smoobu_id) {
            try {
              // Load host's Smoobu credentials (per-host support)
              const { data: hostSmoobu } = await supabaseAdmin
                .from('profiles')
                .select('smoobu_api_key, smoobu_channel_id')
                .eq('id', l.host_id)
                .maybeSingle()
              const hostApiKey = (hostSmoobu as Record<string, unknown> | null)?.smoobu_api_key as string | undefined
              const hostChannelId = (hostSmoobu as Record<string, unknown> | null)?.smoobu_channel_id as number | undefined

              const supabase = await createSupabaseServerClient()
              const { data: { user } } = await supabase.auth.getUser()
              const guestId = user?.id ?? data.guest_id as string

              const countryNameToCode: Record<string, string> = {
                'deutschland': 'DE', 'germany': 'DE',
                'österreich': 'AT', 'austria': 'AT',
                'schweiz': 'CH', 'switzerland': 'CH',
                'frankreich': 'FR', 'france': 'FR',
                'niederlande': 'NL', 'netherlands': 'NL',
                'belgien': 'BE', 'belgium': 'BE',
                'luxemburg': 'LU', 'luxembourg': 'LU',
                'italien': 'IT', 'italy': 'IT',
                'spanien': 'ES', 'spain': 'ES',
                'vereinigtes königreich': 'GB', 'united kingdom': 'GB', 'uk': 'GB',
                'usa': 'US', 'united states': 'US',
                'polen': 'PL', 'poland': 'PL',
                'tschechien': 'CZ', 'czech republic': 'CZ',
                'ungarn': 'HU', 'hungary': 'HU',
                'kroatien': 'HR', 'croatia': 'HR',
              }
              function resolveCountryCode(val: string): string {
                if (!val) return 'DE'
                if (val.length === 2) return val.toUpperCase()
                return countryNameToCode[val.toLowerCase()] ?? 'DE'
              }

              // Always fetch fresh guest profile from DB
              let guestProfile: Record<string, unknown> | null = null
              {
                const { data: gp1, error: gpErr1 } = await supabaseAdmin
                  .from('profiles')
                  .select('guest_first_name, guest_last_name, company_name, account_type, display_name, phone, guest_street, guest_zip, guest_city, guest_country')
                  .eq('id', guestId)
                  .maybeSingle()
                if (gpErr1) {
                  console.error('[SuccessPage] Full profile select failed:', gpErr1.message, '– retrying minimal')
                  const { data: gp2, error: gpErr2 } = await supabaseAdmin
                    .from('profiles')
                    .select('guest_first_name, guest_last_name, display_name, phone, guest_street, guest_zip, guest_city, guest_country')
                    .eq('id', guestId)
                    .maybeSingle()
                  if (gpErr2) console.error('[SuccessPage] Minimal profile select failed:', gpErr2.message)
                  else guestProfile = gp2 as Record<string, unknown> | null
                } else {
                  guestProfile = gp1 as Record<string, unknown> | null
                }
              }
              console.log('[SuccessPage] Guest profile:', JSON.stringify(guestProfile))

              // Guest email
              const guestAuthData = await supabaseAdmin.auth.admin.getUserById(guestId)
              const email = guestAuthData.data.user?.email ?? user?.email ?? ''

              const isBiz = guestProfile?.account_type === 'business'
              const nameParts = ((guestProfile?.display_name as string) || '').split(' ')

              let firstName = isBiz
                ? ((guestProfile?.company_name as string) || (guestProfile?.display_name as string) || '')
                : ((guestProfile?.guest_first_name as string) || nameParts[0] || '')
              let lastName = isBiz
                ? '-'
                : ((guestProfile?.guest_last_name as string) || nameParts.slice(1).join(' ') || '')
              const street     = (guestProfile?.guest_street  as string) || ''
              const postalCode = (guestProfile?.guest_zip     as string) || ''
              const city       = (guestProfile?.guest_city    as string) || ''
              const country    = resolveCountryCode((guestProfile?.guest_country as string) || 'DE')
              const phone      = (guestProfile?.phone as string) || ''

              if (!firstName) firstName = 'Gast'
              if (!lastName)  lastName  = '-'

              const smoobuPayload = {
                smoobuApartmentId: parseInt(l.smoobu_id),
                arrivalDate: data.check_in as string,
                departureDate: data.check_out as string,
                firstName,
                lastName,
                email,
                phone: phone || '+4900000000',
                street,
                postalCode,
                city,
                country,
                adults: (data.adults as number) ?? 1,
                children: (data.children as number) ?? 0,
                price: data.total_price as number,
                notice: 'Buchung über TRIMOSA – Bestätigt & Bezahlt',
                apiKey: hostApiKey,
                channelId: hostChannelId,
              }
              console.log('[SuccessPage] Creating Smoobu reservation:', JSON.stringify({ ...smoobuPayload, apiKey: hostApiKey ? 'set' : 'not set' }))

              const smoobuId = await createReservation(smoobuPayload)
              console.log('[SuccessPage] Smoobu reservation created! ID:', smoobuId)

              await supabaseAdmin
                .from('bookings')
                .update({ smoobu_reservation_id: smoobuId })
                .eq('id', bookingId)

              // ─── Send confirmation chat message if not already sent ─
              const { data: conv } = await supabaseAdmin
                .from('conversations')
                .select('id')
                .eq('booking_id', bookingId)
                .maybeSingle()
              if (conv && l) {
                const msgCount = await supabaseAdmin
                  .from('messages')
                  .select('id', { count: 'exact', head: true })
                  .eq('conversation_id', conv.id)
                  .ilike('content', '%Zahlung erhalten%')
                if ((msgCount.count ?? 0) === 0) {
                  await supabaseAdmin.from('messages').insert({
                    conversation_id: conv.id,
                    sender_id: l.host_id,
                    content: `✅ Zahlung erhalten! Deine Buchung (${data.check_in} – ${data.check_out}) ist bestätigt.`,
                  })
                  await supabaseAdmin
                    .from('conversations')
                    .update({ last_message_at: new Date().toISOString() })
                    .eq('id', conv.id)
                  try {
                    await sendMessageToGuest(smoobuId, `Buchung über TRIMOSA für ${data.check_in} – ${data.check_out} ist bestätigt. Wir freuen uns auf deinen Aufenthalt!`)
                  } catch { /* non-fatal */ }
                }
                conversationId = conv.id
              }
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err)
              console.error('[SuccessPage] ❌ Smoobu push FAILED:', errMsg)
              smoobuError = errMsg
            }
          } else {
            // Smoobu already synced or not needed — just find the conversation
            const { data: conv } = await supabaseAdmin
              .from('conversations')
              .select('id')
              .eq('booking_id', bookingId)
              .maybeSingle()
            if (conv) conversationId = conv.id
          }
        } else {
          console.error('[SuccessPage] Booking not found in DB for id:', bookingId)
        }
      } else {
        console.warn('[SuccessPage] Stripe not paid or no bookingId:', { bookingId, stripePaid })
      }
    } catch (err) {
      console.error('[SuccessPage] error:', err)
    }
  }

  const chatHref = conversationId ? `/guest/chat?conv=${conversationId}` : '/guest/chat'

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#F5F5F7', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#fff', borderRadius: '24px', padding: '48px 40px', maxWidth: '480px', width: '100%', textAlign: 'center', boxShadow: '0 8px 40px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>
          {booking?.booking_type === 'instant' ? '🎉' : '✅'}
        </div>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111', margin: '0 0 8px' }}>
          {booking?.booking_type === 'instant' ? 'Buchung bestätigt!' : 'Anfrage gesendet!'}
        </h1>
        <p style={{ fontSize: '14px', color: '#888', margin: '0 0 24px', lineHeight: 1.6 }}>
          {booking?.booking_type === 'instant'
            ? 'Deine Zahlung wurde erfolgreich verarbeitet. Der Gastgeber freut sich auf deinen Aufenthalt!'
            : 'Zahlung erfolgreich. Sobald der Gastgeber deine Anfrage bestätigt, erhältst du eine Nachricht im Chat.'}
        </p>

        {listing && booking && (
          <div style={{ background: '#F9F7F3', borderRadius: '16px', padding: '16px 20px', marginBottom: '24px', textAlign: 'left' }}>
            <p style={{ fontWeight: 700, fontSize: '14px', color: '#111', margin: '0 0 4px' }}>{listing.title}</p>
            <p style={{ fontSize: '12px', color: '#888', margin: '0 0 8px' }}>📍 {listing.location}</p>
            <p style={{ fontSize: '12px', color: '#555', margin: 0 }}>
              {booking.check_in as string} – {booking.check_out as string} · €{booking.total_price as number}
            </p>
          </div>
        )}

        {smoobuError && (
          <div style={{ background: '#FEF2F2', borderRadius: '12px', padding: '12px 16px', marginBottom: '16px', textAlign: 'left' }}>
            <p style={{ fontSize: '11px', color: '#DC2626', margin: 0 }}>
              ⚠️ Smoobu-Synchronisation fehlgeschlagen. Der Gastgeber wurde benachrichtigt.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Link href={chatHref} style={{ display: 'block', padding: '13px', borderRadius: '14px', background: 'linear-gradient(135deg, #C4A235, #8A6818)', color: '#fff', fontWeight: 700, fontSize: '14px', textDecoration: 'none' }}>
            💬 Zum Chat
          </Link>
          <Link href="/guest" style={{ display: 'block', padding: '13px', borderRadius: '14px', border: '1px solid #E0DDD6', color: '#555', fontWeight: 600, fontSize: '14px', textDecoration: 'none' }}>
            Meine Reisen
          </Link>
          <Link href="/" style={{ display: 'block', padding: '13px', borderRadius: '14px', color: '#AAA', fontWeight: 500, fontSize: '13px', textDecoration: 'none' }}>
            Zurück zur Startseite
          </Link>
        </div>
      </div>
    </main>
  )
}

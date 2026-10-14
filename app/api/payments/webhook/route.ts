import { NextRequest, NextResponse } from 'next/server'
import { sendNewBookingPush, sendPushToTeam } from '@/lib/push'
import { stripe } from '@/lib/stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createReservation, cancelReservation } from '@/lib/smoobu'
import { claimSmoobuPush, releaseSmoobuPush } from '@/lib/smoobu-claim'
import { resolveOverbooking } from '@/lib/overbooking'
import { sendBookingEmail, sendHostBookingAlert, sendBookingCancelledEmail } from '@/lib/email'

// Explizites Zeitlimit (Server-Prüfung 9.10.): Stripe: Website-Buchung bzw. Verlängerung (Smoobu-Anlage, Rechnung, Mails, Gast-Bestätigung) — nie am Standard-Zeitlimit abbrechen
export const maxDuration = 120

/**
 * POST /api/payments/webhook
 * Stripe sends events here. Set up in Stripe Dashboard:
 *   Webhook URL: https://trimosa-app.vercel.app/api/payments/webhook
 *   Events: checkout.session.completed, checkout.session.expired, charge.refunded
 */

/**
 * 🧯 Zahlung eingegangen, aber die Buchung darf nicht bestätigt werden (14.10.2026): Sie war beim Eintreffen
 * des Webhooks schon storniert/verfallen (Aufräumer, Gast-Abbruch) oder der Zeitraum ist inzwischen anderweitig
 * belegt (Overlap-Schutz 23P01). Dann NICHT 500 (Stripe wiederholt endlos, Gast hat bezahlt, nichts passiert),
 * sondern: automatisch erstatten, Buchung storniert lassen, Team-Push, Gast im Chat informieren — Vorbild
 * lib/zahlungen.ts (Verlängerung gegen belegten Zeitraum).
 */
async function erstatteNachZahlung(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  session: any,
  booking: { id: string; guest_id: string | null; check_in: string; check_out: string },
  listing: { title: string; host_id: string } | null,
  grund: string,
): Promise<'erstattet' | 'nicht_erstattet' | 'db_fehler'> {
  const piId: string | null = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : (session.payment_intent?.id ?? null)
  let refundId: string | null = null
  try {
    // Idempotency-Key: bei Stripe-Wiederholung desselben Events kommt derselbe Refund zurück statt „already refunded"
    if (piId) refundId = (await stripe.refunds.create({ payment_intent: piId }, { idempotencyKey: `refund-${session.id}` })).id
  } catch (e) {
    console.error('[Webhook] automatische Erstattung fehlgeschlagen:', booking.id, e)
  }
  const { error: dbErr } = await supabaseAdmin.from('bookings').update({
    status: 'cancelled',
    payment_status: 'paid',
    paid_at: new Date().toISOString(),
    stripe_payment_intent_id: piId,
    ...(refundId ? { refunded_at: new Date().toISOString(), stripe_refund_id: refundId } : {}),
  }).eq('id', booking.id)
  if (dbErr) {
    // 500 → Stripe wiederholt; der Refund ist per Idempotency-Key derselbe, nur der DB-Stand wird nachgezogen
    console.error('[Webhook] Erstattung verbucht, DB-Update fehlgeschlagen:', booking.id, dbErr.message)
    return 'db_fehler'
  }

  const betrag = ((session.amount_total ?? 0) / 100).toFixed(2)
  const wo = `${listing?.title ?? 'Wohnung'} ${booking.check_in} – ${booking.check_out}`
  await sendPushToTeam(
    `💶 ${refundId ? 'Zahlung automatisch erstattet' : 'Zahlung ohne Buchung'} · ${listing?.title ?? 'Wohnung'}`,
    `${wo}, ${betrag} €: ${grund}.${refundId ? ' Nichts mehr zu tun.' : ` Bitte im Stripe-Dashboard erstatten (Zahlungs-ID ${piId ?? '?'}).`}`,
    // Erstattung gescheitert = Handarbeit nötig → 'system' (kommt auch in der Ruhezeit sofort durch)
    '/team', { category: refundId ? 'bookings' : 'system' },
  ).catch((e) => console.error('[Webhook] Team-Push Erstattung:', e))

  try {
    const { data: conv } = await supabaseAdmin.from('conversations').select('id').eq('booking_id', booking.id).maybeSingle()
    if (conv) {
      await supabaseAdmin.from('messages').insert({
        conversation_id: conv.id,
        sender_id: listing?.host_id ?? booking.guest_id,
        content: refundId
          ? `❌ Leider konnten wir deine Buchung (${booking.check_in} – ${booking.check_out}) nicht mehr bestätigen: ${grund}. Deine Zahlung von €${betrag} wurde automatisch erstattet und erscheint in 5–10 Werktagen auf deiner Zahlungsmethode. Entschuldige die Umstände — gern helfen wir bei einem anderen Zeitraum.`
          : `❌ Leider konnten wir deine Buchung (${booking.check_in} – ${booking.check_out}) nicht mehr bestätigen: ${grund}. Wir erstatten deine Zahlung von €${betrag} umgehend und melden uns hier.`,
      })
      await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
    }
  } catch (e) {
    console.error('[Webhook] Chat-Hinweis Erstattung:', e)
  }
  console.warn('[Webhook] Zahlung nicht in Buchung umgesetzt → erstattet:', booking.id, grund, refundId ?? 'OHNE Refund')
  return refundId ? 'erstattet' : 'nicht_erstattet'
}

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature') ?? ''
  const body = await req.text()

  let event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET ?? '')
  } catch (err) {
    console.error('[Webhook] signature verification failed', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = event.data.object as any

    // 💶 Zahllinks aus dem Gäste-Chat und Verlängerungen aus der Gästemappe (lib/zahlungen.ts) — VOR der
    // Website-Buchungslogik: Zahllink-Sessions tragen kein bookingId-Metadatum (sonst 400 → Stripe wiederholt
    // endlos), Verlängerungen dürfen die Ursprungsbuchung nicht als „bezahlt" überschreiben.
    if (session.metadata?.kind === 'verlaengerung' || session.payment_link) {
      try {
        const { verbucheVerlaengerung, verbucheZahllink } = await import('@/lib/zahlungen')
        const r = session.metadata?.kind === 'verlaengerung' ? await verbucheVerlaengerung(session) : await verbucheZahllink(session)
        console.log('[Webhook] Zusatzzahlung:', session.metadata?.kind ?? 'zahllink', r, session.id)
        // 'fehler' = nicht verbuchbar (Team ist per Push informiert) — trotzdem 200, eine Wiederholung hilft nicht
        return NextResponse.json({ ok: true, zusatzzahlung: r })
      } catch (err) {
        console.error('[Webhook] Zusatzzahlung fehlgeschlagen:', session.id, err)
        return NextResponse.json({ error: 'Zusatzzahlung nicht verbucht' }, { status: 500 })
      }
    }

    const bookingId = session.metadata?.bookingId
    const bookingType = session.metadata?.bookingType ?? 'request'

    if (!bookingId) return NextResponse.json({ error: 'missing bookingId' }, { status: 400 })

    // Load booking
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('*, listings(id, title, smoobu_id, host_id, cancellation_policy)')
      .eq('id', bookingId)
      .single()

    if (!booking) return NextResponse.json({ ok: true }) // idempotent
    // Stripe stellt Ereignisse mindestens einmal zu (Retry, Doppelzustellung): schon bezahlt → nichts erneut
    // senden (sonst gingen Bestätigungsmail, Host-Alarm und Push doppelt raus)
    if (booking.payment_status === 'paid') return NextResponse.json({ ok: true, schonBezahlt: true })

    const listing = booking.listings as unknown as { id: string; title: string; smoobu_id: string | null; host_id: string; cancellation_policy: string } | null

    // Determine new booking status
    // instant: pending_payment → confirmed (erst jetzt, nach Zahlung); request → stays pending until host confirms
    const newStatus = bookingType === 'instant' ? 'confirmed' : 'pending'

    // Buchung war beim Zahlungseingang schon storniert/verfallen (Aufräumer nach 40 Min, Gast-Abbruch,
    // Zahlung einer alten Session) → nicht wiederbeleben, sondern erstatten
    if (booking.status === 'cancelled') {
      const r = await erstatteNachZahlung(session, booking, listing, 'die Buchung war beim Zahlungseingang bereits verfallen oder storniert')
      if (r === 'db_fehler') return NextResponse.json({ error: 'Erstattung nicht verbucht' }, { status: 500 })
      return NextResponse.json({ ok: true, erstattet: r })
    }

    // Update booking — scheitert es, mit 500 antworten: Stripe wiederholt dann, statt dass der Gast eine
    // Bestätigung bekommt, während die Buchung unbezahlt bleibt
    // Bedingtes Update = Claim: Die Erfolgsseite (app/booking/success) setzt 'paid' ggf. zuerst und verschickt
    // dann selbst Mail/Alarm/Push — hier nur weitermachen, wenn DIESER Aufruf den Übergang gemacht hat
    const { data: claimed, error: updErr } = await supabaseAdmin
      .from('bookings')
      .update({
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        stripe_payment_intent_id: session.payment_intent as string,
        status: newStatus,
      })
      .eq('id', bookingId)
      .neq('payment_status', 'paid')
      .select('id')
    if (updErr && (updErr.code === '23P01' || /exclusion|overlap|conflict/i.test(updErr.message ?? ''))) {
      // Overlap-Schutz: Zeitraum inzwischen anderweitig belegt (z. B. Portalbuchung nach Verfall) → kein Retry-Loop
      const r = await erstatteNachZahlung(session, booking, listing, 'der Zeitraum ist inzwischen anderweitig belegt')
      if (r === 'db_fehler') return NextResponse.json({ error: 'Erstattung nicht verbucht' }, { status: 500 })
      return NextResponse.json({ ok: true, erstattet: r })
    }
    if (updErr) {
      console.error('[Webhook] Buchung nicht als bezahlt gespeichert:', bookingId, updErr.message)
      return NextResponse.json({ error: 'Buchung konnte nicht aktualisiert werden' }, { status: 500 })
    }
    if (!claimed?.length) return NextResponse.json({ ok: true, schonBezahlt: true, durch: 'erfolgsseite' })

    // Notify the host now that payment is confirmed — requests ask for
    // accept/decline, instant bookings just inform. AWAIT ist Pflicht
    // (§135): fire-and-forget stirbt, sobald die Function nach der
    // Response eingefroren wird. The guest confirmation also goes out
    // HERE (only after payment).
    await sendBookingEmail(bookingId).catch(err =>
      console.error('[Webhook] guest confirmation failed (non-fatal):', err))
    await Promise.resolve(sendHostBookingAlert(bookingId)).catch(err =>
      console.error('[Webhook] host alert failed (non-fatal):', err))
    // Rollenabhängiger Buchungs-Push (Chefs mit Betrag, Staff ohne),
    // Tap → Gast-Thread in der Team-Inbox
    await sendNewBookingPush(bookingId).catch(err =>
      console.error('[Webhook] booking push failed (non-fatal):', err)
    )

    // For instant bookings: push to Smoobu immediately.
    // §274: Claim ZUERST — die Erfolgsseite pusht sonst parallel (Doppel-
    // Push-Race, Pisulla-Fall 7.9.). 'taken' = der andere Pfad ist dran.
    const smoobuClaim = (bookingType === 'instant' && listing?.smoobu_id && !booking.smoobu_reservation_id)
      ? await claimSmoobuPush(bookingId)
      : 'taken'
    if (smoobuClaim === 'taken' && bookingType === 'instant' && listing?.smoobu_id && !booking.smoobu_reservation_id) {
      console.log('[Webhook] Smoobu-Push übersprungen — anderer Pfad (Erfolgsseite) hat den Claim:', bookingId)
    }
    if (bookingType === 'instant' && listing?.smoobu_id && !booking.smoobu_reservation_id && smoobuClaim !== 'taken') {
      try {
        // Load host's own Smoobu credentials (per-host support)
        const { data: hostSmoobu } = await supabaseAdmin
          .from('profiles')
          .select('smoobu_api_key, smoobu_channel_id')
          .eq('id', listing.host_id)
          .maybeSingle()
        const hostApiKey = (hostSmoobu as Record<string, unknown> | null)?.smoobu_api_key as string | undefined
        const hostChannelId = (hostSmoobu as Record<string, unknown> | null)?.smoobu_channel_id as number | undefined

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

        const guestData = await supabaseAdmin.auth.admin.getUserById(booking.guest_id)
        const guestEmail = guestData.data.user?.email ?? ''

        // ── Always fetch guest profile from DB — most up-to-date source ──────────
        let guestProfile: Record<string, unknown> | null = null
        {
          const { data: gp1, error: gpErr1 } = await supabaseAdmin
            .from('profiles')
            .select('guest_first_name, guest_last_name, company_name, account_type, display_name, phone, guest_street, guest_zip, guest_city, guest_country')
            .eq('id', booking.guest_id)
            .maybeSingle()

          if (gpErr1) {
            console.error('[Webhook] Full profile select failed:', gpErr1.message, '– retrying minimal select')
            const { data: gp2, error: gpErr2 } = await supabaseAdmin
              .from('profiles')
              .select('guest_first_name, guest_last_name, display_name, guest_street, guest_zip, guest_city, guest_country')
              .eq('id', booking.guest_id)
              .maybeSingle()
            if (gpErr2) {
              console.error('[Webhook] Minimal profile select also failed:', gpErr2.message)
            } else {
              guestProfile = gp2 as Record<string, unknown> | null
            }
          } else {
            guestProfile = gp1 as Record<string, unknown> | null
          }
        }

        console.log('[Webhook] Guest profile data:', JSON.stringify(guestProfile))

        // Ultimate fallback: auth user_metadata (always has at least "name")
        const guestMeta = guestData.data.user?.user_metadata ?? {}
        const metaName = (guestMeta.name as string) || ''
        const metaNameParts = metaName.split(' ')

        // Derive Smoobu fields from profile, with auth metadata as fallback
        const isBiz = guestProfile?.account_type === 'business'
        const displayName = (guestProfile?.display_name as string) || metaName || ''
        const nameParts = displayName.split(' ')

        let smoobuFirstName = isBiz
          ? ((guestProfile?.company_name as string) || displayName || '')
          : ((guestProfile?.guest_first_name as string) || nameParts[0] || metaNameParts[0] || '')
        let smoobuLastName = isBiz
          ? '-'
          : ((guestProfile?.guest_last_name as string) || nameParts.slice(1).join(' ') || metaNameParts.slice(1).join(' ') || '')
        const smoobuStreet  = (guestProfile?.guest_street as string)  || ''
        const smoobuZip     = (guestProfile?.guest_zip    as string)  || ''
        const smoobuCity    = (guestProfile?.guest_city   as string)  || ''
        const smoobuCountry = resolveCountryCode((guestProfile?.guest_country as string) || 'DE')
        const smoobuPhone = (guestProfile?.phone as string) || ''

        // Final fallbacks
        if (!smoobuFirstName) smoobuFirstName = 'Gast'
        if (!smoobuLastName)  smoobuLastName  = '-'

        console.log('[Webhook] Creating Smoobu reservation — booking:', bookingId,
          '| apartment:', listing.smoobu_id,
          '| guest:', smoobuFirstName, smoobuLastName,
          '| email:', guestEmail,
          '| address:', smoobuStreet || '(empty)', smoobuZip || '(empty)', smoobuCity || '(empty)', smoobuCountry,
          '| phone:', smoobuPhone ? 'set' : 'not set')

        const smoobuId = await createReservation({
          smoobuApartmentId: parseInt(listing.smoobu_id),
          arrivalDate: booking.check_in,
          departureDate: booking.check_out,
          firstName: smoobuFirstName,
          lastName: smoobuLastName,
          email: guestEmail,
          phone: smoobuPhone || '+4900000000',
          street: smoobuStreet,
          postalCode: smoobuZip,
          city: smoobuCity,
          country: smoobuCountry,
          adults: booking.adults ?? 1,
          children: booking.children ?? 0,
          price: booking.total_price,
          notice: 'Buchung über TRIMOSA – Bestätigt & Bezahlt',
          apiKey: hostApiKey,
          channelId: hostChannelId,
        })
        await supabaseAdmin.from('bookings').update({ smoobu_reservation_id: smoobuId }).eq('id', bookingId)
      } catch (err) {
        console.error('[Webhook] Smoobu push failed:', err)
        // Claim freigeben — sonst blockiert er 2 Min lang den Fallback
        if (smoobuClaim === 'claimed') await releaseSmoobuPush(bookingId).catch(() => {})
      }
    }

    // Send confirmation message in chat
    try {
      const { data: conv } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('booking_id', bookingId)
        .maybeSingle()
      if (conv && listing) {
        const msg = bookingType === 'instant'
          ? `✅ Zahlung erhalten! Deine Buchung für "${listing.title}" (${booking.check_in} – ${booking.check_out}) ist bestätigt.`
          : `💳 Zahlung erhalten! Deine Anfrage für "${listing.title}" (${booking.check_in} – ${booking.check_out}) wartet noch auf die Bestätigung des Gastgebers.`
        await supabaseAdmin.from('messages').insert({
          conversation_id: conv.id,
          sender_id: listing.host_id,
          content: msg,
        })
        await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
      }
    } catch (err) {
      console.error('[Webhook] chat msg failed:', err)
    }
  }

  // A booking row is created (status 'pending_payment'/'pending') before the
  // guest ever reaches Stripe Checkout. If the session expires unpaid
  // (30 min, see lib/checkout.ts), that row would otherwise sit there
  // indefinitely — for instant bookings blocking the calendar via the
  // exclusion constraint (confirmed + pending_payment). Sicherheitsnetz
  // für verlorene Events: Cron /api/bookings/sweep (lib/booking-sweep.ts).
  if (event.type === 'checkout.session.expired') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = event.data.object as any
    // ⚠️ Abgebrochene Verlängerung: metadata.bookingId ist die URSPRUNGSbuchung — die darf NIE storniert werden
    // (Portal-Buchungen sind bei uns „unbezahlt" und fielen sonst unter die Verfalls-Regel unten)
    if (session.metadata?.kind === 'verlaengerung' || session.payment_link) return NextResponse.json({ ok: true })
    const bookingId = session.metadata?.bookingId
    if (!bookingId) return NextResponse.json({ ok: true })

    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('id, status, payment_status, listing_id, check_in, check_out, stripe_checkout_session_id')
      .eq('id', bookingId)
      .maybeSingle()

    // Only cancel if it's still unpaid — a completed payment always wins
    // over an expiry event, regardless of arrival order. Und nur, wenn es
    // die AKTUELLE Session der Buchung ist: nach „Zahlung erneut starten"
    // darf das Ablaufen der alten Session die neue nicht stornieren.
    // (Buchungen ohne gespeicherte Session-ID räumt der Sweep nach 40 Min auf.)
    const sessionPasst = !!booking?.stripe_checkout_session_id && booking.stripe_checkout_session_id === session.id
    if (booking && booking.payment_status !== 'paid' && booking.status !== 'cancelled' && sessionPasst) {
      await supabaseAdmin
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', bookingId)
        .eq('stripe_checkout_session_id', session.id)
        .neq('payment_status', 'paid')
      // §274 Entwarnung (Fall Margit/Heidi 27.8.): Der unbezahlte Website-
      // Checkout blockte den Zeitraum und löste gegen eine Portal-Buchung
      // den Überbuchungs-Alarm aus — mit dem Verfall ist der Konflikt weg.
      if (booking.listing_id && booking.check_in && booking.check_out) {
        await resolveOverbooking({
          listingId: booking.listing_id, checkIn: booking.check_in, checkOut: booking.check_out,
          grund: 'Die unbezahlte Website-Buchung ist verfallen (Checkout nicht abgeschlossen) — der Zeitraum ist wieder frei.',
        }).catch((e) => console.error('[Webhook] overbooking resolve:', e))
      }
    }

    return NextResponse.json({ ok: true })
  }

  // Refunds triggered from the Stripe Dashboard (outside our own
  // /api/payments/refund or declineBooking flows) never reached the DB
  // before — this keeps bookings.status/refunded_at in sync either way.
  if (event.type === 'charge.refunded') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const charge = event.data.object as any
    const paymentIntentId = charge.payment_intent as string | null
    if (!paymentIntentId) return NextResponse.json({ ok: true })

    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('*, listings(title, host_id)')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .maybeSingle()

    if (!booking) return NextResponse.json({ ok: true }) // unrelated charge

    // Idempotent: our own refund/decline flows already set refunded_at
    // themselves, so skip re-processing (and re-notifying) here.
    if (booking.refunded_at) return NextResponse.json({ ok: true })

    const listing = booking.listings as unknown as { title: string; host_id: string } | null
    const refundId = (charge.refunds?.data?.[0]?.id as string) ?? null

    await supabaseAdmin
      .from('bookings')
      .update({
        status: 'cancelled',
        refunded_at: new Date().toISOString(),
        stripe_refund_id: refundId,
      })
      .eq('id', booking.id)

    if (booking.smoobu_reservation_id) {
      try {
        await cancelReservation(booking.smoobu_reservation_id)
      } catch (err) {
        console.error('[Webhook] Smoobu cancelReservation failed:', err)
      }
    }

    // Cancellation confirmation email to the guest
    try {
      await sendBookingCancelledEmail(booking.id, { refunded: (charge.amount_refunded ?? 0) / 100 })
    } catch (err) {
      console.error('[Webhook] cancellation email failed (non-fatal):', err)
    }

    try {
      const { data: conv } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('booking_id', booking.id)
        .maybeSingle()
      if (conv) {
        const refundedAmount = (charge.amount_refunded ?? 0) / 100
        await supabaseAdmin.from('messages').insert({
          conversation_id: conv.id,
          sender_id: listing?.host_id ?? booking.guest_id,
          content: `❌ Buchung storniert. Rückerstattung von €${refundedAmount.toFixed(2)} wurde veranlasst und erscheint in 5–10 Werktagen auf deiner Zahlungsmethode.`,
        })
        await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
      }
    } catch (err) {
      console.error('[Webhook] chat msg failed:', err)
    }
  }

  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getQuote } from '@/lib/smoobu'
import { getMarkupMultiplier } from '@/lib/pricing'
import { checkRateLimit } from '@/lib/rate-limit'
import { getUiLang } from '@/lib/i18n-server'
import { findActiveDiscount } from '@/lib/discounts'
import { createStripeCheckout } from '@/lib/checkout'
import { sendGuestAccountEmail } from '@/lib/email'
import type { User } from '@supabase/supabase-js'

/** §266d Guest-Checkout: Kontaktdaten aus dem Buchungsformular für die
 *  automatische Konto-Anlage — strikt whitelisted, role ist IMMER 'guest'
 *  (§11: die Rollen-Lücke bleibt zu). */
function parseGuestInput(raw: unknown): {
  email: string; firstName: string; lastName: string; phone: string
  street: string; zip: string; city: string; country: string
} | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim() : '')
  const email = str(g.email).toLowerCase()
  const out = {
    email,
    firstName: str(g.firstName).slice(0, 80),
    lastName: str(g.lastName).slice(0, 80),
    phone: str(g.phone).slice(0, 40),
    street: str(g.street).slice(0, 120),
    zip: str(g.zip).slice(0, 20),
    city: str(g.city).slice(0, 80),
    country: str(g.country).slice(0, 60) || 'Deutschland',
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null
  if (!out.firstName || !out.lastName || !out.phone || !out.street || !out.zip || !out.city) return null
  return out
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user: sessionUser } } = await supabase.auth.getUser()
  const body = await request.json()

  // §266d Guest-Checkout: ohne Session sind Kontaktdaten im Body Pflicht —
  // das Konto wird weiter unten (NACH der Verfügbarkeits-/Preisprüfung)
  // automatisch angelegt. Alte Clients ohne guest-Objekt: 401 wie bisher.
  const guestInput = !sessionUser ? parseGuestInput((body as Record<string, unknown>).guest) : null
  if (!sessionUser && (body as Record<string, unknown>).guest && !guestInput) {
    return NextResponse.json({ error: 'Bitte fülle alle Kontaktfelder aus (E-Mail, Name, Telefon, Adresse).' }, { status: 400 })
  }
  if (!sessionUser && !guestInput) return NextResponse.json({ error: 'Bitte zuerst anmelden' }, { status: 401 })

  const ip = (request.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  const allowed = sessionUser
    ? await checkRateLimit(`bookings:${sessionUser.id}`, 20, 3600)
    : await checkRateLimit(`bookings-ip:${ip}`, 10, 3600)
  if (!allowed) {
    return NextResponse.json({ error: 'Zu viele Buchungsanfragen. Bitte später erneut versuchen.' }, { status: 429 })
  }
  const {
    listingId, checkIn, checkOut,
    adults = 1, children = 0, message = '',
    booking_type = 'request',
    guest_price_suggestion,
  } = body

  if (!listingId || !checkIn || !checkOut)
    return NextResponse.json({ error: 'listingId, checkIn und checkOut erforderlich' }, { status: 400 })

  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('id, title, smoobu_id, price_per_night, host_id, allow_instant_booking, allow_requests, min_request_nights')
    .eq('id', listingId)
    .single()
  if (!listing) return NextResponse.json({ error: 'Unterkunft nicht gefunden' }, { status: 404 })

  // Booking settings live on the listing (per-listing, not per-host)
  if (booking_type === 'instant' && listing.allow_instant_booking === false)
    return NextResponse.json({ error: 'Sofortbuchung ist für diese Unterkunft nicht verfügbar.' }, { status: 403 })
  if (booking_type === 'request' && listing.allow_requests === false)
    return NextResponse.json({ error: 'Anfragen sind für diese Unterkunft deaktiviert.' }, { status: 403 })

  const nights = Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000)
  if (booking_type === 'request') {
    const minNights = listing.min_request_nights ?? 1
    if (nights < minNights)
      return NextResponse.json({ error: `Anfragen erst ab ${minNights} Nächten möglich.` }, { status: 400 })
  }

  // ── Check availability + get price (with platform markup) ────────────
  let totalPrice = 0
  const markup = await getMarkupMultiplier(listing.host_id)
  console.log('[Bookings] markup multiplier:', markup)

  if (listing.smoobu_id) {
    // §224: Preis PERSONEN-GENAU über das Booking-Tool-Quote (Aufschlag ab
    // 3./4. Person) — die daily-rates kannten keine Gästezahl, wodurch
    // Direktbuchungen für 3+ Gäste zu günstig berechnet wurden.
    const persons = (Number(adults) || 1) + (Number(children) || 0)
    const avail = await getQuote(listing.smoobu_id, checkIn, checkOut, persons)
    if (!avail.available)
      return NextResponse.json({ error: 'Diese Daten sind leider nicht verfügbar.' }, { status: 409 })
    // Apply platform markup to the raw Smoobu price
    totalPrice = Math.round(avail.totalPrice * markup)
    console.log('[Bookings] Smoobu quote:', avail.totalPrice, `(guests: ${avail.guestsUsed ?? 'Basis'})`, '→ with markup:', totalPrice)
  } else {
    totalPrice = Math.round((listing.price_per_night ?? 0) * nights * markup)
  }

  // §243af: Gutscheincode SERVERSEITIG anwenden (der Client zeigt nur an) —
  // gleiche Rundung wie die BookingBox-Anzeige, damit Anzeige = Zahlbetrag
  let discount: { code: string; pct: number } | null = null
  if (typeof body.discount_code === 'string' && body.discount_code.trim()) {
    const hit = await findActiveDiscount(body.discount_code)
    if (!hit) return NextResponse.json({ error: 'Der Gutscheincode ist ungültig oder abgelaufen.' }, { status: 400 })
    discount = { code: hit.code, pct: hit.pct }
    totalPrice = Math.round(totalPrice * (1 - hit.pct / 100))
    console.log('[Bookings] Gutschein', hit.code, `−${hit.pct}% →`, totalPrice)
  }

  // §266d: Konto erst JETZT anlegen — nach bestandener Verfügbarkeits- und
  // Preisprüfung entsteht nie ein Konto ohne buchbare Daten.
  let user: User | null = sessionUser
  let guestCheckout = false
  if (!user && guestInput) {
    const signupOk = await checkRateLimit(`guest-signup:${ip}`, 3, 3600)
    if (!signupOk) return NextResponse.json({ error: 'Zu viele Registrierungen. Bitte später erneut versuchen.' }, { status: 429 })
    const displayName = `${guestInput.firstName} ${guestInput.lastName}`.trim()
    const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: guestInput.email,
      password: crypto.randomUUID() + crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { role: 'guest', account_type: 'person', name: displayName },
    })
    if (authErr || !created?.user) {
      if (authErr && /already.*registered/i.test(authErr.message)) {
        return NextResponse.json({
          error: 'Mit dieser E-Mail-Adresse gibt es schon ein Konto — bitte melde dich kurz an, deine Auswahl bleibt erhalten.',
          code: 'email-exists',
        }, { status: 409 })
      }
      console.error('[Bookings] Guest-Konto-Anlage fehlgeschlagen:', authErr?.message)
      return NextResponse.json({ error: 'Konto konnte nicht angelegt werden. Bitte versuche es erneut.' }, { status: 500 })
    }
    const { error: profErr } = await supabaseAdmin.from('profiles').upsert({
      id: created.user.id,
      display_name: displayName,
      account_type: 'person',
      guest_first_name: guestInput.firstName,
      guest_last_name: guestInput.lastName,
      company_name: null,
      vat_id: null,
      guest_street: guestInput.street,
      guest_zip: guestInput.zip,
      guest_city: guestInput.city,
      guest_country: guestInput.country,
      phone: guestInput.phone,
    })
    if (profErr) {
      // Register-Muster: kein Halbzustand — User wieder löschen
      await supabaseAdmin.auth.admin.deleteUser(created.user.id).catch(() => {})
      console.error('[Bookings] Guest-Profil fehlgeschlagen:', profErr.message)
      return NextResponse.json({ error: 'Konto konnte nicht angelegt werden. Bitte versuche es erneut.' }, { status: 500 })
    }
    // §266d-Review: Die Konto-Mail kommt erst NACH erfolgreichem Insert +
    // Checkout — scheitert die Buchung, wird das Konto zurückgerollt und es
    // ging nie eine verwirrende „Konto angelegt"-Mail raus.
    user = created.user
    guestCheckout = true
    console.log('[Bookings] Guest-Checkout: Konto angelegt für', guestInput.email)
  }
  if (!user) return NextResponse.json({ error: 'Bitte zuerst anmelden' }, { status: 401 })

  const initialStatus = booking_type === 'instant' ? 'confirmed' : 'pending'

  const insertRow = {
    guest_lang: await getUiLang(),
    listing_id: listingId,
    guest_id: user.id,
    check_in: checkIn,
    check_out: checkOut,
    total_price: totalPrice,
    adults,
    children,
    status: initialStatus,
    message,
    booking_type,
    guest_price_suggestion: guest_price_suggestion ?? null,
  }
  // eslint-disable-next-line prefer-const
  let { data: newBooking, error: bookingError } = await supabaseAdmin
    .from('bookings')
    .insert(discount ? { ...insertRow, discount_code: discount.code, discount_pct: discount.pct } : insertRow)
    .select('id')
    .single()
  if (bookingError && discount && /discount_code|discount_pct/.test(bookingError.message)) {
    // Migration 20260802_discount_codes fehlt noch → ohne die Doku-Spalten
    // (der RABATTIERTE Preis steht ja in total_price)
    ;({ data: newBooking, error: bookingError } = await supabaseAdmin
      .from('bookings').insert(insertRow).select('id').single())
  }

  if (bookingError || !newBooking) {
    // §266d-Review: Guest-Konto zurückrollen (Mail ist noch NICHT raus, keine
    // weiteren Referenzen — der nächste Versuch legt sauber neu an statt in
    // die email-exists-Sackgasse zu laufen)
    if (guestCheckout && user) {
      await supabaseAdmin.auth.admin.deleteUser(user.id).catch(() => {})
    }
    // 23P01 = exclusion_violation → the DB-level double-booking guard caught
    // an overlapping confirmed booking for this listing (see migration
    // 20260711_prevent_double_booking.sql).
    if (bookingError?.code === '23P01') {
      return NextResponse.json({ error: 'Diese Daten sind leider inzwischen belegt.' }, { status: 409 })
    }
    console.error('[Bookings] insert error:', bookingError)
    return NextResponse.json({ error: 'Buchung konnte nicht gespeichert werden.' }, { status: 500 })
  }

  // ── NOTE: Smoobu reservation is created AFTER payment on the success page ──
  // We do NOT push to Smoobu here because payment hasn't happened yet.
  // The success page (app/booking/success/page.tsx) handles Smoobu creation
  // once Stripe confirms payment.

  // Auto-create a linked conversation so host & guest can chat immediately
  try {
    const guestName = user.user_metadata?.name ?? user.email ?? 'Gast'
    const { data: hostProfileForName } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', listing.host_id)
      .maybeSingle()
    const hostName = hostProfileForName?.display_name ?? 'Gastgeber'

    const { data: existing } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('listing_id', listingId)
      .eq('guest_id', user.id)
      .maybeSingle()

    let convId = existing?.id
    if (!convId) {
      const { data: newConv } = await supabaseAdmin
        .from('conversations')
        .insert({
          listing_id: listingId,
          host_id: listing.host_id,
          guest_id: user.id,
          guest_name: guestName,
          host_name: hostName,
          listing_title: listing.title ?? '',
          booking_id: newBooking.id,
          last_message_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      convId = newConv?.id
    } else {
      await supabaseAdmin
        .from('conversations')
        .update({ booking_id: newBooking.id, host_name: hostName })
        .eq('id', convId)
    }

    // Send an auto-message
    if (convId) {
      const autoMsg = booking_type === 'instant'
        ? `Deine Buchung für ${listing.title} (${checkIn} – ${checkOut}) wurde angelegt. Zahlung wird verarbeitet…`
        : `Deine Anfrage für ${listing.title} (${checkIn} – ${checkOut}) wurde gesendet. Der Gastgeber wird sie in Kürze bearbeiten.`
      await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: convId,
          sender_id: listing.host_id,
          content: autoMsg,
        })
      await supabaseAdmin
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', convId)
    }
  } catch (err) {
    console.error('[Bookings] auto-conversation failed (non-fatal):', err)
  }

  // Gast-Bestätigung wird bewusst NICHT hier verschickt, sondern erst im
  // Stripe-Webhook nach bestätigter Zahlung (Inhaber-Vorgabe: keine Mail
  // vor Zahlungseingang; abgebrochene Checkouts bekommen so nie eine Mail).

  // §266d: Ohne Browser-Session kann der Client /api/payments/checkout nicht
  // aufrufen (401) — die Checkout-URL entsteht deshalb hier server-seitig.
  if (guestCheckout) {
    const co = await createStripeCheckout(String(newBooking.id), { id: user.id, email: user.email ?? null })
    // Konto-Mail (Passwort-Festlegen-Link) erst jetzt — Konto + Buchung
    // stehen; im Checkout-Fehlerpfad braucht der Gast sie erst recht, um
    // sich anmelden und erneut buchen zu können. Best effort, awaited (§135).
    await sendGuestAccountEmail(user.email ?? '', String(user.user_metadata?.name ?? ''), await getUiLang())
      .catch((e) => console.error('[Bookings] Konto-Mail fehlgeschlagen:', e))
    if (!co.ok || !co.url) {
      // Nie eine unbezahlbare confirmed/pending-Geisterbuchung liegen lassen
      // (ohne Stripe-Session greift auch der expired-Aufräumer nicht);
      // Konto bleibt bewusst — die Buchung referenziert es, die Mail ist raus.
      await supabaseAdmin.from('bookings').update({ status: 'cancelled' }).eq('id', newBooking.id)
      return NextResponse.json({
        error: 'Die Zahlung konnte nicht gestartet werden. Dein Konto wurde angelegt — bitte melde dich an und versuche es erneut.',
      }, { status: 502 })
    }
    return NextResponse.json({ ok: true, bookingId: newBooking.id, totalPrice, booking_type, checkoutUrl: co.url, accountCreated: true })
  }

  return NextResponse.json({ ok: true, bookingId: newBooking.id, totalPrice, booking_type })
}

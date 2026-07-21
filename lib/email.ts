import { supabaseAdmin } from '@/lib/supabase-admin'
import { makeTr } from '@/lib/static-translate'
import { isUiLang, MONTHS, type UiLang } from '@/lib/i18n'

/**
 * Transactional emails via Resend, branded for TRIMOSA.
 * - sendBookingEmail: guest confirmation right after the booking/request is
 *   created (before payment) — wording differs by booking_type.
 * - sendHostBookingAlert: host notification once payment is confirmed
 *   (called from the Stripe webhook) — requests ask for accept/decline.
 * - sendBookingCancelledEmail: guest cancellation confirmation (guest cancel,
 *   host decline, Stripe-dashboard refund) incl. refund info.
 * All senders use supabaseAdmin so they work from routes and webhooks alike.
 */

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa.de'

const DE_MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

function formatDateLong(iso: string, lang: UiLang = 'de'): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const months = lang === 'de' ? DE_MONTHS : MONTHS[lang]
  if (lang === 'en') return `${months[m - 1]} ${d}, ${y}`
  return `${d}. ${months[m - 1]} ${y}`
}

/* ── Shared branded layout (table-based for broad mail-client support) ── */
function renderEmail({ preheader, heading, paragraphs, details, cta, secondaryCta, note }: {
  preheader: string
  heading: string
  paragraphs: string[]
  details: { label: string; value: string }[]
  cta?: { label: string; url: string }
  secondaryCta?: { label: string; url: string }
  note?: string
}): string {
  const detailRows = details.map(({ label, value }) => `
    <tr>
      <td style="padding:9px 0;font-size:13px;color:#8A8065;border-bottom:1px solid #F0EDE5;">${label}</td>
      <td style="padding:9px 0;font-size:14px;font-weight:600;color:#1A1400;text-align:right;border-bottom:1px solid #F0EDE5;">${value}</td>
    </tr>`).join('')

  const ctaBlock = cta ? `
    <tr><td align="center" style="padding:26px 0 6px;">
      <a href="${cta.url}" style="display:inline-block;background:linear-gradient(135deg,#AE8D2D,#8A7020);background-color:#AE8D2D;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 34px;border-radius:999px;">
        ${cta.label}
      </a>
    </td></tr>` : ''

  const secondaryBlock = secondaryCta ? `
    <tr><td align="center" style="padding:4px 0 6px;">
      <a href="${secondaryCta.url}" style="font-size:13px;font-weight:600;color:#8A7020;text-decoration:underline;">
        ${secondaryCta.label}
      </a>
    </td></tr>` : ''

  const noteBlock = note ? `
    <tr><td style="padding:18px 0 0;">
      <p style="margin:0;font-size:12.5px;line-height:1.6;color:#8A8065;background:#FAF7EE;border-radius:12px;padding:12px 16px;">${note}</p>
    </td></tr>` : ''

  return `<!DOCTYPE html>
<html lang="de">
<body style="margin:0;padding:0;background-color:#F2F0EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F2F0EA;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background-color:#12222E;border-radius:18px 18px 0 0;padding:26px 32px;text-align:center;">
          <img src="${siteUrl}/logo.png" alt="TRIMOSA Apartments &amp; Homes" width="190" style="display:inline-block;width:190px;max-width:60%;height:auto;" />
        </td></tr>

        <!-- Body -->
        <tr><td style="background-color:#ffffff;padding:34px 36px 30px;">
          <h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:#1A1400;letter-spacing:-0.2px;">${heading}</h1>
          ${paragraphs.map(p => `<p style="margin:0 0 13px;font-size:14.5px;line-height:1.7;color:#4A4438;">${p}</p>`).join('')}

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background:#FCFBF7;border:1px solid #EDE9DE;border-radius:14px;">
            <tr><td style="padding:6px 20px 10px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${detailRows}</table>
            </td></tr>
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${ctaBlock}
            ${secondaryBlock}
            ${noteBlock}
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background-color:#ffffff;border-radius:0 0 18px 18px;border-top:1px solid #F0EDE5;padding:18px 36px 22px;text-align:center;">
          <p style="margin:0 0 4px;font-size:11.5px;color:#A8A292;">TRIMOSA Apartments &amp; Homes eGbR · Ferienwohnungen in Trier, Bitburg &amp; der Südeifel</p>
          <p style="margin:0;font-size:11.5px;color:#A8A292;">
            <a href="${siteUrl}" style="color:#8A7020;text-decoration:none;">trimosa.de</a> ·
            <a href="${siteUrl}/impressum" style="color:#A8A292;text-decoration:none;">Impressum</a> ·
            <a href="${siteUrl}/datenschutz" style="color:#A8A292;text-decoration:none;">Datenschutz</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function sendViaResend(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string; note?: string }> {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.log(`[E-Mail] RESEND_API_KEY nicht gesetzt — "${subject}" an ${to} nicht versendet.`)
    return { ok: true, note: 'RESEND_API_KEY fehlt, E-Mail nicht gesendet' }
  }

  // Reply-To auf die Resend-Empfangsadresse (§134): Antworten der Gäste
  // fließen damit DIREKT in die Inbound-Pipeline → Chat-Thread + Push —
  // ganz ohne M365-Alias/Outlook-Regel. Aktiviert über die Vercel-Env
  // BOOKING_REPLY_TO (z. B. buchung@antworten.trimosa.de, sobald die
  // Empfangs-Subdomain in Resend verifiziert ist); ohne Env wie bisher.
  const replyTo = process.env.BOOKING_REPLY_TO
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
    body: JSON.stringify({
      from: 'TRIMOSA <buchung@trimosa.de>', to, subject, html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error('[E-Mail] Resend-Versand fehlgeschlagen:', err)
    return { ok: false, error: 'E-Mail-Versand fehlgeschlagen' }
  }
  return { ok: true }
}

/* ── Shared booking loader ── */
async function loadBooking(bookingId: string) {
  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('*, listings(title, location, host_id)')
    .eq('id', bookingId)
    .single()
  if (!booking) return null
  const listing = booking.listings as { title: string; location: string; host_id: string }
  const guests = (booking.adults ?? 1) + (booking.children ?? 0)
  const details = [
    { label: 'Unterkunft', value: listing.title },
    { label: 'Anreise', value: formatDateLong(booking.check_in) },
    { label: 'Abreise', value: formatDateLong(booking.check_out) },
    { label: 'Gäste', value: String(guests) },
    { label: 'Gesamtpreis', value: `€ ${booking.total_price}` },
  ]
  return { booking, listing, details }
}

/**
 * Guest email right after the booking/request was created (pre-payment).
 */
/**
 * Branded welcome email right after registration — in the user's UI language.
 * Best-effort: failures never block the registration itself.
 */
export async function sendWelcomeEmail(to: string, name: string, lang: UiLang = 'de') {
  const P1 = 'schön, dass du da bist! Dein TRIMOSA-Konto ist startklar. Ab jetzt buchst du unsere Ferienwohnungen in Trier, Bitburg und der Südeifel direkt bei uns — ohne Vermittler, ohne versteckte Gebühren.'
  const P2 = 'In deinem Gast-Bereich findest du alle Buchungen, deine Rechnungsdaten und den direkten Chat zu uns. Bei Fragen sind wir persönlich für dich da.'
  const T = await makeTr(lang, lang === 'de' ? [] : [
    'Hallo', 'Willkommen bei TRIMOSA!', 'Dein Konto ist startklar.', P1, P2, 'Jetzt Unterkunft entdecken',
  ])
  const anrede = name ? `${T('Hallo')} ${name.trim().split(/\s+/)[0]},` : `${T('Hallo')},`
  const html = renderEmail({
    preheader: T('Dein Konto ist startklar.'),
    heading: T('Willkommen bei TRIMOSA!'),
    paragraphs: [anrede, T(P1), T(P2)],
    details: [],
    cta: { label: T('Jetzt Unterkunft entdecken'), url: siteUrl },
  })
  return sendViaResend(to, T('Willkommen bei TRIMOSA!'), html)
}

export async function sendBookingEmail(bookingId: string) {
  const loaded = await loadBooking(bookingId)
  if (!loaded) return { ok: false, error: 'Buchung nicht gefunden' }
  const { booking, listing, details } = loaded

  const { data: guestData } = await supabaseAdmin.auth.admin.getUserById(booking.guest_id)
  const guestEmail = guestData?.user?.email
  if (!guestEmail) return { ok: false, error: 'Keine Gast-E-Mail gefunden' }
  const rawName = (guestData?.user?.user_metadata?.name as string | undefined) ?? ''
  const firstName = rawName.trim().split(/\s+/)[0] || ''

  const isInstant = booking.booking_type === 'instant'

  // Guest language captured at booking time (uilang cookie) → the whole email
  // goes out in that language (AI-translated once, cached in static_translations)
  const lang: UiLang = isUiLang(booking.guest_lang) ? booking.guest_lang : 'de'
  const P_INSTANT = 'schön, dass du dich für <strong>{titel}</strong> entschieden hast! Deine Zahlung ist eingegangen und deine Buchung ist bestätigt. Alle Details zum Check-In erhältst du rechtzeitig vor deiner Anreise.'
  const P_REQUEST = 'vielen Dank für deine Anfrage für <strong>{titel}</strong> — deine Zahlung ist eingegangen. Wir prüfen die Anfrage und melden uns schnellstmöglich, in der Regel innerhalb von 24 Stunden. Sollten wir nicht bestätigen können, erstatten wir den Betrag automatisch und vollständig.'
  const NOTE_REQUEST = 'Solltest du Fragen haben oder uns etwas mitteilen wollen: Antworte einfach über den Chat in deinem Gast-Bereich — wir lesen mit.'
  const T = await makeTr(lang, lang === 'de' ? [] : [
    'Hallo', 'Deine Buchung für {titel} ist bestätigt.', 'Deine Anfrage für {titel} ist eingegangen — wir melden uns.',
    'Deine Buchung ist bestätigt', 'Deine Anfrage ist eingegangen',
    P_INSTANT, P_REQUEST, NOTE_REQUEST,
    'Buchung ansehen', 'Anfrage ansehen', 'Deine Buchung', 'Deine Anfrage',
    'Unterkunft', 'Anreise', 'Abreise', 'Gäste', 'Gesamtpreis',
  ])
  const anrede = firstName ? `${T('Hallo')} ${firstName},` : `${T('Hallo')},`
  const trDetails = details.map((d) => ({
    ...d,
    label: T(d.label),
    value: (d.label === 'Anreise' || d.label === 'Abreise') && lang !== 'de'
      ? formatDateLong(d.label === 'Anreise' ? booking.check_in : booking.check_out, lang)
      : d.value,
  }))

  const html = renderEmail({
    preheader: (isInstant
      ? T('Deine Buchung für {titel} ist bestätigt.')
      : T('Deine Anfrage für {titel} ist eingegangen — wir melden uns.')).replace('{titel}', listing.title),
    heading: isInstant ? T('Deine Buchung ist bestätigt') : T('Deine Anfrage ist eingegangen'),
    paragraphs: [
      anrede,
      (isInstant ? T(P_INSTANT) : T(P_REQUEST)).replace('{titel}', listing.title),
    ],
    details: trDetails,
    cta: { label: isInstant ? T('Buchung ansehen') : T('Anfrage ansehen'), url: `${siteUrl}/guest` },
    note: isInstant ? undefined : T(NOTE_REQUEST),
  })

  return sendViaResend(
    guestEmail,
    `${isInstant ? T('Deine Buchung') : T('Deine Anfrage')}: ${listing.title}`,
    html
  )
}

/**
 * Host notification once payment is confirmed (Stripe webhook).
 * Requests ask the host to accept/decline; instant bookings just inform.
 */
export async function sendHostBookingAlert(bookingId: string) {
  const loaded = await loadBooking(bookingId)
  if (!loaded) return { ok: false, error: 'Buchung nicht gefunden' }
  const { booking, listing, details } = loaded

  // Prefer the host's configured notification address (dashboard setting,
  // e.g. fewo@trimosa.de); fall back to the login email.
  const { data: hostProfile } = await supabaseAdmin
    .from('profiles')
    .select('notification_email')
    .eq('id', listing.host_id)
    .maybeSingle()
  let hostEmail = (hostProfile?.notification_email as string | null)?.trim() || null
  if (!hostEmail) {
    const { data: hostData } = await supabaseAdmin.auth.admin.getUserById(listing.host_id)
    hostEmail = hostData?.user?.email ?? null
  }
  if (!hostEmail) return { ok: false, error: 'Keine Gastgeber-E-Mail gefunden' }

  const { data: guestData } = await supabaseAdmin.auth.admin.getUserById(booking.guest_id)
  const guestName = (guestData?.user?.user_metadata?.name as string | undefined) || guestData?.user?.email || 'Ein Gast'

  const isInstant = booking.booking_type === 'instant'
  const zeitraum = `${formatDateLong(booking.check_in)} – ${formatDateLong(booking.check_out)}`

  const hostDetails = [{ label: 'Gast', value: guestName }, ...details]
  if (booking.message) hostDetails.push({ label: 'Nachricht', value: String(booking.message).slice(0, 200) })

  const html = renderEmail({
    preheader: isInstant
      ? `Neue bezahlte Buchung für ${listing.title} (${zeitraum}).`
      : `Neue Anfrage für ${listing.title} (${zeitraum}) — bitte annehmen oder ablehnen.`,
    heading: isInstant ? '✅ Neue Buchung (bezahlt)' : '🔔 Neue Anfrage — Aktion nötig',
    paragraphs: isInstant
      ? [
          `<strong>${guestName}</strong> hat <strong>${listing.title}</strong> gebucht und bereits bezahlt. Die Reservierung wurde automatisch bestätigt und an Smoobu übertragen.`,
        ]
      : [
          `<strong>${guestName}</strong> hat eine Anfrage für <strong>${listing.title}</strong> gestellt. Die Zahlung ist bereits eingegangen — bei einer Ablehnung wird sie automatisch vollständig erstattet.`,
          `Bitte nimm die Anfrage im Dashboard an oder lehne sie ab. Für Rückfragen oder einen Gegenvorschlag nutze den Chat.`,
        ],
    details: hostDetails,
    cta: {
      label: isInstant ? 'Buchung im Dashboard öffnen' : 'Anfrage öffnen: Annehmen / Ablehnen',
      url: `${siteUrl}/dashboard/bookings`,
    },
    secondaryCta: { label: `Mit ${guestName} chatten`, url: `${siteUrl}/dashboard/chat` },
  })

  return sendViaResend(
    hostEmail,
    isInstant
      ? `✅ Neue Buchung: ${listing.title} · ${zeitraum}`
      : `🔔 Neue Anfrage: ${listing.title} · ${zeitraum}`,
    html
  )
}

/**
 * Guest cancellation confirmation — sent whenever a direct TRIMOSA booking is
 * cancelled: guest cancels (refund per policy), host declines a request
 * (always full refund) or a refund is issued from the Stripe dashboard.
 * External channel bookings (Airbnb/Booking) have no guest account here —
 * their platform sends its own mails, so this quietly no-ops for them.
 * `refunded` is the EUR amount actually refunded (0 = none).
 */
export async function sendBookingCancelledEmail(bookingId: string, opts: { refunded?: number; declined?: boolean } = {}) {
  const loaded = await loadBooking(bookingId)
  if (!loaded) return { ok: false, error: 'Buchung nicht gefunden' }
  const { booking, listing, details } = loaded
  if (!booking.guest_id) return { ok: false, error: 'Externe Buchung ohne Gast-Konto' }

  const { data: guestData } = await supabaseAdmin.auth.admin.getUserById(booking.guest_id)
  const guestEmail = guestData?.user?.email
  if (!guestEmail) return { ok: false, error: 'Keine Gast-E-Mail gefunden' }
  const rawName = (guestData?.user?.user_metadata?.name as string | undefined) ?? ''
  const firstName = rawName.trim().split(/\s+/)[0] || ''

  const refunded = opts.refunded ?? 0
  const declined = !!opts.declined
  const lang: UiLang = isUiLang(booking.guest_lang) ? booking.guest_lang : 'de'

  const P_CANCEL = 'hiermit bestätigen wir die Stornierung deiner Buchung für <strong>{titel}</strong>. Der Zeitraum ist damit wieder freigegeben.'
  const P_DECLINED = 'leider können wir deine Anfrage für <strong>{titel}</strong> für den gewünschten Zeitraum nicht bestätigen. Deine Buchung wurde storniert.'
  const P_REFUND = 'Die Erstattung von <strong>{betrag}</strong> wurde bereits veranlasst und erscheint in der Regel innerhalb von 5–10 Werktagen auf deiner Zahlungsmethode.'
  const P_NOREFUND = 'Gemäß der für diese Buchung geltenden Stornierungsbedingungen war leider keine Erstattung möglich.'
  const NOTE = 'Wir würden uns freuen, dich ein anderes Mal bei uns begrüßen zu dürfen. Bei Fragen erreichst du uns jederzeit über den Chat in deinem Gast-Bereich.'
  const T = await makeTr(lang, lang === 'de' ? [] : [
    'Hallo', 'Deine Buchung wurde storniert', 'Stornierungsbestätigung',
    'Deine Stornierung für {titel} ist bestätigt.',
    P_CANCEL, P_DECLINED, P_REFUND, P_NOREFUND, NOTE,
    'Unterkünfte entdecken', 'Erstattung',
    'Unterkunft', 'Anreise', 'Abreise', 'Gäste', 'Gesamtpreis',
  ])
  const anrede = firstName ? `${T('Hallo')} ${firstName},` : `${T('Hallo')},`

  const paragraphs = [anrede, (declined ? T(P_DECLINED) : T(P_CANCEL)).replace('{titel}', listing.title)]
  if (refunded > 0) {
    paragraphs.push(T(P_REFUND).replace('{betrag}', `€ ${refunded.toFixed(2)}`))
  } else if (booking.payment_status === 'paid') {
    paragraphs.push(T(P_NOREFUND))
  }

  const trDetails = details.map((d) => ({
    ...d,
    label: T(d.label),
    value: (d.label === 'Anreise' || d.label === 'Abreise') && lang !== 'de'
      ? formatDateLong(d.label === 'Anreise' ? booking.check_in : booking.check_out, lang)
      : d.value,
  }))
  if (refunded > 0) trDetails.push({ label: T('Erstattung'), value: `€ ${refunded.toFixed(2)}` })

  const html = renderEmail({
    preheader: T('Deine Stornierung für {titel} ist bestätigt.').replace('{titel}', listing.title),
    heading: T('Deine Buchung wurde storniert'),
    paragraphs,
    details: trDetails,
    cta: { label: T('Unterkünfte entdecken'), url: siteUrl },
    note: T(NOTE),
  })

  return sendViaResend(guestEmail, `${T('Stornierungsbestätigung')}: ${listing.title}`, html)
}

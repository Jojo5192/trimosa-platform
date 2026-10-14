// server-only (Kommentar-Konvention §243 — kein 'server-only'-Package installiert)
import { supabaseAdmin } from '@/lib/supabase-admin'
import { stripe, toCents } from '@/lib/stripe'

/**
 * 💶 Zahlungen außerhalb der Website-Buchung (Pascal, Chefsache 5./6.10.2026):
 *  1. Zahllink für Extras direkt aus dem Gäste-Chat (Zusatzgast, Haustier, Late Check-out …) — Stripe Payment
 *     Link, einmal bezahlbar, läuft nicht ab. Jedes Team-Mitglied (Admin/Gastgeber/Mitarbeiter) darf ihn erstellen.
 *  2. Verlängerung des Aufenthalts über die Gästemappe — Live-Verfügbarkeit + Preis aus Smoobu, Bezahlung per
 *     Stripe Checkout. Inhaber-Entscheid 14.10.: Die Zusatznächte werden nach der Zahlung als EIGENE Direktbuchung
 *     in Smoobu angelegt (gleicher Gast, direkt anschließend) — Airbnb/Booking/FeWo-Buchungen lassen sich über
 *     Smoobu nicht verlängern. Die Zusatzbuchung bekommt ihren eigenen Türcode (bewährter Weg über ensureDoorCode);
 *     die Mappe der ursprünglichen Buchung zeigt ihn an.
 *
 * Zustand ohne Migration in app_settings:
 *   zahllinks:<bookingId>  → [{ id, url, betrag, zweck, text, von, at, status, bezahltAm }]
 *   verlaengerungen        → { <ursprungsBuchung>: [{ extId, von, bis, naechte, preis, sessionId, at }] }
 */

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa.de'
export const VERLAENGERUNG_MAX_NAECHTE = 14

export const ZAHL_ZWECKE = ['Zusatzgast', 'Haustier', 'Late Check-out', 'Early Check-in', 'Zusatzleistung', 'Sonstiges'] as const

export interface Zahllink {
  id: string; url: string; betrag: number; zweck: string; text: string | null
  von: string | null; at: string; status: 'offen' | 'bezahlt' | 'deaktiviert'; bezahltAm?: string | null
  /** sevdesk-Rechnung nach der Zahlung (7 %, lib/sevdesk-engine.ts createSevZusatzRechnung) */
  rechnung?: { sevdeskId?: string | null; number?: string | null; fehler?: string | null } | null
}

export interface VerlaengerungEintrag {
  extId: string | null; von: string; bis: string; naechte: number; preis: number; sessionId: string; at: string
}

/* ── app_settings-Helfer ─────────────────────────────────── */

async function leseSetting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', key).maybeSingle()
  return (data?.value as T | undefined) ?? fallback
}
async function schreibeSetting(key: string, value: unknown): Promise<void> {
  const { error } = await supabaseAdmin.from('app_settings').upsert({ key, value }, { onConflict: 'key' })
  if (error) throw new Error(`app_settings ${key}: ${error.message}`)
}

function addTage(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function fmtEuro(n: number): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

/* ── Buchung laden ───────────────────────────────────────── */

interface BuchungZeile {
  id: string; listing_id: string | null; guest_id: string | null; guest_name: string | null; guest_email: string | null
  check_in: string; check_out: string; adults: number | null; children: number | null; status: string
  portal_token: string | null; channel: string | null; source: string | null
  listings: { id: string; title: string | null; smoobu_id: string | number | null; host_id: string | null } | null
}

export async function ladeBuchung(bookingId: string): Promise<BuchungZeile | null> {
  const { data } = await supabaseAdmin
    .from('bookings')
    .select('id, listing_id, guest_id, guest_name, guest_email, check_in, check_out, adults, children, status, portal_token, channel, source, listings(id, title, smoobu_id, host_id)')
    .eq('id', bookingId).maybeSingle()
  if (!data) return null
  const l = Array.isArray(data.listings) ? data.listings[0] : data.listings
  return { ...(data as unknown as BuchungZeile), listings: (l ?? null) as BuchungZeile['listings'] }
}

export function mappeUrl(b: { portal_token: string | null }): string | null {
  return b.portal_token ? `${SITE}/mappe/${b.portal_token}` : null
}

/* ── 1. Zahllink für Extras ──────────────────────────────── */

export async function listeZahllinks(bookingId: string): Promise<Zahllink[]> {
  return leseSetting<Zahllink[]>(`zahllinks:${bookingId}`, [])
}

export async function erstelleZahllink(input: {
  bookingId: string; betrag: number; zweck: string; text?: string | null; von: string
}): Promise<Zahllink> {
  const b = await ladeBuchung(input.bookingId)
  if (!b) throw new Error('Buchung nicht gefunden')
  if (b.status === 'cancelled') throw new Error('Die Buchung ist storniert')
  const betrag = Math.round(input.betrag * 100) / 100
  if (!(betrag >= 1 && betrag <= 5000)) throw new Error('Betrag muss zwischen 1 und 5.000 € liegen')
  const zweck = String(input.zweck || 'Zusatzleistung').slice(0, 60)
  const text = input.text?.trim() ? input.text.trim().slice(0, 200) : null
  const wohnung = b.listings?.title ?? 'Unterkunft'

  const price = await stripe.prices.create({
    currency: 'eur',
    unit_amount: toCents(betrag),
    product_data: { name: `${zweck} · ${wohnung}` },
  })
  const meta = { kind: 'extra', bookingId: b.id, zweck, von: input.von.slice(0, 40) }
  const danke = mappeUrl(b)
  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: meta,
    payment_intent_data: { metadata: meta, description: `${zweck} · ${wohnung} · ${b.guest_name ?? 'Gast'}` },
    // einmal bezahlbar — danach ist der Link für weitere Zahlungen gesperrt
    restrictions: { completed_sessions: { limit: 1 } },
    after_completion: danke
      ? { type: 'redirect', redirect: { url: `${danke}?bezahlt=1` } }
      : { type: 'hosted_confirmation', hosted_confirmation: { custom_message: 'Vielen Dank — deine Zahlung ist eingegangen.' } },
    ...(text ? { custom_text: { submit: { message: text } } } : {}),
  })

  const eintrag: Zahllink = {
    id: link.id, url: link.url, betrag, zweck, text, von: input.von.slice(0, 40),
    at: new Date().toISOString(), status: 'offen', bezahltAm: null,
  }
  const liste = await listeZahllinks(b.id)
  await schreibeSetting(`zahllinks:${b.id}`, [eintrag, ...liste].slice(0, 30))
  return eintrag
}

/* ── 2. Verlängerung ─────────────────────────────────────── */

export interface VerlaengerungAngebot {
  ok: boolean
  grund?: string
  naechte: number
  von: string
  bis: string
  preis: number
  preisProNacht: number
}

/**
 * Angebot für `naechte` Zusatznächte direkt im Anschluss an die Buchung — Preis wie auf der Website
 * (Smoobu-Quote personengenau × Aufschlag des Gastgebers). Die Mindestaufenthaltsdauer gilt für eine
 * Verlängerung nicht (der Gast ist schon da): meldet das Quote nur deshalb „nicht verfügbar", entscheidet
 * die Tages-Verfügbarkeit.
 */
export async function verlaengerungAngebot(bookingId: string, naechteRoh: number): Promise<VerlaengerungAngebot> {
  const naechte = Math.max(1, Math.min(VERLAENGERUNG_MAX_NAECHTE, Math.round(Number(naechteRoh) || 1)))
  const b = await ladeBuchung(bookingId)
  const leer = (grund: string, von = '', bis = ''): VerlaengerungAngebot => ({ ok: false, grund, naechte, von, bis, preis: 0, preisProNacht: 0 })
  if (!b) return leer('Buchung nicht gefunden')
  if (b.status !== 'confirmed') return leer('Die Buchung ist nicht bestätigt')
  const von = b.check_out
  const bis = addTage(von, naechte)
  const heute = new Date().toISOString().slice(0, 10)
  if (von < heute) return leer('Der Aufenthalt ist bereits beendet', von, bis)
  const smoobuId = b.listings?.smoobu_id
  if (!smoobuId) return leer('Für diese Wohnung ist keine Online-Verlängerung möglich', von, bis)

  const { getQuote, checkAvailability } = await import('@/lib/smoobu')
  const { getMarkupMultiplier } = await import('@/lib/pricing')
  const personen = (Number(b.adults) || 1) + (Number(b.children) || 0)
  let q = await getQuote(String(smoobuId), von, bis, personen)
  if (!q.available && q.minStayViolation) {
    const r = await checkAvailability(String(smoobuId), von, bis)
    q = { ...r, guestsUsed: null }
  }
  if (!q.available || !(q.totalPrice > 0)) return leer('Die Wohnung ist in diesem Zeitraum leider schon belegt', von, bis)

  // Belegung in UNSERER Datenbank zusätzlich prüfen (Smoobu-Kalender kann Sekunden hinterherhinken)
  if (b.listing_id) {
    const { data: kollision } = await supabaseAdmin
      .from('bookings').select('id')
      .eq('listing_id', b.listing_id).eq('status', 'confirmed').neq('id', b.id)
      .lt('check_in', bis).gt('check_out', von).limit(1)
    if (kollision?.length) return leer('Die Wohnung ist in diesem Zeitraum leider schon belegt', von, bis)
  }

  const markup = await getMarkupMultiplier(b.listings?.host_id ?? undefined)
  const preis = Math.round(q.totalPrice * markup)
  return { ok: true, naechte, von, bis, preis, preisProNacht: Math.round((preis / naechte) * 100) / 100 }
}

/** Stripe Checkout für eine Verlängerung — Angebot wird HIER neu berechnet (nie Preis vom Client übernehmen). */
export async function erstelleVerlaengerungCheckout(bookingId: string, naechte: number): Promise<{ url: string } | { fehler: string }> {
  const b = await ladeBuchung(bookingId)
  if (!b) return { fehler: 'Buchung nicht gefunden' }
  const a = await verlaengerungAngebot(bookingId, naechte)
  if (!a.ok) return { fehler: a.grund ?? 'Verlängerung nicht möglich' }
  const zurueck = mappeUrl(b) ?? SITE
  const wohnung = b.listings?.title ?? 'Unterkunft'
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'eur',
        unit_amount: toCents(a.preis),
        product_data: { name: `Verlängerung · ${wohnung}`, description: `${a.naechte} ${a.naechte === 1 ? 'Nacht' : 'Nächte'} · ${a.von} – ${a.bis}` },
      },
      quantity: 1,
    }],
    metadata: { kind: 'verlaengerung', bookingId: b.id, von: a.von, bis: a.bis, naechte: String(a.naechte), preis: String(a.preis) },
    payment_intent_data: { metadata: { kind: 'verlaengerung', bookingId: b.id }, description: `Verlängerung ${wohnung} · ${b.guest_name ?? 'Gast'} · ${a.von}–${a.bis}` },
    customer_email: b.guest_email && !/@(guest\.airbnb|messages\.homeaway|guest\.booking)\./i.test(b.guest_email) ? b.guest_email : undefined,
    success_url: `${zurueck}?verlaengert=1`,
    cancel_url: `${zurueck}#verlaengern`,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  })
  if (!session.url) return { fehler: 'Die Zahlung konnte nicht gestartet werden' }
  return { url: session.url }
}

export async function verlaengerungenVon(bookingId: string): Promise<VerlaengerungEintrag[]> {
  const alle = await leseSetting<Record<string, VerlaengerungEintrag[]>>('verlaengerungen', {})
  return alle[bookingId] ?? []
}

/** Für die Auto-Nachrichten: Ursprungs-Buchungen mit Verlängerung und die Zusatzbuchungen selbst. */
export async function verlaengerungsIndex(): Promise<{ urspruenge: Set<string>; zusaetze: Set<string> }> {
  const alle = await leseSetting<Record<string, VerlaengerungEintrag[]>>('verlaengerungen', {}).catch(() => ({} as Record<string, VerlaengerungEintrag[]>))
  const urspruenge = new Set<string>()
  const zusaetze = new Set<string>()
  for (const [orig, liste] of Object.entries(alle)) {
    if (!liste?.length) continue
    urspruenge.add(orig)
    for (const e of liste) if (e.extId) zusaetze.add(e.extId)
  }
  return { urspruenge, zusaetze }
}

/** Für die Auto-Nachrichten: Zusatzbuchung → Ursprungsbuchung (Ketten aufgelöst bis zum Anfang). */
export async function verlaengerungsUrsprung(): Promise<Map<string, string>> {
  const alle = await leseSetting<Record<string, VerlaengerungEintrag[]>>('verlaengerungen', {})
  const direkt = new Map<string, string>()
  for (const [orig, liste] of Object.entries(alle)) for (const e of liste ?? []) if (e.extId) direkt.set(e.extId, orig)
  const out = new Map<string, string>()
  for (const ext of direkt.keys()) {
    let cur = direkt.get(ext) as string
    for (let i = 0; i < 10 && direkt.has(cur); i++) cur = direkt.get(cur) as string
    out.set(ext, cur)
  }
  return out
}

/** Für Kalender/Reinigungsplan: Ursprungsbuchung → spätestes Ende aller Verlängerungen; Zusatzbuchungen ausblenden. */
export async function verlaengerungsKarte(): Promise<{ bis: Map<string, string>; zusaetze: Set<string> }> {
  const alle = await leseSetting<Record<string, VerlaengerungEintrag[]>>('verlaengerungen', {})
  const zusaetze = new Set<string>()
  for (const liste of Object.values(alle)) for (const e of liste ?? []) if (e.extId) zusaetze.add(e.extId)
  // Ende einer Buchung inkl. Ketten (eine Zusatzbuchung kann selbst wieder verlängert werden)
  const ende = (id: string, tiefe = 0): string | null => {
    let best: string | null = null
    for (const e of alle[id] ?? []) {
      if (!e.extId) continue
      const weiter = tiefe < 10 ? ende(e.extId, tiefe + 1) : null
      const kandidat = weiter && weiter > e.bis ? weiter : e.bis
      if (!best || kandidat > best) best = kandidat
    }
    return best
  }
  const bis = new Map<string, string>()
  for (const orig of Object.keys(alle)) {
    if (zusaetze.has(orig)) continue // nur Kettenanfänge bekommen das Gesamt-Ende
    const e = ende(orig)
    if (e) bis.set(orig, e)
  }
  return { bis, zusaetze }
}

/* ── Webhook: bezahlte Zahllinks und Verlängerungen verbuchen ── */

async function interneNotiz(bookingId: string, text: string): Promise<void> {
  // Präfix 💶 = nur fürs Team (Gast-Routen filtern es wie ☎️-Notizen heraus)
  const { error } = await supabaseAdmin.from('messages').insert({ booking_id: bookingId, sender_type: 'host', content: text, lang: 'de' })
  if (error) console.error('[zahlungen] Notiz nicht gespeichert:', error.message)
}

/**
 * Zahlungsbestätigung AN DEN GAST — Inhaber-Entscheid 14.10.2026: automatisch. Geht über den normalen Gast-Kanal
 * der (Ursprungs-)Buchung (Smoobu-Thread bzw. E-Mail-Brücke, übersetzt in die Gastsprache — lib/voice.ts).
 * Scheitert die Zustellung, steht eine interne Notiz im Thread; die Zahlung selbst ist davon unberührt.
 */
async function bestaetigeGast(bookingId: string, textDe: string): Promise<void> {
  try {
    const { deliverToGuest } = await import('@/lib/voice')
    const r = await deliverToGuest(bookingId, textDe, { testMode: false })
    console.log('[zahlungen] Bestätigung an den Gast:', bookingId.slice(0, 8), r.delivery)
  } catch (e) {
    console.error('[zahlungen] Bestätigung an den Gast fehlgeschlagen:', e)
  }
}

const WOCHENTAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
function tagUndDatum(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${WOCHENTAG[new Date(`${iso}T12:00:00Z`).getUTCDay()]}, ${d}.${m}.${y}`
}

async function teamPush(titel: string, text: string, bookingId: string): Promise<void> {
  try {
    const { sendPushToTeam } = await import('@/lib/push')
    await sendPushToTeam(titel, text, `/team?conv=${bookingId}`, { guestChat: true })
  } catch (e) { console.error('[zahlungen] Push:', e) }
}

/** Zahllink bezahlt (checkout.session.completed mit payment_link). Idempotent über den Status im Eintrag. */
export async function verbucheZahllink(session: { id: string; payment_link?: string | { id: string } | null; amount_total?: number | null }): Promise<'ok' | 'unbekannt' | 'schon'> {
  const linkId = typeof session.payment_link === 'string' ? session.payment_link : session.payment_link?.id
  if (!linkId) return 'unbekannt'
  const link = await stripe.paymentLinks.retrieve(linkId)
  const meta = (link.metadata ?? {}) as Record<string, string>
  if (meta.kind !== 'extra' || !meta.bookingId) return 'unbekannt'
  const liste = await listeZahllinks(meta.bookingId)
  const e = liste.find((x) => x.id === linkId)
  // Stripe-Wiederholung: schon verbucht — nur eine fehlende Rechnung nachholen
  if (e?.status === 'bezahlt' && e.rechnung?.sevdeskId) return 'schon'
  const schonBezahlt = e?.status === 'bezahlt'
  const betrag = typeof session.amount_total === 'number' ? session.amount_total / 100 : e?.betrag ?? 0
  const zweck = meta.zweck ?? 'Zusatzleistung'
  if (e && !schonBezahlt) { e.status = 'bezahlt'; e.bezahltAm = new Date().toISOString() }
  await schreibeSetting(`zahllinks:${meta.bookingId}`, liste)
  await stripe.paymentLinks.update(linkId, { active: false }).catch(() => {})

  // 🧾 Rechnung (7 %) — scheitert sie, bleibt die Zahlung gültig; Team wird informiert
  let rechnungNr: string | null = null
  try {
    const { createSevZusatzRechnung } = await import('@/lib/sevdesk-engine')
    const r = await createSevZusatzRechnung({ bookingId: meta.bookingId, betrag, zweck, text: e?.text ?? null })
    if (e) e.rechnung = r.ok ? { sevdeskId: r.sevdeskId ?? null, number: r.number ?? null } : { fehler: r.error ?? r.skipped ?? 'unbekannt' }
    rechnungNr = r.ok ? r.number ?? null : null
    if (!r.ok) await teamPush('⚠️ Rechnung für Zahllink fehlt', `${zweck} ${fmtEuro(betrag)}: ${String(r.error ?? r.skipped ?? '').slice(0, 100)} — bitte in sevdesk anlegen`, meta.bookingId)
  } catch (err) {
    if (e) e.rechnung = { fehler: String(err instanceof Error ? err.message : err).slice(0, 200) }
    console.error('[zahlungen] Zusatz-Rechnung:', err)
  }
  await schreibeSetting(`zahllinks:${meta.bookingId}`, liste)
  if (schonBezahlt) return 'schon'

  const b = await ladeBuchung(meta.bookingId)
  const vorname = String(b?.guest_name ?? 'Gast').trim().split(/\s+/)[0] || 'Gast'
  await interneNotiz(meta.bookingId, `💶 Zahlung eingegangen: ${fmtEuro(betrag)} — ${zweck}${meta.von ? ` (Link von ${meta.von})` : ''}${rechnungNr ? ` · Rechnung ${rechnungNr}` : ''} · Bestätigung an den Gast geht automatisch raus`)
  await teamPush(`💶 ${vorname} hat bezahlt · ${fmtEuro(betrag)}`, `${zweck}${b?.listings?.title ? ` · ${b.listings.title}` : ''}`, meta.bookingId)
  const mappe = b ? mappeUrl(b) : null
  await bestaetigeGast(meta.bookingId,
    `Hallo ${vorname}, danke dir — deine Zahlung über ${fmtEuro(betrag)} für ${zweck} ist eingegangen.${rechnungNr && mappe ? ` Die Rechnung findest du in deiner Gästemappe: ${mappe}#mb-rechnung` : ''}`)
  return 'ok'
}

/**
 * Verlängerung bezahlt: Zusatzbuchung anlegen (erst in UNSERER Datenbank — der Doppelbuchungs-Schutz greift — dann in
 * Smoobu; das Smoobu-Echo wird von lib/overbooking.ts als eigene Buchung erkannt). Kollidiert der Zeitraum inzwischen,
 * wird die Zahlung automatisch erstattet. Idempotent über die Session-ID.
 */
export async function verbucheVerlaengerung(session: {
  id: string; metadata?: Record<string, string> | null; payment_intent?: string | { id: string } | null; amount_total?: number | null
}): Promise<'ok' | 'schon' | 'erstattet' | 'fehler'> {
  const m = session.metadata ?? {}
  const bookingId = m.bookingId
  if (!bookingId || !m.von || !m.bis) return 'fehler'
  const alle = await leseSetting<Record<string, VerlaengerungEintrag[]>>('verlaengerungen', {})
  if ((alle[bookingId] ?? []).some((e) => e.sessionId === session.id)) return 'schon'

  const b = await ladeBuchung(bookingId)
  if (!b || !b.listing_id) return 'fehler'
  const preis = typeof session.amount_total === 'number' ? session.amount_total / 100 : Number(m.preis) || 0
  const naechte = Number(m.naechte) || 1
  const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null
  const vorname = String(b.guest_name ?? 'Gast').trim().split(/\s+/)[0] || 'Gast'
  const wohnung = b.listings?.title ?? 'Wohnung'

  const { data: ext, error: insErr } = await supabaseAdmin.from('bookings').insert({
    listing_id: b.listing_id,
    guest_id: b.guest_id,
    guest_name: b.guest_name,
    guest_email: b.guest_email,
    check_in: m.von,
    check_out: m.bis,
    adults: b.adults,
    children: b.children ?? 0,
    total_price: preis,
    status: 'confirmed',
    payment_status: 'paid',
    paid_at: new Date().toISOString(),
    stripe_payment_intent_id: piId,
    stripe_checkout_session_id: session.id,
    source: 'trimosa',
    booking_type: 'instant',
    channel: 'Verlängerung',
    message: `Verlängerung der Buchung ${b.id.slice(0, 8)} (${b.check_in}–${b.check_out})`,
  }).select('id').single()

  if (insErr || !ext) {
    console.error('[zahlungen] Verlängerung nicht anlegbar:', bookingId, insErr?.message)
    // Zeitraum inzwischen belegt (Doppelbuchungs-Schutz) → Geld zurück, Team informieren
    if (piId && /exclusion|overlap|conflict/i.test(insErr?.message ?? '')) {
      await stripe.refunds.create({ payment_intent: piId, reason: 'requested_by_customer' }).catch((e) => console.error('[zahlungen] Erstattung:', e))
      await interneNotiz(bookingId, `💶 Verlängerung ${m.von}–${m.bis} konnte nicht gebucht werden (inzwischen belegt) — ${fmtEuro(preis)} automatisch erstattet, der Gast bekommt automatisch Bescheid.`)
      await teamPush(`⚠️ Verlängerung belegt · ${vorname}`, `${wohnung} ${m.von}–${m.bis}: Zahlung automatisch erstattet, Gast informiert`, bookingId)
      await bestaetigeGast(bookingId,
        `Hallo ${vorname}, leider war die Wohnung für die gewünschten zusätzlichen Nächte inzwischen schon vergeben. Wir haben dir die ${fmtEuro(preis)} sofort erstattet — je nach Bank ist der Betrag in wenigen Tagen wieder auf deinem Konto. Melde dich gern, falls wir eine andere Lösung finden sollen.`)
      return 'erstattet'
    }
    await teamPush(`⚠️ Verlängerung bezahlt, aber nicht angelegt · ${vorname}`, `${wohnung} ${m.von}–${m.bis} (${fmtEuro(preis)}): bitte von Hand in Smoobu anlegen — ${String(insErr?.message ?? '').slice(0, 80)}`, bookingId)
    return 'fehler'
  }

  // Verlängerung vermerken, BEVOR Smoobu läuft (Idempotenz bei Stripe-Wiederholung)
  alle[bookingId] = [...(alle[bookingId] ?? []), { extId: String(ext.id), von: m.von, bis: m.bis, naechte, preis, sessionId: session.id, at: new Date().toISOString() }]
  await schreibeSetting('verlaengerungen', alle)

  // In Smoobu anlegen (Zugangsdaten des Gastgebers wie bei der Website-Buchung)
  let smoobuHinweis = ''
  try {
    const smoobuApt = Number(b.listings?.smoobu_id)
    if (!Number.isFinite(smoobuApt) || smoobuApt <= 0) throw new Error('Wohnung ohne Smoobu-ID')
    const { data: host } = await supabaseAdmin.from('profiles').select('smoobu_api_key, smoobu_channel_id').eq('id', b.listings?.host_id ?? '').maybeSingle()
    const h = (host ?? {}) as { smoobu_api_key?: string | null; smoobu_channel_id?: number | null }
    const teile = String(b.guest_name ?? 'Gast').trim().split(/\s+/)
    const { createReservation } = await import('@/lib/smoobu')
    const smoobuResId = await createReservation({
      smoobuApartmentId: smoobuApt,
      arrivalDate: m.von,
      departureDate: m.bis,
      firstName: teile[0] || 'Gast',
      lastName: teile.slice(1).join(' ') || teile[0] || 'Gast',
      email: b.guest_email || 'mail@trimosa.de',
      adults: b.adults ?? 1,
      children: b.children ?? 0,
      price: preis,
      notice: `TRIMOSA-Verlängerung von Buchung ${b.id.slice(0, 8)} (${b.check_in}–${b.check_out}) · bezahlt per Stripe`,
      apiKey: h.smoobu_api_key ?? undefined,
      channelId: h.smoobu_channel_id ?? undefined,
    })
    await supabaseAdmin.from('bookings').update({ smoobu_reservation_id: smoobuResId }).eq('id', ext.id).is('smoobu_reservation_id', null)
  } catch (e) {
    console.error('[zahlungen] Smoobu-Anlage der Verlängerung:', e)
    smoobuHinweis = ' ⚠️ In Smoobu NICHT angelegt — bitte von Hand eintragen (Kalender sonst offen für Fremdbuchungen).'
  }

  await interneNotiz(bookingId, `💶 Verlängert bis ${m.bis} (${naechte} ${naechte === 1 ? 'Nacht' : 'Nächte'}, ${fmtEuro(preis)} bezahlt) — eigene Zusatzbuchung mit eigenem Türcode, die Mappe zeigt ihn an; Rechnung entsteht am ${m.von} automatisch. Bestätigung an den Gast geht automatisch raus.${smoobuHinweis}`)
  await teamPush(`💶 Verlängerung bezahlt · ${vorname}`, `${wohnung} bis ${m.bis} · ${fmtEuro(preis)}${smoobuHinweis ? ' · Smoobu von Hand!' : ''}`, bookingId)
  const mappe = mappeUrl(b)
  await bestaetigeGast(bookingId,
    `Hallo ${vorname}, danke dir — deine Verlängerung ist gebucht: Du bleibst jetzt bis ${tagUndDatum(m.bis)} (${naechte} ${naechte === 1 ? 'zusätzliche Nacht' : 'zusätzliche Nächte'}, ${fmtEuro(preis)} bezahlt).${mappe ? ` Deinen Türcode für die zusätzlichen Nächte und später die Rechnung findest du in deiner Gästemappe: ${mappe}#verlaengern` : ''}`)
  return 'ok'
}

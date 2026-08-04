import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * ☎️ Anrufbot-Werkzeuge (§175 Phase 2): Diese Lib versorgt die
 * /api/voice/*-Routen, die der ElevenLabs-Agent als Webhook-Tools
 * während eines Telefonats aufruft. Auth über VOICE_TOOL_SECRET
 * (Bearer) — der Wert steht auch in der Tool-Konfiguration des Agenten.
 */

/** Push an die Bereitschaft (§175/§183, geteilt seit §227) — explizite Liste
    = NUR diese Personen (übersteuert bewusst stummgeschaltete Gäste-Chat-
    Präferenzen: Wer Dienst hat, bekommt den Anruf). Leere Liste = Fallback
    Admins/Gastgeber/Mitarbeiter — NIE Dienstleister (§183). */
export async function pushOncall(title: string, body: string, url: string): Promise<void> {
  const { sendPushToUser } = await import('@/lib/push')
  const { getOncallIds } = await import('@/lib/oncall')
  let ids = await getOncallIds()
  if (!ids.length) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .or('is_admin.eq.true,is_host.eq.true,is_staff.eq.true')
    ids = (data ?? []).map((p) => String(p.id))
  }
  await Promise.all(ids.map((id) => sendPushToUser(id, title, body, url).catch(() => {})))
}

export function requireVoiceAuth(request: Request): Response | null {
  const secret = process.env.VOICE_TOOL_SECRET
  if (!secret) {
    return Response.json({ error: 'VOICE_TOOL_SECRET nicht konfiguriert' }, { status: 503 })
  }
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Nicht berechtigt' }, { status: 401 })
  }
  return null
}

/** Ziffern-Normalisierung: "+49 (0)151 234-5678" → "491512345678" */
export function normalizePhone(raw: string): string {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  return d
}

/** Match-Schlüssel = letzte 9 Ziffern (übersteht Vorwahl-/Formatvarianten) */
function phoneKey(raw: string): string {
  return normalizePhone(raw).slice(-9)
}

/** Akzente/Umlaute falten + lowercase — „Edmée" → „edmee", „Müller" → „muller" */
export function foldName(s: string): string {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (!m || !n) return Math.max(m, n)
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

/**
 * Fuzzy-Namensvergleich (§188): Die Spracherkennung verstümmelt Namen
 * massiv („Bozma" ↔ „Bootsma", „Edmes" ↔ „Edmée") — ein Kandidaten-Token
 * zählt als Treffer, wenn er als Substring vorkommt ODER zu einem
 * Namens-Token eine kleine Edit-Distanz hat (≤1 ab 4, ≤2 ab 6 Zeichen).
 * §181-Policy bleibt: EIN passender Namensteil (Vor- ODER Nachname) reicht.
 */
export function nameLooselyMatches(candidate: string, guestNames: string): boolean {
  const guest = foldName(guestNames).trim()
  if (!guest) return false
  const gTokens = guest.split(/\s+/).filter((t) => t.length >= 3)
  const cTokens = foldName(candidate).split(/\s+/).filter((t) => t.length >= 3)
  return cTokens.some((c) => {
    if (guest.includes(c)) return true
    const tol = c.length >= 6 ? 2 : c.length >= 4 ? 1 : 0
    return tol > 0 && gTokens.some((g) => Math.abs(g.length - c.length) <= tol && levenshtein(c, g) <= tol)
  })
}

/**
 * 🧪 Gehört die Anrufer-Nummer einem TEAM-Mitglied (oder fehlt sie ganz,
 * wie beim Browser-Test in der ElevenLabs-Konsole)? Dann ist der „Anruf"
 * ein TEST — es darf NICHTS an den echten Gast rausgehen (§220: Pascal
 * testete mit einer echten Airbnb-Buchung).
 */
export async function isTeamCaller(callerNumber: string): Promise<boolean> {
  const key = phoneKey(callerNumber)
  if (!key || key.length < 7) return false
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('phone, is_admin, is_host, is_staff, is_provider')
    .not('phone', 'is', null)
  return (data ?? []).some((p) => {
    const team = p.is_admin || p.is_host || p.is_staff || p.is_provider
    return team && phoneKey(String(p.phone ?? '')) === key
  })
}

export type VoiceDelivery = 'smoobu' | 'email' | 'intern' | 'none'

/**
 * 📨 §220: DER EINE WEG, wie der Anrufbot Nachrichten an Gäste bringt.
 * Vorher legten die Voice-Routen nur eine messages-Zeile an — die sah im
 * Team-Chat wie eine gesendete Host-Nachricht aus, erreichte den Gast aber
 * NIE (kein Smoobu-Push, keine Mail, keine Übersetzung).
 *
 * Jetzt: Testmodus → interne Notiz (☎️-Präfix, für Gäste gefiltert, im
 * Team-Chat als graue Notiz erkennbar). Echter Anruf → Text in die
 * Gastsprache übersetzen und über den normalen Kanal zustellen
 * (Smoobu → Portal-Chat; sonst E-Mail-Brücke), Zeile wie bei jeder
 * Team-Antwort (content = gesendete Fassung, content_de = Original).
 */
export async function deliverToGuest(
  bookingId: string,
  textDe: string,
  opts: { testMode: boolean },
): Promise<{ delivery: VoiceDelivery; detail?: string }> {
  const note = async (content: string): Promise<void> => {
    await supabaseAdmin.from('messages').insert({
      booking_id: bookingId, sender_type: 'host', content, lang: 'de',
    })
  }

  if (opts.testMode) {
    await note(`☎️ TEST-Anruf (NICHT an den Gast gesendet):\n${textDe}`)
    return { delivery: 'intern', detail: 'Testmodus — nur interne Notiz' }
  }

  const { data: b } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_id, guest_name, guest_email, guest_lang, smoobu_reservation_id, listings(title)')
    .eq('id', bookingId)
    .maybeSingle() as { data: {
      id: string; guest_id: string | null; guest_name: string | null; guest_email: string | null
      guest_lang: string | null; smoobu_reservation_id: number | string | null
      listings: { title: string | null } | null
    } | null }
  if (!b) return { delivery: 'none', detail: 'Buchung nicht gefunden' }

  // Gastsprache + Übersetzung — identisch zur Auto-Nachrichten-Engine
  let lang = 'de'
  let text = textDe
  try {
    const { guestLangFor } = await import('@/lib/auto-messages-engine')
    lang = await guestLangFor({ id: b.id, guest_id: b.guest_id, guest_lang: b.guest_lang })
    if (lang !== 'de') {
      const { translateOutgoing } = await import('@/lib/translate')
      text = (await translateOutgoing(textDe, lang)) ?? textDe
    }
  } catch (e) {
    console.error('[voice-deliver] Übersetzung fehlgeschlagen:', e)
    lang = 'de'; text = textDe
  }

  const row = {
    booking_id: bookingId, sender_type: 'host', content: text,
    content_de: lang !== 'de' ? textDe : null, lang,
  }

  // 1) Portal-Chat über Smoobu (Airbnb/Booking/FeWo)
  if (b.smoobu_reservation_id) {
    try {
      const { sendMessageToGuest } = await import('@/lib/smoobu')
      const push = await sendMessageToGuest(Number(b.smoobu_reservation_id), text)
      if (push.sent) {
        await supabaseAdmin.from('messages').insert({
          ...row, ...(push.id != null ? { smoobu_message_id: String(push.id) } : {}),
        })
        return { delivery: 'smoobu' }
      }
    } catch (e) {
      console.error('[voice-deliver] Smoobu-Push fehlgeschlagen:', e)
    }
  }

  // 2) E-Mail-Brücke (§140) — FeWo-Relay bzw. Login-Mail des Gast-Kontos
  let to = (b.guest_email ?? '').trim() || null
  if (!to && b.guest_id) {
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(b.guest_id)
    to = u?.user?.email ?? null
  }
  if (to) {
    try {
      const { sendGuestChatEmail } = await import('@/lib/email')
      await sendGuestChatEmail({
        to, guestName: b.guest_name, listingTitle: b.listings?.title ?? null, text, lang,
      })
      await supabaseAdmin.from('messages').insert(row)
      return { delivery: 'email', detail: to }
    } catch (e) {
      console.error('[voice-deliver] Gast-Mail fehlgeschlagen:', e)
    }
  }

  // 3) Kein Kanal — ehrlich als interne Notiz festhalten
  await note(`☎️ NICHT ZUSTELLBAR (kein Portal-Chat, keine E-Mail-Adresse):\n${textDe}`)
  return { delivery: 'none', detail: 'kein Kanal' }
}

export interface VoiceBooking {
  id: string
  guestName: string
  listingTitle: string
  checkIn: string
  checkOut: string
  adults: number | null
  children: number | null
  stayStatus: 'laufend' | 'kommend' | 'vergangen'
}

type BRow = {
  id: string
  guest_id: string | null
  guest_name: string | null
  check_in: string
  check_out: string
  adults: number | null
  children: number | null
  listings: { title: string | null } | null
}

/**
 * Buchung über die Anrufer-Nummer finden. Die Telefonnummern liegen NICHT
 * als bookings-Spalte vor, sondern (a) in den Smoobu-Bestätigungs-
 * Nachrichten („Guest Phone Number: +32…") der booking-Threads und
 * (b) bei Website-Gästen in profiles.phone. Durchsucht werden nur
 * relevante Buchungen (confirmed, Abreise ≥ heute−14).
 */
export async function findBookingByPhone(callerNumber: string): Promise<VoiceBooking | null> {
  const key = phoneKey(callerNumber)
  if (key.length < 7) return null

  const today = new Date().toISOString().slice(0, 10)
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)

  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_id, guest_name, check_in, check_out, adults, children, listings(title)')
    .eq('status', 'confirmed')
    .gte('check_out', cutoff)
    .order('check_in', { ascending: true })
    .limit(400)
  const rows = (bookings ?? []) as unknown as BRow[]
  if (!rows.length) return null

  const matchedIds = new Set<string>()

  // (a) Telefonnummern aus den Thread-Nachrichten (Smoobu-Bestätigungen)
  const ids = rows.map((r) => r.id)
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('booking_id, content')
      .in('booking_id', chunk)
      .ilike('content', '%phone%')
      .limit(1000)
    for (const m of msgs ?? []) {
      const content = String(m.content ?? '')
      for (const cand of content.match(/\+?[\d\s\-()/.]{7,}/g) ?? []) {
        const ck = phoneKey(cand)
        if (ck.length >= 7 && (ck === key || key.endsWith(ck) || ck.endsWith(key))) {
          if (m.booking_id) matchedIds.add(String(m.booking_id))
          break
        }
      }
    }
  }

  // (b) Website-Gäste: profiles.phone → guest_id
  try {
    const { data: profs } = await supabaseAdmin
      .from('profiles')
      .select('id, phone')
      .not('phone', 'is', null)
      .limit(1000)
    const guestIds = new Set(
      (profs ?? [])
        .filter((p) => phoneKey(String(p.phone)).length >= 7 && phoneKey(String(p.phone)) === key)
        .map((p) => String(p.id)),
    )
    if (guestIds.size) {
      for (const r of rows) if (r.guest_id && guestIds.has(r.guest_id)) matchedIds.add(r.id)
    }
  } catch { /* best effort */ }

  if (!matchedIds.size) return null

  // Beste Buchung: laufend > nächste kommende > jüngste vergangene
  const matched = rows.filter((r) => matchedIds.has(r.id))
  const running = matched.find((r) => r.check_in <= today && r.check_out >= today)
  const upcoming = matched.find((r) => r.check_in > today)
  const best = running ?? upcoming ?? matched[matched.length - 1]

  return toVoiceBooking(best, today)
}

function toVoiceBooking(b: BRow, today: string): VoiceBooking {
  return {
    id: b.id,
    guestName: String(b.guest_name ?? '').trim(),
    listingTitle: b.listings?.title ?? 'unbekannt',
    checkIn: b.check_in,
    checkOut: b.check_out,
    adults: b.adults,
    children: b.children,
    stayStatus: b.check_in <= today && b.check_out >= today ? 'laufend' : b.check_in > today ? 'kommend' : 'vergangen',
  }
}

/**
 * Buchung aus GESPRÄCHSDATEN finden (§182): Der Anrufer nennt Wohnung,
 * Zeitraum und Namen oft selbst — ohne dass seine Nummer bekannt ist
 * (Browser-Test, fremdes Telefon, unterdrückte Nummer). Konservativ:
 * nur bei EINDEUTIGEM Treffer wird zugeordnet. Fenster reicht 90 Tage
 * in die Vergangenheit (Fundsachen-Anrufe kommen nach der Abreise).
 */
export async function findBookingByDetails(opts: {
  name?: string
  apartment?: string
  arrival?: string
  departure?: string
}): Promise<VoiceBooking | null> {
  const name = String(opts.name ?? '').trim().toLowerCase()
  const apartment = String(opts.apartment ?? '').trim().toLowerCase()
  const arrival = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.arrival ?? '')) ? String(opts.arrival) : ''
  const departure = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.departure ?? '')) ? String(opts.departure) : ''
  // Mindest-Anker: ein Datum ODER Wohnung+Name — sonst wäre jedes Match Raterei
  if (!arrival && !departure && !(apartment && name)) return null

  const today = new Date().toISOString().slice(0, 10)
  const pastCutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)

  const shift = (iso: string, days: number) =>
    new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10)

  // §188: fuzzy statt exakt — ASR-Verhörer („Edmes Läppchen" ↔ „Edmée
  // Sleijpen") dürfen weder Suche noch Entschärfung scheitern lassen
  const nameMatches = (g: string | null): boolean => nameLooselyMatches(name, g ?? '')

  const attempt = async (fuzzyDays: number): Promise<VoiceBooking | null> => {
    let q = supabaseAdmin
      .from('bookings')
      .select('id, guest_id, guest_name, check_in, check_out, adults, children, listings(title, location_group)')
      .eq('status', 'confirmed')
    if (arrival) {
      q = fuzzyDays
        ? q.gte('check_in', shift(arrival, -fuzzyDays)).lte('check_in', shift(arrival, fuzzyDays))
        : q.eq('check_in', arrival)
    } else if (departure) {
      q = fuzzyDays
        ? q.gte('check_out', shift(departure, -fuzzyDays)).lte('check_out', shift(departure, fuzzyDays))
        : q.eq('check_out', departure)
    } else {
      q = q.gte('check_out', pastCutoff)
    }
    const { data } = await q.order('check_in', { ascending: true }).limit(400)
    let rows = (data ?? []) as unknown as BRow[]
    if (arrival && departure) {
      rows = fuzzyDays
        ? rows.filter((r) => r.check_out >= shift(departure, -fuzzyDays) && r.check_out <= shift(departure, fuzzyDays))
        : rows.filter((r) => r.check_out === departure)
    }

    if (apartment) {
      const byApt = rows.filter((r) => {
        // §188: „Wohnung" darf auch der STANDORT sein — Anrufer sagen
        // „ich bin in Sirzenich", nicht „im Cozy Flat"
        const title = foldName(`${r.listings?.title ?? ''} ${(r.listings as { location_group?: string | null } | null)?.location_group ?? ''}`).trim()
        const apt = foldName(apartment)
        if (!title) return false
        if (title.includes(apt) || apt.includes(title)) return true
        const words = apt.split(/\s+/).filter((w) => w.length >= 3)
        return words.length > 0 && words.every((w) => title.includes(w))
      })
      // Mit Datums-Anker ist die Wohnung nur Entschärfer — die Spracherkennung
      // verhört Wohnungsnamen („Cosy" statt „Cozy"), das darf einen eindeutigen
      // Datums-Treffer nicht killen. Ohne Datum bleibt sie Pflicht-Anker.
      if (arrival || departure) { if (byApt.length) rows = byApt }
      else rows = byApt
    }

    // Ohne Datum ist der Name Pflichtkriterium; mit Datum entschärft er nur Mehrdeutigkeit
    if (!arrival && !departure) rows = rows.filter((r) => nameMatches(r.guest_name))
    else if (rows.length > 1 && name) {
      const byName = rows.filter((r) => nameMatches(r.guest_name))
      if (byName.length) rows = byName
    }

    if (rows.length !== 1) return null
    return toVoiceBooking(rows[0], today)
  }

  // Exakte Daten zuerst; verhörte/falsch erinnerte Daten (±1 Tag) als Rettungsnetz.
  // Die VERIFIZIERUNG in verify-guest prüft danach weiter exakt — ein Fuzzy-Fund
  // führt dort zur gezielten Rückfrage („Zeitraum nochmal klären"), nie zur Auskunft.
  return (await attempt(0)) ?? ((arrival || departure) ? attempt(1) : null)
}

/**
 * §5.10: Datum für die SPRACHAUSGABE — mit ausgeschriebenem Wochentag.
 *
 * Sprachmodelle rechnen Wochentage notorisch falsch aus (Fall Bosbach,
 * 4.8.2026: Abreise Donnerstag 6.8. wurde als „Freitag" angesagt). Darum
 * liefert der Server den fertigen Text, den der Bot nur noch vorliest.
 * Ergebnis z. B.: „Donnerstag, 6. August 2026"
 */
export function dateText(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(String(iso))) return null
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Europe/Berlin',
  })
}

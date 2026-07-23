/**
 * 📨 Auto-Nachrichten VERSAND-ENGINE (Phase B, §148) — server-only.
 *
 * Läuft alle 10 Min per Cron (/api/auto-messages/send):
 *  - nach_buchung-Vorlagen: Buchungen der letzten 6 h (sofortnah, jeder Lauf)
 *  - zeitbasierte Vorlagen: am Zieltag ab send_hour (Berlin-Zeit)
 * Kurzfristig-Weiche: lead_filter je Vorlage ('kurzfristig' = Anreise ≤ 3 Tage
 * nach Buchung). Überholte Trigger (Zieltag ≤ Buchungstag) werden übersprungen —
 * die (kurzfristige) Bestätigung deckt sie ab. Anti-Spam-Doktrin: „so wenige
 * Nachrichten wie möglich, so viele wie nötig."
 *
 * Kanal-Routing (§140-Audit): Website-Gäste (conversation) → Direkt-Chat +
 * E-Mail-Brücke; Portal-Gäste → Smoobu (Fallback E-Mail an guest_email/Relay);
 * sonst E-Mail; nichts davon → Log 'fehler: kein Kanal'.
 * Doppelversand-Schutz: auto_message_log (Claim VOR dem Senden, unique).
 * Master-Schalter: app_settings 'auto_messages' { sendEnabled } — Default AUS.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  resolvePlaceholders, MAPPE_BTN_SENTINEL,
  type AutoMessage, type MessageContext,
} from '@/lib/auto-messages'
import { translateOutgoing } from '@/lib/translate'
import { sendMessageToGuest } from '@/lib/smoobu'
import { ensureDoorCode } from '@/lib/locks'
import { sendAutoMessageEmail } from '@/lib/email'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa.de'
const MAX_PER_RUN = 40          // Sicherheitsventil gegen Massen-Versand
const NEW_BOOKING_WINDOW_MS = 6 * 3600_000

/* ── Master-Schalter ── */
export async function getAutoSendEnabled(): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', 'auto_messages').maybeSingle()
    return (data?.value as { sendEnabled?: boolean } | null)?.sendEnabled === true
  } catch { return false }
}

export async function setAutoSendEnabled(sendEnabled: boolean): Promise<void> {
  await supabaseAdmin.from('app_settings').upsert(
    { key: 'auto_messages', value: { sendEnabled } }, { onConflict: 'key' },
  )
}

/* ── Zeit-Helfer (Berlin) ── */
function berlinNow(): { date: string; hour: number } {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }) // "2026-07-23 14:05:12"
  return { date: s.slice(0, 10), hour: Number(s.slice(11, 13)) }
}
function berlinDateOf(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10)
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  return new Date(d.getTime() + n * 86400_000).toISOString().slice(0, 10)
}
/** b − a in ganzen Tagen (Datums-Strings). */
function dayDiff(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400_000)
}
function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

/** Kanal-Normalisierung — direct VOR booking prüfen (§140-Substring-Falle). */
function normChannel(s: string | null | undefined): string {
  const v = (s ?? '').toLowerCase()
  if (/direct|direkt|website|trimosa/.test(v)) return 'direkt'
  if (/airbnb/.test(v)) return 'airbnb'
  if (/fewo|homeaway|vrbo|abritel/.test(v)) return 'fewo'
  if (/hometogo/.test(v)) return 'hometogo'
  if (/booking/.test(v)) return 'booking'
  return v
}

/* ── Übersetzung mit URL-/Button-Schutz: Tokens raus, übersetzen, Tokens
 * zurück. Geht dabei etwas verloren → deutsches Original (sicher). ── */
async function translateProtected(text: string, lang: string): Promise<{ text: string; translated: boolean }> {
  if (!lang || lang === 'de') return { text, translated: false }
  const tokens: string[] = []
  const tokenized = text.replace(/https?:\/\/[^\s]+|\[\[MAPPE_BUTTON\]\]/g, (u) => {
    tokens.push(u)
    return `[[T${tokens.length}]]`
  })
  const out = await translateOutgoing(tokenized, lang)
  if (!out) return { text, translated: false }
  let restored = out
  tokens.forEach((u, i) => { restored = restored.split(`[[T${i + 1}]]`).join(u) })
  if (/\[\[T\d+\]\]/.test(restored)) return { text, translated: false }
  for (const u of tokens) if (!restored.includes(u)) return { text, translated: false }
  return { text: restored, translated: true }
}

/* ── Telefon-Vorwahl → Sprach-Schätzung (§117-Map, gespiegelt aus ChatPanel):
 * Fallback für Portal-Gäste, die noch nie geschrieben haben. ── */
const PHONE_LANG: Record<string, string> = {
  '49': 'de', '43': 'de', '41': 'de',
  '31': 'nl', '32': 'nl',
  '33': 'fr', '352': 'fr',
  '44': 'en', '1': 'en', '353': 'en', '47': 'en', '358': 'en', '36': 'en', '30': 'en',
  '39': 'it', '34': 'es', '351': 'pt', '45': 'da', '46': 'sv',
  '48': 'pl', '420': 'cs', '90': 'tr', '7': 'ru',
}
async function phoneLangFor(bookingId: string): Promise<string | null> {
  try {
    // Die Vorwahl steckt in der Smoobu-Bestätigungs-Nachricht („Guest Phone Number: +32…")
    const { data: pm } = await supabaseAdmin
      .from('messages').select('content').eq('booking_id', bookingId)
      .ilike('content', '%phone number%').limit(1)
    const digits = pm?.[0]?.content?.match(/\+\s?(\d{6,})/)?.[1]
    if (!digits) return null
    for (const len of [3, 2, 1]) {
      const lang = PHONE_LANG[digits.slice(0, len)]
      if (lang) return lang
    }
  } catch { /* best effort */ }
  return null
}

/* ── Gastsprache: letzte erkannte Gast-Nachricht > guest_lang (Website) >
 * Telefon-Vorwahl-Schätzung > de. Exportiert (§163): auch die Gästemappe
 * startet damit in der Kommunikationssprache des Gasts. ── */
export async function guestLangFor(b: { id: string; guest_id: string | null; guest_lang: string | null }, convId?: string, convGuestId?: string | null): Promise<string> {
  try {
    const { data: bm } = await supabaseAdmin
      .from('messages').select('lang').eq('booking_id', b.id).eq('sender_type', 'guest')
      .not('lang', 'is', null).order('created_at', { ascending: false }).limit(1)
    if (bm?.[0]?.lang) return String(bm[0].lang)
    if (convId && (convGuestId ?? b.guest_id)) {
      const { data: dm } = await supabaseAdmin
        .from('messages').select('lang').eq('conversation_id', convId)
        .eq('sender_id', convGuestId ?? b.guest_id!)
        .not('lang', 'is', null).order('created_at', { ascending: false }).limit(1)
      if (dm?.[0]?.lang) return String(dm[0].lang)
    }
  } catch { /* Sprach-Erkennung ist best effort */ }
  if (b.guest_lang) return b.guest_lang
  return (await phoneLangFor(b.id)) ?? 'de'
}

async function guestEmailFor(b: BookingRow): Promise<string | null> {
  if (b.guest_email && b.guest_email.includes('@')) return b.guest_email
  if (b.guest_id) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(b.guest_id)
      return data?.user?.email ?? null
    } catch { /* ignore */ }
  }
  return null
}

/* ── Typen ── */
interface BookingRow {
  id: string; listing_id: string | null; status: string; source: string | null
  payment_status: string | null; check_in: string; check_out: string
  created_at: string; adults: number | null; children: number | null
  guest_name: string | null; guest_email: string | null; guest_id: string | null
  guest_lang: string | null; channel: string | null
  smoobu_reservation_id: number | null; portal_token: string | null
  door_code: string | null; booking_type: string | null
}
interface ListingRow {
  id: string; title: string | null; address: string | null; location: string | null
  check_in_time: string | null; check_out_time: string | null
}
interface ConvRow { id: string; guest_id: string | null; host_id: string | null; booking_id: string | null }

export interface AutoSendReport {
  enabled: boolean
  dryRun: boolean
  templates: number
  bookingsChecked: number
  sent: number
  postponed: number
  truncated: number
  due: { vorlage: string; gast: string; wohnung: string; zeitraum: string; kanal: string; vorschau: string }[]
  failed: { vorlage: string; gast: string; error: string }[]
}

/** Hauptlauf. dryRun = nur berechnen & Vorschau liefern, NICHTS senden/loggen. */
export async function runAutoMessages(opts: { dryRun?: boolean } = {}): Promise<AutoSendReport> {
  const dryRun = opts.dryRun === true
  const report: AutoSendReport = {
    enabled: await getAutoSendEnabled(), dryRun,
    templates: 0, bookingsChecked: 0, sent: 0, postponed: 0, truncated: 0, due: [], failed: [],
  }
  if (!report.enabled && !dryRun) return report

  // Vorlagen (lead_filter fehlt vor der Migration → Default 'alle')
  const { data: tRows, error: tErr } = await supabaseAdmin
    .from('auto_messages').select('*').eq('enabled', true).order('sort')
  if (tErr || !tRows?.length) return report
  const templates = (tRows as AutoMessage[]).map(t => ({
    ...t, lead_filter: t.lead_filter ?? 'alle', send_email: t.send_email !== false,
  }))
  report.templates = templates.length

  const { date: today, hour } = berlinNow()

  // Buchungs-Fenster (deckt Offsets bis 60 Tage)
  const { data: bRows } = await supabaseAdmin
    .from('bookings')
    .select('id, listing_id, status, source, payment_status, check_in, check_out, created_at, adults, children, guest_name, guest_email, guest_id, guest_lang, channel, smoobu_reservation_id, portal_token, door_code, booking_type')
    .eq('status', 'confirmed')
    .lte('check_in', addDays(today, 70))
    .gte('check_out', addDays(today, -70))
    .limit(1000)
  const bookings = (bRows ?? []) as BookingRow[]
  report.bookingsChecked = bookings.length
  if (!bookings.length) return report

  const { data: lRows } = await supabaseAdmin
    .from('listings').select('id, title, address, location, check_in_time, check_out_time')
  const listings = new Map((lRows ?? []).map(l => [l.id as string, l as ListingRow]))

  // Bereits versendete Paare (300er-Chunks — §129-URL-Längen-Lektion)
  const logSet = new Set<string>()
  const bIds = bookings.map(b => b.id)
  for (let i = 0; i < bIds.length; i += 300) {
    const { data: logs } = await supabaseAdmin
      .from('auto_message_log').select('auto_message_id, booking_id')
      .in('booking_id', bIds.slice(i, i + 300))
    for (const l of logs ?? []) logSet.add(`${l.auto_message_id}|${l.booking_id}`)
  }

  // Fällige Paare berechnen
  const due: { t: AutoMessage; b: BookingRow }[] = []
  for (const t of templates) {
    for (const b of bookings) {
      if (t.listing_id && t.listing_id !== b.listing_id) continue
      const nights = dayDiff(b.check_in, b.check_out)
      if (t.min_nights && nights < t.min_nights) continue
      if (t.channel_filter?.length) {
        const ch = normChannel(b.channel ?? b.source)
        if (!t.channel_filter.map(normChannel).includes(ch)) continue
      }
      // Website-Buchungen erst nach Zahlungseingang (§132-Muster)
      if (b.source === 'trimosa' && b.payment_status !== 'paid') continue

      const createdDate = berlinDateOf(b.created_at)
      const isShort = dayDiff(createdDate, b.check_in) <= 3
      if (t.lead_filter === 'kurzfristig' && !isShort) continue
      if (t.lead_filter === 'normal' && isShort) continue

      if (t.trigger_type === 'nach_buchung') {
        if (Date.now() - new Date(b.created_at).getTime() > NEW_BOOKING_WINDOW_MS) continue
      } else {
        const base = t.trigger_type.includes('anreise') ? b.check_in : b.check_out
        const dir = t.trigger_type.startsWith('vor') ? -1 : 1
        const target = addDays(base, dir * t.offset_days)
        if (target !== today) continue
        if (hour < t.send_hour) continue
        // Überholter Trigger: Zieltag ≤ Buchungstag → die Bestätigung deckt ihn ab
        if (dayDiff(createdDate, target) <= 0) continue
      }
      if (logSet.has(`${t.id}|${b.id}`)) continue
      due.push({ t, b })
    }
  }
  if (due.length > MAX_PER_RUN) {
    report.truncated = due.length - MAX_PER_RUN
    due.length = MAX_PER_RUN
  }
  if (!due.length) return report

  // Conversations der fälligen Buchungen (Website-Gäste)
  const convByBooking = new Map<string, ConvRow>()
  const dueBIds = [...new Set(due.map(d => d.b.id))]
  for (let i = 0; i < dueBIds.length; i += 300) {
    const { data: convs } = await supabaseAdmin
      .from('conversations').select('id, guest_id, host_id, booking_id')
      .in('booking_id', dueBIds.slice(i, i + 300))
    for (const c of (convs ?? []) as ConvRow[]) if (c.booking_id) convByBooking.set(c.booking_id, c)
  }

  for (const { t, b } of due) {
    const listing = b.listing_id ? listings.get(b.listing_id) : undefined
    const gast = b.guest_name || 'Gast'
    const zeitraum = `${fmtDate(b.check_in)}–${fmtDate(b.check_out)}`
    try {
      // Türcode: fehlt er noch, wird er hier erzeugt (idempotent, §132) —
      // klappt das nicht, wird VERTAGT (kein Log → nächster 10-Min-Lauf).
      let code = b.door_code
      if (t.body.includes('{tuercode}')) {
        if (dryRun) code = code ?? '••••••'
        else {
          if (!code) code = await ensureDoorCode(b.id).catch(() => null)
          if (!code) { report.postponed++; continue }
        }
      }

      const ctx: MessageContext = {
        vorname: gast.trim().split(/\s+/)[0] || 'Gast',
        name: gast,
        wohnung: listing?.title ?? 'deiner Ferienwohnung',
        anreise: fmtDate(b.check_in),
        abreise: fmtDate(b.check_out),
        naechte: String(dayDiff(b.check_in, b.check_out)),
        gaeste: String((b.adults ?? 1) + (b.children ?? 0)),
        checkin: listing?.check_in_time ?? '16:00',
        checkout: listing?.check_out_time ?? '10:00',
        tuercode: code ?? '',
        mappe: b.portal_token ? `${siteUrl}/mappe/${b.portal_token}` : '',
        adresse: listing?.address || listing?.location || '',
      }
      let german = resolvePlaceholders(t.body.split('{mappe_button}').join(MAPPE_BTN_SENTINEL), ctx)
      // Nicht auflösbare Rest-Tokens säubern (nie kaputte {platzhalter} an Gäste)
      german = german.replace(/\{\w+\}/g, '').replace(/\n{3,}/g, '\n\n').trim()
      if (!german) { report.postponed++; continue }

      const conv = convByBooking.get(b.id)
      const kanal = conv ? (t.send_email ? 'chat+email' : 'chat') : b.smoobu_reservation_id ? 'smoobu' : 'email'
      if (dryRun) {
        report.due.push({
          vorlage: t.name, gast, wohnung: listing?.title ?? '—', zeitraum, kanal,
          vorschau: german.split(MAPPE_BTN_SENTINEL).join(ctx.mappe).slice(0, 400),
        })
        continue
      }

      // Claim VOR dem Senden — unique(auto_message_id, booking_id) verhindert
      // Doppelversand auch bei parallelen Läufen
      const { error: claimErr } = await supabaseAdmin
        .from('auto_message_log')
        .insert({ auto_message_id: t.id, booking_id: b.id, channel: 'sendet…' })
      if (claimErr) continue

      const lang = await guestLangFor(b, conv?.id, conv?.guest_id)
      const tr = await translateProtected(german, lang)
      const chatText = tr.text.split(MAPPE_BTN_SENTINEL).join(ctx.mappe).replace(/\n{3,}/g, '\n\n').trim()
      const germanChat = german.split(MAPPE_BTN_SENTINEL).join(ctx.mappe).replace(/\n{3,}/g, '\n\n').trim()
      const msgLang = tr.translated ? lang : null
      const msgDe = tr.translated ? germanChat : null

      let outcome = ''
      if (conv?.id) {
        // Website-Gast: Direkt-Chat + E-Mail-Brücke (§140 — Smoobus
        // Direktkanal erreicht den Gast nicht, die Mail schon).
        // send_email=false → nur Chat (je Vorlage einstellbar).
        await supabaseAdmin.from('messages').insert({
          conversation_id: conv.id, sender_id: conv.host_id,
          content: chatText, content_de: msgDe, lang: msgLang,
        })
        await supabaseAdmin.from('conversations')
          .update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
        const to = t.send_email ? await guestEmailFor(b) : null
        if (to) {
          await sendAutoMessageEmail({
            to, guestName: gast, listingTitle: listing?.title, text: tr.text,
            mappeUrl: ctx.mappe || null, lang,
          }).catch(e => console.error('[auto-messages] email:', e))
          outcome = 'chat+email'
        } else outcome = 'chat'
      } else if (b.smoobu_reservation_id) {
        const msgId = await sendMessageToGuest(Number(b.smoobu_reservation_id), chatText)
        if (msgId !== null) {
          await supabaseAdmin.from('messages').insert({
            booking_id: b.id, sender_type: 'host', content: chatText,
            content_de: msgDe, lang: msgLang, smoobu_message_id: String(msgId),
          })
          outcome = 'smoobu'
        } else {
          const to = await guestEmailFor(b)
          if (to) {
            await sendAutoMessageEmail({
              to, guestName: gast, listingTitle: listing?.title, text: tr.text,
              mappeUrl: ctx.mappe || null, lang,
            })
            await supabaseAdmin.from('messages').insert({
              booking_id: b.id, sender_type: 'host', content: chatText,
              content_de: msgDe, lang: msgLang,
            })
            outcome = 'email (smoobu-fehler)'
          } else {
            outcome = 'fehler: smoobu fehlgeschlagen, keine E-Mail'
            report.failed.push({ vorlage: t.name, gast, error: outcome })
          }
        }
      } else {
        const to = await guestEmailFor(b)
        if (to) {
          await sendAutoMessageEmail({
            to, guestName: gast, listingTitle: listing?.title, text: tr.text,
            mappeUrl: ctx.mappe || null, lang,
          })
          await supabaseAdmin.from('messages').insert({
            booking_id: b.id, sender_type: 'host', content: chatText,
            content_de: msgDe, lang: msgLang,
          })
          outcome = 'email'
        } else {
          outcome = 'fehler: kein Kanal'
          report.failed.push({ vorlage: t.name, gast, error: outcome })
        }
      }
      await supabaseAdmin.from('auto_message_log')
        .update({ channel: outcome })
        .match({ auto_message_id: t.id, booking_id: b.id })
      if (!outcome.startsWith('fehler')) {
        report.sent++
        console.log(`[auto-messages] gesendet: "${t.name}" → ${gast} (${listing?.title ?? '—'}, ${outcome})`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      report.failed.push({ vorlage: t.name, gast, error: msg.slice(0, 200) })
      console.error('[auto-messages]', t.name, gast, msg)
      await supabaseAdmin.from('auto_message_log')
        .update({ channel: `fehler: ${msg.slice(0, 120)}` })
        .match({ auto_message_id: t.id, booking_id: b.id })
    }
  }
  return report
}

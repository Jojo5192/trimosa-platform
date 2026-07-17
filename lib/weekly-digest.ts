/**
 * 📬 Wochenbericht (mittwochs per Cron): Die KI fasst Gastnachrichten und
 * Bewertungen der letzten 7 Tage zusammen — Kritik (mit Historien-Abgleich
 * gegen Aufgaben + frühere Berichte), Verbesserungsvorschläge und Lob — und
 * mailt sie gebrandet an alle Admins/Gastgeber/Mitarbeiter (nicht Dienstleister).
 * Prompt im Prompt-Studio editierbar ('weekly_digest'); Ausgaben landen in
 * weekly_digests und dienen künftigen Läufen als Gedächtnis.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaude } from '@/lib/ai'
import { getPrompt } from '@/lib/prompts'
import { sendViaResend } from '@/lib/email'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa.de'
const MAX_MESSAGES = 250
const MAX_REVIEWS = 120

interface KritikItem { wohnung: string | null; titel: string; detail: string; zitat: string | null; quelle: string; prio: string; historie: string | null }
interface VorschlagItem { wohnung: string | null; titel: string; detail: string; quelle: string }
interface LobItem { wohnung: string | null; text: string; zitat: string | null }
interface DigestContent { wochenfazit: string; kritik: KritikItem[]; vorschlaege: VorschlagItem[]; lob: LobItem[] }

export interface DigestSummary {
  nachrichten: number; bewertungen: number
  kritik: number; vorschlaege: number; lob: number
  empfaenger: number; note?: string
}

/** JSON-Objekt robust parsen (Rettungspfad bei abgeschnittener Antwort). */
function parseDigest(raw: string): DigestContent {
  const start = raw.indexOf('{')
  if (start === -1) throw new Error('Keine JSON-Antwort: ' + raw.slice(0, 150))
  const end = raw.lastIndexOf('}')
  const candidate = raw.slice(start, end + 1)
  const parsed = JSON.parse(candidate) as Partial<DigestContent>
  return {
    wochenfazit: String(parsed.wochenfazit ?? ''),
    kritik: Array.isArray(parsed.kritik) ? parsed.kritik : [],
    vorschlaege: Array.isArray(parsed.vorschlaege) ? parsed.vorschlaege : [],
    lob: Array.isArray(parsed.lob) ? parsed.lob : [],
  }
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const PRIO_DOT: Record<string, string> = { hoch: '🔴', mittel: '🟡', niedrig: '⚪️' }
const PRIO_ORDER: Record<string, number> = { hoch: 0, mittel: 1, niedrig: 2 }

function fmtShort(d: Date): string {
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`
}

/* ── Mail-HTML (gleicher Marken-Rahmen wie lib/email.ts, eigener Body) ── */
function renderDigestHtml(opts: {
  rangeLabel: string
  stats: { nachrichten: number; bewertungen: number; note: string }
  content: DigestContent
  taskLine: string | null
}): string {
  const { rangeLabel, stats, content, taskLine } = opts

  const statCell = (value: string, label: string) => `
    <td width="33%" align="center" style="padding:14px 6px;background:#FCFBF7;border:1px solid #EDE9DE;border-radius:12px;">
      <div style="font-size:22px;font-weight:700;color:#1A1400;line-height:1.2;">${value}</div>
      <div style="font-size:11.5px;color:#8A8065;margin-top:2px;">${label}</div>
    </td>`

  const kritikSorted = [...content.kritik].sort((a, b) => (PRIO_ORDER[a.prio] ?? 1) - (PRIO_ORDER[b.prio] ?? 1))
  const kritikRows = kritikSorted.map((k) => `
    <div style="margin:0 0 12px;padding:13px 16px;background:#FFF8F6;border:1px solid #F5DCD3;border-radius:12px;">
      <div style="font-size:13.5px;font-weight:700;color:#7C2D12;line-height:1.4;">
        ${PRIO_DOT[k.prio] ?? '🟡'} ${esc(k.titel)}${k.wohnung ? ` <span style="font-weight:600;color:#B08968;">· ${esc(k.wohnung)}</span>` : ''}
      </div>
      <div style="font-size:12.5px;color:#5C4A3D;line-height:1.6;margin-top:4px;">${esc(k.detail)}</div>
      ${k.zitat ? `<div style="font-size:12px;color:#8A7365;font-style:italic;margin-top:5px;">„${esc(k.zitat)}“ <span style="font-style:normal;color:#B0A090;">— ${esc(k.quelle)}</span></div>` : `<div style="font-size:11.5px;color:#B0A090;margin-top:4px;">${esc(k.quelle)}</div>`}
      ${k.historie ? `<div style="font-size:12px;font-weight:600;color:#9A3412;margin-top:6px;">🔁 ${esc(k.historie)}</div>` : ''}
    </div>`).join('')

  const vorschlagRows = content.vorschlaege.map((v) => `
    <div style="margin:0 0 12px;padding:13px 16px;background:#FBFAF4;border:1px solid #EDE9DE;border-radius:12px;">
      <div style="font-size:13.5px;font-weight:700;color:#1A1400;line-height:1.4;">
        💡 ${esc(v.titel)}${v.wohnung ? ` <span style="font-weight:600;color:#B08968;">· ${esc(v.wohnung)}</span>` : ''}
      </div>
      <div style="font-size:12.5px;color:#4A4438;line-height:1.6;margin-top:4px;">${esc(v.detail)} <span style="color:#B0A090;">— ${esc(v.quelle)}</span></div>
    </div>`).join('')

  const lobRows = content.lob.map((l) => `
    <div style="margin:0 0 12px;padding:13px 16px;background:#F3FBF4;border:1px solid #CBEBD0;border-radius:12px;">
      <div style="font-size:12.5px;color:#14532D;line-height:1.6;">
        ⭐ ${esc(l.text)}${l.wohnung ? ` <span style="font-weight:700;">(${esc(l.wohnung)})</span>` : ''}
      </div>
      ${l.zitat ? `<div style="font-size:12px;color:#3F7A50;font-style:italic;margin-top:4px;">„${esc(l.zitat)}“</div>` : ''}
    </div>`).join('')

  const section = (title: string, body: string, empty: string) => `
    <h2 style="margin:26px 0 12px;font-size:15px;color:#1A1400;letter-spacing:-0.1px;">${title}</h2>
    ${body || `<p style="margin:0;font-size:12.5px;color:#A8A292;">${empty}</p>`}`

  return `<!DOCTYPE html>
<html lang="de">
<body style="margin:0;padding:0;background-color:#F2F0EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">Wochenbericht ${rangeLabel}: ${esc(opts.content.wochenfazit).slice(0, 120)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F2F0EA;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">

        <tr><td style="background-color:#12222E;border-radius:18px 18px 0 0;padding:24px 32px;text-align:center;">
          <img src="${siteUrl}/logo.png" alt="TRIMOSA" width="170" style="display:inline-block;width:170px;max-width:55%;height:auto;" />
          <p style="margin:12px 0 0;font-size:12px;font-weight:700;letter-spacing:0.1em;color:#AE8D2D;">WOCHENBERICHT · ${rangeLabel}</p>
        </td></tr>

        <tr><td style="background-color:#ffffff;padding:30px 34px 26px;">

          <p style="margin:0 0 18px;font-size:14.5px;line-height:1.7;color:#4A4438;">${esc(content.wochenfazit)}</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="6"><tr>
            ${statCell(String(stats.nachrichten), 'Gastnachrichten')}
            ${statCell(String(stats.bewertungen), 'neue Bewertungen')}
            ${statCell(stats.note, 'Ø-Note der Woche')}
          </tr></table>

          ${section(`🔴 Kritik &amp; Mängel (${content.kritik.length})`, kritikRows, 'Keine Kritik diese Woche — starke Leistung!')}
          ${section(`💡 Verbesserungsvorschläge (${content.vorschlaege.length})`, vorschlagRows, 'Keine neuen Vorschläge diese Woche.')}
          ${section(`⭐ Das lief gut (${content.lob.length})`, lobRows, 'Diesmal kein hervorgehobenes Lob — nächste Woche wieder.')}

          ${taskLine ? `<p style="margin:22px 0 0;font-size:12.5px;line-height:1.6;color:#8A8065;background:#FAF7EE;border-radius:12px;padding:12px 16px;">✅ ${taskLine}</p>` : ''}

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:24px 0 4px;">
              <a href="${siteUrl}/team?tab=aufgaben" style="display:inline-block;background:linear-gradient(135deg,#AE8D2D,#8A7020);background-color:#AE8D2D;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 34px;border-radius:999px;">
                Zur Aufgaben-Inbox →
              </a>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="background-color:#ffffff;border-radius:0 0 18px 18px;border-top:1px solid #F0EDE5;padding:16px 34px 20px;text-align:center;">
          <p style="margin:0;font-size:11.5px;color:#A8A292;">Automatischer Wochenbericht aus Gastnachrichten &amp; Bewertungen · TRIMOSA Team</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function runWeeklyDigest(): Promise<DigestSummary> {
  const sinceDate = new Date(Date.now() - 7 * 86400_000)
  const since = sinceDate.toISOString()
  const rangeLabel = `${fmtShort(sinceDate)} – ${fmtShort(new Date())}`

  const { data: listingRows } = await supabaseAdmin.from('listings').select('id, title')
  const listingTitle = new Map((listingRows ?? []).map((l) => [l.id, String(l.title)]))

  // ── Gastnachrichten der Woche (Buchungs-Welt + Direkt-Chat) ──
  const { data: bookingMsgs } = await supabaseAdmin
    .from('messages')
    .select('content, content_de, created_at, booking_id')
    .eq('sender_type', 'guest')
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES)
  const bookingIds = [...new Set((bookingMsgs ?? []).map((m) => m.booking_id).filter(Boolean))] as string[]
  const bookingListing = new Map<string, string>()
  if (bookingIds.length) {
    const { data: bks } = await supabaseAdmin.from('bookings').select('id, listing_id').in('id', bookingIds)
    for (const b of bks ?? []) if (b.listing_id) bookingListing.set(b.id, b.listing_id)
  }

  const { data: directMsgs } = await supabaseAdmin
    .from('messages')
    .select('content, content_de, created_at, sender_id, conversation_id')
    .not('conversation_id', 'is', null)
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES)
  const convIds = [...new Set((directMsgs ?? []).map((m) => m.conversation_id).filter(Boolean))] as string[]
  const convGuest = new Map<string, { guestId: string | null; listingId: string | null }>()
  if (convIds.length) {
    const { data: convs } = await supabaseAdmin
      .from('conversations').select('id, guest_id, bookings(listing_id)').in('id', convIds)
    for (const c of convs ?? []) {
      const b = c.bookings as { listing_id?: string } | { listing_id?: string }[] | null
      const listingId = (Array.isArray(b) ? b[0]?.listing_id : b?.listing_id) ?? null
      convGuest.set(c.id, { guestId: c.guest_id ?? null, listingId })
    }
  }

  type Item = { text: string; listingId: string | null }
  const messages: Item[] = []
  for (const m of bookingMsgs ?? []) {
    const text = (m.content_de || m.content || '').trim()
    if (text.length >= 25) messages.push({ text, listingId: m.booking_id ? bookingListing.get(m.booking_id) ?? null : null })
  }
  for (const m of directMsgs ?? []) {
    const meta = m.conversation_id ? convGuest.get(m.conversation_id) : null
    if (!meta || !m.sender_id || m.sender_id !== meta.guestId) continue
    const text = (m.content_de || m.content || '').trim()
    if (text.length >= 25) messages.push({ text, listingId: meta.listingId })
  }

  // ── Bewertungen der Woche (nach Import-Datum) ──
  const { data: reviewRows } = await supabaseAdmin
    .from('reviews')
    .select('review_text, rating, listing_id, source, review_date, created_at')
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_REVIEWS)
  const reviews = (reviewRows ?? []).filter((r) => String(r.review_text ?? '').trim().length >= 25)
  const ratings = (reviewRows ?? []).map((r) => Number(r.rating)).filter((n) => Number.isFinite(n) && n > 0)
  const avgNote = ratings.length ? (ratings.reduce((s, n) => s + n, 0) / ratings.length).toFixed(2).replace('.', ',') : '—'

  // ── Aufgaben-Kontext: Wochen-KI-Vorschläge (Statuszeile) + Historie (für „🔁") ──
  const { data: weekTasks } = await supabaseAdmin
    .from('tasks').select('status').in('source', ['ki_nachricht', 'ki_bewertung']).gt('created_at', since)
  const wk = { neu: (weekTasks ?? []).length, offen: 0, erledigt: 0, verworfen: 0 }
  for (const t of weekTasks ?? []) {
    if (t.status === 'verworfen') wk.verworfen++
    else if (t.status === 'erledigt') wk.erledigt++
    else if (t.status !== 'vorschlag') wk.offen++
  }
  const taskLine = wk.neu
    ? `Diese Woche ${wk.neu} neue KI-Aufgaben-Vorschläge in der Team-App — ${wk.offen} angenommen, ${wk.erledigt} bereits erledigt, ${wk.verworfen} verworfen.`
    : null

  const { data: taskHistory } = await supabaseAdmin
    .from('tasks').select('title, status, created_at, completed_at')
    .order('created_at', { ascending: false }).limit(300)
  const historyLines = (taskHistory ?? []).map((t) => {
    const created = String(t.created_at ?? '').slice(0, 10)
    const done = t.status === 'erledigt' && t.completed_at ? ` — erledigt am ${String(t.completed_at).slice(0, 10)}` : ` — Status: ${t.status}`
    return `- [${created}] ${t.title}${done}`
  })

  // ── Frühere Wochenberichte als Gedächtnis (fail-soft ohne Tabelle) ──
  let previousDigests: string[] = []
  try {
    const { data: prev } = await supabaseAdmin
      .from('weekly_digests').select('week_start, content')
      .order('week_start', { ascending: false }).limit(4)
    previousDigests = (prev ?? []).map((p) => {
      const c = p.content as Partial<DigestContent>
      const titles = (c.kritik ?? []).map((k) => k.titel).filter(Boolean)
      return `Woche ab ${p.week_start}: ${titles.length ? titles.join(' · ') : '(keine Kritikpunkte)'}`
    })
  } catch { /* Migration noch nicht ausgeführt */ }

  const user = [
    'WOHNUNGEN: ' + (listingRows ?? []).map((l) => l.title).join(' | '),
    '',
    'AUFGABEN-HISTORIE (für den Historien-Abgleich „früher schon angemerkt"):',
    historyLines.length ? historyLines.join('\n') : '- (keine)',
    '',
    'FRÜHERE WOCHENBERICHTE (Kritik-Themen):',
    previousDigests.length ? previousDigests.map((d) => `- ${d}`).join('\n') : '- (keine)',
    '',
    'GASTNACHRICHTEN DIESER WOCHE:',
    messages.length
      ? messages.map((m) => `[${m.listingId ? listingTitle.get(m.listingId) ?? 'unbekannt' : 'unbekannt'}] "${m.text.slice(0, 600)}"`).join('\n')
      : '(keine)',
    '',
    'BEWERTUNGEN DIESER WOCHE (Import-Datum; einzelne können ältere Aufenthalte betreffen):',
    reviews.length
      ? reviews.map((r) => `[${r.listing_id ? listingTitle.get(r.listing_id) ?? 'unbekannt' : 'unbekannt'} · ${r.source} · ${r.rating}/5${r.review_date ? ' · Aufenthalt ' + String(r.review_date).slice(0, 10) : ''}] "${String(r.review_text).slice(0, 700)}"`).join('\n')
      : '(keine)',
  ].join('\n')

  const system = await getPrompt('weekly_digest')
  // §45-/§84-Lektion: großzügiges Budget (Denkanteil + lange JSON-Antwort)
  const raw = await askClaude(system, user, 20000)
  const content = parseDigest(raw)

  const html = renderDigestHtml({
    rangeLabel,
    stats: { nachrichten: messages.length, bewertungen: reviews.length, note: avgNote },
    content,
    taskLine,
  })

  // ── Empfänger: Admins, Gastgeber, Mitarbeiter (nicht Dienstleister) ──
  const { data: team } = await supabaseAdmin
    .from('profiles').select('id, notification_email')
    .or('is_admin.eq.true,is_host.eq.true,is_staff.eq.true')
  const emails = new Set<string>()
  for (const p of team ?? []) {
    let mail = (p.notification_email as string | null)?.trim() || null
    if (!mail) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(p.id)
      mail = u?.user?.email ?? null
    }
    if (mail) emails.add(mail.toLowerCase())
  }

  const subject = `📬 TRIMOSA Wochenbericht ${rangeLabel} — ${content.kritik.length} Kritikpunkte, ${content.lob.length}× Lob`
  let sent = 0
  for (const to of emails) {
    const res = await sendViaResend(to, subject, html)
    if (res.ok) sent++
  }

  // Bericht speichern (Gedächtnis für künftige Läufe) — best-effort
  try {
    await supabaseAdmin.from('weekly_digests').insert({
      week_start: since.slice(0, 10),
      content: content as unknown as Record<string, unknown>,
    })
  } catch (e) { console.error('[weekly-digest] speichern:', e) }

  return {
    nachrichten: messages.length,
    bewertungen: reviews.length,
    kritik: content.kritik.length,
    vorschlaege: content.vorschlaege.length,
    lob: content.lob.length,
    empfaenger: sent,
  }
}

/**
 * 📥 GRAPH-MAIL-POLLER (§237) — server-only. Der „Mail-Viewer, der immer
 * mitliest": liest die M365-Postfächer DIREKT über die Microsoft-Graph-API
 * (App-Registrierung, client_credentials, Mail.Read) — KEINE Outlook-Regeln
 * nötig. Jede neue Inbox-Mail läuft durch dieselbe Pipeline wie der
 * Resend-Zubringer (lib/inbound-mail-core): Portal-Buchung, Gast-Antwort,
 * Provisionsrechnung, Beleg-Fischer.
 *
 * Envs (Setup mit dem Inhaber im Entra-Portal, §237): MS_TENANT_ID,
 * MS_CLIENT_ID, MS_CLIENT_SECRET. Postfach-Liste + An/Aus in app_settings
 * 'graph_mail' (Route /api/mail-scan verwaltet beides).
 *
 * Übergangs-Sicherheit: läuft parallel zu den bestehenden Umleiten-Regeln —
 * doppelt verarbeitete Mails sind unschädlich (Content-Dedupe im Chat,
 * nur-leere-Felder-Anreicherung); nach bewiesenem Betrieb können die
 * Outlook-Regeln entfallen.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { processInboundMail, stripHtml, ensureFewoDataTasks } from '@/lib/inbound-mail-core'

const GRAPH = 'https://graph.microsoft.com/v1.0'

export function graphConfigured(): boolean {
  return !!(process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET)
}

const g = globalThis as typeof globalThis & { __graphToken?: { token: string; exp: number } }

async function getGraphToken(): Promise<string> {
  if (g.__graphToken && g.__graphToken.exp > Date.now()) return g.__graphToken.token
  const res = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID ?? '',
      client_secret: process.env.MS_CLIENT_SECRET ?? '',
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    }),
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string }
  if (!res.ok || !data.access_token) {
    throw new Error(`Graph-Token HTTP ${res.status}: ${String(data.error_description ?? '').slice(0, 200)}`)
  }
  g.__graphToken = { token: data.access_token, exp: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000 }
  return data.access_token
}

async function graphJson<T>(path: string): Promise<T> {
  const token = await getGraphToken()
  const res = await fetch(path.startsWith('https://') ? path : `${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Graph ${path.split('?')[0]} HTTP ${res.status}: ${text.slice(0, 250)}`)
  return JSON.parse(text) as T
}

/* ── Zustand (app_settings 'graph_mail') ───────────────────────────────── */

export interface GraphMailState {
  enabled: boolean
  mailboxes: string[]
  cursor: Record<string, string>
  processed: string[]
  /** §293: Buchungsmails, zu denen es (noch) keine Buchung gab (Wettlauf mit dem Smoobu-Import) —
   *  werden bis `until` bei jedem Lauf erneut geprüft */
  pending: { id: string; mailbox: string; until: string; subject: string }[]
}

export async function getGraphMailState(): Promise<GraphMailState> {
  const { data } = await supabaseAdmin
    .from('app_settings').select('value').eq('key', 'graph_mail').maybeSingle()
  const v = (data?.value ?? {}) as Partial<GraphMailState>
  return {
    enabled: v.enabled === true,
    mailboxes: Array.isArray(v.mailboxes) ? v.mailboxes.map(String) : [],
    cursor: (v.cursor && typeof v.cursor === 'object') ? v.cursor as Record<string, string> : {},
    processed: Array.isArray(v.processed) ? v.processed.map(String) : [],
    pending: Array.isArray(v.pending) ? (v.pending as GraphMailState['pending']).filter((x) => x && typeof x.id === 'string') : [],
  }
}

export async function saveGraphMailState(s: GraphMailState): Promise<void> {
  await supabaseAdmin.from('app_settings').upsert(
    { key: 'graph_mail', value: { ...s, processed: s.processed.slice(-500), pending: (s.pending ?? []).slice(-50) } },
    { onConflict: 'key' },
  )
}

/* ── Graph-Lesen ───────────────────────────────────────────────────────── */

interface GraphMsg {
  id: string
  subject?: string | null
  receivedDateTime?: string
  hasAttachments?: boolean
  from?: { emailAddress?: { name?: string; address?: string } }
  replyTo?: { emailAddress?: { name?: string; address?: string } }[]
  body?: { contentType?: string; content?: string }
}

export async function listInboxMessages(mailbox: string, sinceIso: string, top = 25, untilIso?: string, maxTotal = 0): Promise<GraphMsg[]> {
  const filter = encodeURIComponent(`receivedDateTime ge ${sinceIso}` + (untilIso ? ` and receivedDateTime lt ${untilIso}` : ''))
  const select = 'id,subject,receivedDateTime,hasAttachments,from,replyTo,body'
  const out: GraphMsg[] = []
  let url: string | null =
    `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$filter=${filter}&$orderby=receivedDateTime%20asc&$top=${top}&$select=${select}`
  // Historien-Scans folgen dem nextLink bis maxTotal (0 = nur erste Seite)
  while (url) {
    const data: { value?: GraphMsg[]; '@odata.nextLink'?: string } = await graphJson(url)
    out.push(...(data.value ?? []))
    url = maxTotal > 0 && out.length < maxTotal ? data['@odata.nextLink'] ?? null : null
  }
  return maxTotal > 0 ? out.slice(0, maxTotal) : out
}

/** §293: eine einzelne Mail erneut holen (für die pending-Wiederholung). */
async function getMessage(mailbox: string, messageId: string): Promise<GraphMsg | null> {
  try {
    return await graphJson<GraphMsg>(`/users/${encodeURIComponent(mailbox)}/messages/${messageId}?$select=id,subject,receivedDateTime,hasAttachments,from,replyTo,body`)
  } catch (e) {
    console.error('[graph-mail] Einzelabruf:', String(e).slice(0, 160))
    return null
  }
}

async function listAttachments(mailbox: string, messageId: string): Promise<Record<string, unknown>[]> {
  try {
    // KEIN $select: contentBytes liegt auf dem abgeleiteten fileAttachment-
    // Typ — ein $select auf dem Basistyp kann von Graph abgelehnt werden
    // (Kalibrierung 1.8.: Hetzner-PDF kam sonst nie an)
    const data = await graphJson<{ value?: Record<string, unknown>[] }>(
      `/users/${encodeURIComponent(mailbox)}/messages/${messageId}/attachments`)
    return data.value ?? []
  } catch (e) {
    console.error('[graph-mail] Anhänge:', e)
    return []
  }
}

function fromString(m: GraphMsg): string {
  const a = m.from?.emailAddress
  return a?.name ? `${a.name} <${a.address ?? ''}>` : (a?.address ?? '')
}

/* ── Der Scan ──────────────────────────────────────────────────────────── */

export interface MailScanReport {
  enabled: boolean
  mailboxes: string[]
  geprueft: number
  verarbeitet: { mailbox: string; from: string; subject: string; ergebnis: string }[]
  uebersprungen: number
  fehler: { mailbox: string; error: string }[]
}

/**
 * Alle konfigurierten Postfächer lesen und neue Mails durch die Pipeline
 * schieben. Cursor je Postfach (Erstlauf: letzte `fallbackHours` Stunden);
 * eigene Absender (@trimosa.de) werden übersprungen — sonst würde der
 * Poller unsere eigenen System-Mails klassifizieren.
 */
/** Eine Mail durch die Pipeline schieben (Teil des Scans; §293 auch für die pending-Wiederholung). */
async function handleMessage(m: GraphMsg, mailbox: string, state: GraphMailState, report: MailScanReport, opts: { force?: boolean; belegeOnly?: boolean }): Promise<Record<string, unknown> | null> {
  const from = fromString(m)
  const subject = String(m.subject ?? '')
  // Eigene System-/Team-Mails überspringen
  if (/@trimosa\.de|@olkiifalon\.resend\.app/i.test(from)) {
    if (!opts.belegeOnly && !state.processed.includes(m.id)) state.processed.push(m.id)
    report.uebersprungen++
    return null
  }
  const bodyRaw = String(m.body?.content ?? '')
  const rawText = m.body?.contentType === 'html' ? stripHtml(bodyRaw) : bodyRaw
  // Relay-Ernte (§128) direkt aus dem Graph-replyTo — besser als jede Regel
  const replyAddrs = (m.replyTo ?? []).map((r) => r.emailAddress?.address ?? '').join(' ')
  const relayMatch = replyAddrs.match(/[\w.+-]+@messages\.homeaway\.com/i)
  const relayEmail = relayMatch && !/^(sender|no-?reply)@/i.test(relayMatch[0]) ? relayMatch[0] : ''
  const attachments = m.hasAttachments ? await listAttachments(mailbox, m.id) : []
  try {
    const result = await processInboundMail({ from, subject, rawText, attachments, relayEmail, mailbox, mailKey: m.id }, { belegeOnly: opts.belegeOnly === true })
    report.verarbeitet.push({
      mailbox, from: from.slice(0, 60), subject: subject.slice(0, 90),
      // Paragraph 296: Werte statt nur Schluessel (ergaenzt=guest_name,adults smoobu=ok nachricht=false)
      ergebnis: String(result.skipped ?? (result.ok
        ? Object.entries(result).filter(([k]) => k !== 'ok')
            .map(([k, v]) => `${k}=${Array.isArray(v) ? (v.join(',') || '-') : String(v ?? '-').slice(0, k === 'bookingId' ? 8 : 60)}`)
            .join(' ') || 'ok'
        : result.error ?? 'fehler')).slice(0, 220),
    })
    return result
  } catch (e) {
    report.fehler.push({ mailbox, error: `${subject.slice(0, 60)}: ${String(e).slice(0, 150)}` })
    return null
  }
}

export async function runMailScan(opts: { hours?: number; force?: boolean; belegeOnly?: boolean; sinceIso?: string; untilIso?: string; mailbox?: string } = {}): Promise<MailScanReport> {
  const state = await getGraphMailState()
  const report: MailScanReport = {
    enabled: state.enabled, mailboxes: state.mailboxes,
    geprueft: 0, verarbeitet: [], uebersprungen: 0, fehler: [],
  }
  if (!graphConfigured()) { report.fehler.push({ mailbox: '—', error: 'MS_TENANT_ID/MS_CLIENT_ID/MS_CLIENT_SECRET fehlen (Vercel-Env).' }); return report }
  if (!state.mailboxes.length) { report.fehler.push({ mailbox: '—', error: 'Keine Postfächer konfiguriert (action mailboxes).' }); return report }

  // §293: wartende Buchungsmails erneut versuchen (Buchung inzwischen da?)
  if (!opts.belegeOnly && state.pending.length) {
    const keep: GraphMailState['pending'] = []
    for (const pend of state.pending) {
      if (pend.until < new Date().toISOString()) { console.log('[mail-scan] pending verfallen:', pend.subject); continue }
      const m = await getMessage(pend.mailbox, pend.id)
      if (!m) { keep.push(pend); continue }
      const result = await handleMessage(m, pend.mailbox, state, report, opts)
      if (result && result.skipped === 'keine passende Buchung gefunden') keep.push(pend)
      else console.log('[mail-scan] pending erledigt:', pend.subject, result?.skipped ?? 'ok')
    }
    state.pending = keep
  }

  const fallbackHours = Math.min(Math.max(Number(opts.hours) || 24, 1), 24 * 45)
  // Paragraph 295: gezielter Rescan eines einzelnen Postfachs ({ mailbox }) - die anderen bleiben unberuehrt
  const boxes = opts.mailbox ? state.mailboxes.filter((mb) => mb === opts.mailbox) : state.mailboxes
  for (const mailbox of boxes) {
    try {
      const since = opts.sinceIso
        ?? (opts.hours || !state.cursor[mailbox]
          ? new Date(Date.now() - fallbackHours * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z')
          : state.cursor[mailbox])
      // §241 Historien-Scan („nur Belege"): eigenes Zeitfenster, paginiert
      // bis 400 Mails/Postfach, fasst Cursor + processed NIE an
      const msgs = opts.belegeOnly
        ? await listInboxMessages(mailbox, since, 100, opts.untilIso, 400)
        : await listInboxMessages(mailbox, since, 25, opts.untilIso)
      report.geprueft += msgs.length
      for (const m of msgs) {
        // force = Kalibrier-Rescan: bereits verarbeitete Mails erneut durch
        // die Pipeline (alle Pfade sind idempotent — Content-Dedupe etc.)
        if (!opts.belegeOnly && !opts.force && state.processed.includes(m.id)) { report.uebersprungen++; continue }
        const result = await handleMessage(m, mailbox, state, report, opts)
        if (!opts.belegeOnly) {
          if (!state.processed.includes(m.id)) state.processed.push(m.id)
          if (m.receivedDateTime && (!state.cursor[mailbox] || m.receivedDateTime > state.cursor[mailbox])) {
            state.cursor[mailbox] = m.receivedDateTime
          }
          // §293: Buchungsmail ohne passende Buchung (Smoobu-Import kommt oft Minuten bis Stunden
          // später) → bis 72 h bei jedem Lauf erneut prüfen statt still zu vergessen
          if (result && result.skipped === 'keine passende Buchung gefunden' && !state.pending.some((x) => x.id === m.id)) {
            state.pending.push({ id: m.id, mailbox, until: new Date(Date.now() + 72 * 3600_000).toISOString(), subject: String(m.subject ?? '').slice(0, 90) })
          }
        }
      }
      // Cursor auch ohne neue Mails vorziehen? Nein — er zeigt auf die
      // letzte VERARBEITETE Mail; der Filter ist „ge", processed dedupet.
    } catch (e) {
      report.fehler.push({ mailbox, error: String(e instanceof Error ? e.message : e).slice(0, 250) })
    }
  }
  if (!opts.belegeOnly) {
    await saveGraphMailState(state)
    // §293: FeWo-direkt-Buchungen, die nach 2 h noch ohne Gastdaten sind → Aufgabe fürs Team
    try { await ensureFewoDataTasks() } catch (e) { console.error('[mail-scan] fewo-daten-aufgaben:', String(e).slice(0, 160)) }
  }
  // Zusammenfassung ins Function-Log — der lange Scan überlebt kein
  // Client-Timeout, das Log ist dann die einzige Report-Quelle
  console.log('[mail-scan] Report:', JSON.stringify({
    geprueft: report.geprueft, verarbeitet: report.verarbeitet.length,
    uebersprungen: report.uebersprungen, fehler: report.fehler,
    ergebnisse: report.verarbeitet.map((v) => `${v.subject.slice(0, 50)} → ${v.ergebnis.slice(0, 60)}`),
  }).slice(0, 4000))
  return report
}

/** Kalibrier-Blick: Mails NUR auflisten, nichts verarbeiten. */
export async function peekMail(hours = 24): Promise<{ mailbox: string; from: string; subject: string; empfangen: string; anhaenge: boolean }[]> {
  const state = await getGraphMailState()
  const since = new Date(Date.now() - Math.min(Math.max(hours, 1), 24 * 45) * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z')
  const out: { mailbox: string; from: string; subject: string; empfangen: string; anhaenge: boolean }[] = []
  for (const mailbox of state.mailboxes) {
    const msgs = await listInboxMessages(mailbox, since, 50)
    for (const m of msgs) {
      out.push({
        mailbox, from: fromString(m).slice(0, 70), subject: String(m.subject ?? '').slice(0, 100),
        empfangen: String(m.receivedDateTime ?? ''), anhaenge: m.hasAttachments === true,
      })
    }
  }
  return out
}

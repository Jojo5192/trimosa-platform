/**
 * 📬 INBOUND-MAIL-KERN (§127–§236) — server-only. Die komplette
 * Klassifikations- und Verarbeitungslogik für eingehende Mails, geteilt von
 * ZWEI Zubringern:
 *  - app/api/inbound-mail (Resend-Webhook, Outlook-Umleiten-Regeln)
 *  - lib/graph-mail (§237: Microsoft-Graph-Poller — liest die Postfächer
 *    DIREKT, ohne Regeln)
 *
 * Reihenfolge je Mail: Provisionsrechnung (Portal + Rechnungs-Betreff +
 * PDF) → Portal-Buchungsmail (KI-Extraktion, Anreicherung DB + Smoobu) →
 * Website-Gast-Antwort (Chat-Einsortierung) → Beleg-Fischer (PDF von
 * Lieferanten → sevdesk-Entwurf + Bank-Match) → Log/Skip.
 * Alle Pfade sind idempotent (Content-Dedupe, nur-leere-Felder-Anreicherung)
 * — dieselbe Mail über beide Zubringer richtet keinen Schaden an.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaude, FAST_MODEL } from '@/lib/ai'
import { updateReservation } from '@/lib/smoobu'

export interface InboundMailInput {
  from: string
  subject: string
  rawText: string
  attachments: unknown[]
  /** FeWo-/Vrbo-Relay-Adresse aus dem Reply-To (Zubringer erntet sie) */
  relayEmail?: string
  /** §238: Quell-Postfach + stabile Mail-ID (Beleg-Inbox-Dedupe) */
  mailbox?: string
  mailKey?: string
}

export const stripHtml = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s{3,}/g, '\n')

/** Gast-Nachricht aus einer Portal-Mail in den Chat-Thread der Buchung
 *  einsortieren (Dedupe über identischen Inhalt — dieselbe Nachricht kann
 *  auch über den Smoobu-Sync ankommen) + Team-Push. §129 */
async function saveGuestMessage(bookingId: string, guestName: string | null, text: string, label = 'FeWo-Mail'): Promise<boolean> {
  // Dedupe WHITESPACE-NORMALISIERT (§240): dieselbe Nachricht kommt über den
  // Smoobu-Sync oft mit anderen Zeilenumbrüchen als aus der Mail-Fassung
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase()
  const { data: recent } = await supabaseAdmin
    .from('messages').select('content')
    .eq('booking_id', bookingId).eq('sender_type', 'guest')
    .order('created_at', { ascending: false }).limit(30)
  if ((recent ?? []).some((m) => norm(String(m.content ?? '')) === norm(text))) return false
  const { data: inserted, error } = await supabaseAdmin.from('messages')
    .insert({ booking_id: bookingId, sender_type: 'guest', content: text })
    .select('id').single()
  if (error) { console.error('[inbound-mail] Nachricht-Insert:', error.message); return false }
  // Übersetzung VOR dem Push (§81-Konsistenz) — Push zeigt Deutsch + Flagge
  let pushText = text
  let flag = ''
  try {
    const { translateIncoming, LANG_FLAGS } = await import('@/lib/translate')
    const tr = await translateIncoming([{ id: String(inserted.id), text }])
    const t = tr.get(String(inserted.id))
    if (t?.lang && t.lang !== 'de') flag = `${LANG_FLAGS[t.lang] ?? '🌐'} `
    if (t?.german) pushText = t.german
  } catch { /* fail-soft: Original pushen */ }
  try {
    const { sendPushToTeam } = await import('@/lib/push')
    await sendPushToTeam(
      `💬 ${flag}${guestName ?? 'Gast'} · ${label}`,
      pushText.replace(/\s+/g, ' ').slice(0, 120),
      '/team?conv=' + bookingId,
      { guestChat: true },
    )
  } catch { /* Push best effort */ }
  return true
}

/**
 * §134: Antwort-Mail eines WEBSITE-Gasts (privater Absender, kein Portal) —
 * über die Absender-Adresse dem Gast-Konto bzw. der Buchung zuordnen und
 * als Chat-Nachricht einsortieren (Direkt-Chat wenn eine Konversation
 * existiert, sonst Buchungs-Thread). Nicht zuordenbare Mails werden nur
 * geloggt — das ist zugleich der Spam-Filter für das umgeleitete Postfach.
 */
async function handleWebsiteGuestReply(fromRaw: string, subject: string, rawText: string, attachments: unknown[], mailOpts: { mailbox?: string; mailKey?: string } = {}): Promise<Record<string, unknown>> {
  const email = ((fromRaw.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/) || [])[0] ?? '').toLowerCase()
  if (!email || /no-?reply|mailer-daemon|postmaster|notification|newsletter/i.test(email)) {
    // §236 C3: Lieferanten-Belege kommen oft von noreply-Absendern —
    // hängt ein PDF dran, übernimmt der Beleg-Fischer
    if (attachments.length) return handleReceiptMail(attachments, fromRaw, subject, rawText, mailOpts)
    return { ok: true, skipped: 'kein Portal, kein Gast-Absender' }
  }

  // Gast-Konto über die Login-Mail finden (kleine Nutzerbasis → Seiten-Scan)
  let guestId: string | null = null
  try {
    for (let page = 1; page <= 5; page++) {
      const { data: pageData } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 })
      const hit = pageData?.users?.find((u) => (u.email ?? '').toLowerCase() === email)
      if (hit) { guestId = hit.id; break }
      if (!pageData || pageData.users.length < 200) break
    }
  } catch { /* fail-soft — guest_email-Match unten bleibt */ }

  // Passende Buchung: aktive laufend/kommend bevorzugt, sonst jüngste (Abreise
  // ≤30 Tage her). Stornierte Buchungen sind LETZTER Fallback — Gäste schreiben
  // auch nach einem Storno (Erstattungsfragen), die Mail soll nicht verschwinden.
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const baseSelect = 'id, guest_id, guest_name, status, check_in, check_out, conversations(id, guest_id)'
  const [byId, byEmail] = await Promise.all([
    guestId
      ? supabaseAdmin.from('bookings').select(baseSelect).gte('check_out', since).eq('guest_id', guestId).order('check_in', { ascending: true }).limit(10)
      : Promise.resolve({ data: [] as never[] }),
    supabaseAdmin.from('bookings').select(baseSelect).gte('check_out', since).eq('guest_email', email).order('check_in', { ascending: true }).limit(10),
  ])
  type BRow = { id: string; guest_id: string | null; guest_name: string | null; status: string; check_in: string; check_out: string; conversations: unknown }
  const seen = new Set<string>()
  const cands = ([...(byId.data ?? []), ...(byEmail.data ?? [])] as BRow[]).filter((b) => !seen.has(b.id) && seen.add(b.id))
  const today = new Date().toISOString().slice(0, 10)
  const pick = (list: BRow[]) => list.find((b) => b.check_out >= today) ?? list[list.length - 1] ?? null
  // §240: Buchung MIT Konversation bevorzugen — hat ein Gast mehrere
  // Buchungen (z. B. Doppel-Versuch), muss die Nachricht in den SICHTBAREN
  // Thread (Konversation), nicht in eine booking-Welt ohne Smoobu-ID
  const hasConv = (b: BRow) => {
    const c = (Array.isArray(b.conversations) ? b.conversations[0] : b.conversations) as { id?: string } | null
    return Boolean(c?.id)
  }
  const booking = pick(cands.filter((b) => b.status !== 'cancelled' && hasConv(b)))
    ?? pick(cands.filter((b) => b.status !== 'cancelled'))
    ?? pick(cands.filter(hasConv))
    ?? pick(cands)
  if (!booking) {
    // §236 C3: kein Gast — mit PDF-Anhang vermutlich ein Lieferanten-Beleg
    if (attachments.length) return handleReceiptMail(attachments, fromRaw, subject, rawText, mailOpts)
    console.log('[inbound-mail] Gast-Mail ohne zuordenbare Buchung:', email)
    return { ok: true, skipped: 'Absender keiner Buchung zuordenbar' }
  }

  // Nur den NEUEN Text des Gasts extrahieren (ohne zitierte Mail/Signatur)
  let text = ''
  try {
    const raw = await askClaude(
      'Du bekommst die E-Mail-ANTWORT eines Feriengasts an seinen Gastgeber. Extrahiere NUR den neuen Nachrichtentext des Gasts — OHNE zitierte Vorgängermail, OHNE Signatur-Blöcke und Fußzeilen (eine Grußformel des Gasts darf bleiben). Gib AUSSCHLIESSLICH diesen Text zurück. Enthält die Mail keine echte persönliche Nachricht (Abwesenheitsnotiz, leere Mail, Werbung), antworte exakt: LEER',
      rawText.slice(0, 8000), 1200, FAST_MODEL,
    )
    text = raw.trim()
  } catch (e) {
    console.error('[inbound-mail] Gast-Mail-Extraktion:', e)
    return { ok: true, skipped: 'Extraktion fehlgeschlagen' }
  }
  if (!text || /^LEER\.?$/i.test(text)) {
    return { ok: true, skipped: 'kein Nachrichtentext (Auto-Reply o. ä.)' }
  }

  const convRaw = booking.conversations
  const conv = (Array.isArray(convRaw) ? convRaw[0] : convRaw) as { id: string; guest_id: string | null } | null
  const senderId = conv?.guest_id ?? guestId ?? booking.guest_id
  if (conv?.id && senderId) {
    // Direkt-Chat-Welt (Website-Gast mit Konversation)
    const { data: dupe } = await supabaseAdmin
      .from('messages').select('id').eq('conversation_id', conv.id).eq('content', text).limit(1)
    if (dupe?.length) return { ok: true, skipped: 'Duplikat' }
    const { data: inserted, error } = await supabaseAdmin.from('messages')
      .insert({ conversation_id: conv.id, sender_id: senderId, content: text })
      .select('id').single()
    if (error) return { ok: false, error: error.message }
    await supabaseAdmin.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
    try {
      const { translateIncoming } = await import('@/lib/translate')
      if (inserted) await translateIncoming([{ id: inserted.id, text }])
    } catch { /* best effort */ }
    try {
      const { sendPushToTeam } = await import('@/lib/push')
      await sendPushToTeam(`💬 ${booking.guest_name ?? 'Gast'} · E-Mail`, text.replace(/\s+/g, ' ').slice(0, 120), '/team?conv=' + conv.id, { guestChat: true })
    } catch { /* best effort */ }
    console.log('[inbound-mail] Website-Gast-Mail → Direkt-Chat:', { conv: conv.id, email })
    return { ok: true, conversationId: conv.id }
  }

  // Ohne Konversation: booking-Welt — der Thread erscheint in der Team-Inbox
  const saved = await saveGuestMessage(booking.id, booking.guest_name, text, 'E-Mail')
  console.log('[inbound-mail] Website-Gast-Mail → Buchungs-Thread:', { booking: booking.id, email, neu: saved })
  return { ok: true, bookingId: booking.id, nachricht: saved }
}

/** §236 C2: PDF aus einem Mail-Anhang holen — Feldnamen defensiv (Resend:
 *  content/base64 oder Download-URL; Graph: contentBytes/base64). */
async function pdfFromAttachment(att: Record<string, unknown>): Promise<{ name: string; buf: Buffer } | null> {
  const name = String(att.filename ?? att.name ?? 'anhang.pdf')
  const ct = String(att.content_type ?? att.contentType ?? '')
  if (!/pdf/i.test(ct) && !/\.pdf$/i.test(name)) return null
  const content = att.content ?? att.data ?? att.contentBytes
  if (typeof content === 'string' && content.length > 100) {
    try { return { name, buf: Buffer.from(content, 'base64') } } catch { return null }
  }
  const url = String(att.url ?? att.download_url ?? att.downloadUrl ?? '')
  if (url.startsWith('http')) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } })
      if (r.ok) return { name, buf: Buffer.from(await r.arrayBuffer()) }
    } catch { /* fällt unten durch */ }
  }
  return null
}

/** §238: Privater Storage-Bucket für die Beleg-Inbox (lazy angelegt). */
async function ensureBelegeBucket(): Promise<void> {
  const gb = globalThis as typeof globalThis & { __belegeBucket?: boolean }
  if (gb.__belegeBucket) return
  try {
    await supabaseAdmin.storage.createBucket('belege', {
      public: false, fileSizeLimit: '15MB', allowedMimeTypes: ['application/pdf'],
    })
  } catch { /* existiert bereits */ }
  gb.__belegeBucket = true
}

/**
 * §236 C3 / §238: Universeller BELEG-FISCHER — Mail mit PDF-Anhang, die
 * weder Portal-Buchung noch Gast-Nachricht ist. WICHTIG (Inhaber 1.8.):
 * Die Postfächer dienen DREI Firmen (eGbR + Immobilien UG + GbR) —
 * automatisch nach sevdesk (= Apartments & Homes) geht ein Beleg NUR,
 * wenn (a) eine OFFENE Abbuchung auf dem A&H-Finom-Konto exakt zum Betrag
 * passt ODER (b) die KI die Zuordnung EINDEUTIG sicher trifft. Alles
 * andere landet in der BELEG-INBOX (App → Mehr → Beleg-Inbox), wo der
 * Inhaber Gesellschaft + Kostenstelle entscheidet.
 */
async function handleReceiptMail(attachments: unknown[], from: string, subject: string, rawText: string, opts: { mailbox?: string; mailKey?: string } = {}): Promise<Record<string, unknown>> {
  const pdfs: { name: string; buf: Buffer }[] = []
  for (const a of attachments) {
    if (!a || typeof a !== 'object') continue
    const p = await pdfFromAttachment(a as Record<string, unknown>)
    if (p) pdfs.push(p)
  }
  if (!pdfs.length) return { ok: true, skipped: 'Anhang, aber kein PDF' }

  let meta: Record<string, unknown> = {}
  try {
    const raw = await askClaude(
      `Du bekommst eine E-Mail (Betreff + Text), an der ein PDF hängt. Entscheide, ob es ein BUCHHALTUNGSBELEG ist (Rechnung, Quittung oder Gutschrift eines Lieferanten/Dienstleisters an TRIMOSA). Antworte NUR mit JSON:
{"ist_beleg": true|false, "lieferant": "<Firmenname oder null>", "betrag_brutto": <Zahl in Euro oder null>, "datum": "YYYY-MM-DD oder null", "belegnummer": "<oder null>", "zuordnung": "apartments"|"unsicher", "begruendung": "<max 1 Satz>"}
Nichts raten, nur Werte aus der Mail; deutsche Beträge ("119,00 €") als 119.0.
ZUORDNUNG — die Postfächer dienen DREI Firmen: (1) TRIMOSA Apartments & Homes eGbR = FERIENWOHNUNGS-Betrieb (Buchungsportale Booking/Airbnb/FeWo-direkt, Smoobu, Gäste-Software, Wäsche-/Reinigungsservice der Ferienwohnungen), (2) TRIMOSA Immobilien UG und (3) eine Immobilien-GbR (Mehrfamilienhäuser, Bau/Sanierung/Hausverwaltung/Mieter). "apartments" NUR, wenn der Beleg EINDEUTIG zum Ferienwohnungs-Betrieb gehört — Handwerker, Baumärkte, Energie, Versicherungen, Server/IT und alles Mehrdeutige sind "unsicher". Im Zweifel IMMER "unsicher".`,
      `Betreff: ${subject}\n\n${rawText.slice(0, 6000)}`, 700, FAST_MODEL)
    meta = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim())
  } catch { /* fail-soft: ohne Meta → Inbox-Pfad unten */ }
  if (meta.ist_beleg === false) {
    console.log('[inbound-mail] Beleg-Fischer: laut KI kein Beleg —', subject.slice(0, 80))
    return { ok: true, skipped: 'PDF, aber kein Beleg', subject }
  }

  const lieferant = typeof meta.lieferant === 'string' && meta.lieferant.trim()
    ? meta.lieferant.trim().slice(0, 100)
    : ((from.match(/@([\w.-]+)/) || [])[1] ?? 'Unbekannter Absender')
  const betrag = typeof meta.betrag_brutto === 'number' && meta.betrag_brutto > 0
    ? Math.round(meta.betrag_brutto * 100) / 100 : null
  const datum = typeof meta.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(meta.datum) ? meta.datum : null
  const begruendung = typeof meta.begruendung === 'string' ? meta.begruendung.slice(0, 160) : ''

  // Bank-Abgleich: passt eine OFFENE Abbuchung auf dem A&H-Finom zum
  // Betrag? (±90 Tage, alle Online-Konten) → stärkstes Zuordnungs-Signal
  let bankMatch = ''
  if (betrag) {
    try {
      const { findBankAccounts, listBankTransactions } = await import('@/lib/sevdesk-payouts')
      for (const bank of await findBankAccounts()) {
        const txs = await listBankTransactions(bank.id, 90)
        const hit = txs.find((t) => Number(t.status) === 100 && Number(t.amount) < 0
          && Math.abs(Math.abs(Number(t.amount)) - betrag) < 0.01)
        if (hit) {
          bankMatch = ` — passt zur A&H-Bank-Abbuchung vom ${String(hit.valueDate ?? hit.entryDate ?? '').slice(0, 10)}`
          break
        }
      }
    } catch { /* best effort */ }
  }

  const kiHinweis = [
    meta.zuordnung === 'apartments' ? 'KI: eindeutig Apartments & Homes' : 'KI: Zuordnung unsicher',
    begruendung, bankMatch.replace(/^ — /, ''),
  ].filter(Boolean).join(' · ')

  // ── SICHER (Bank-Match oder eindeutige KI-Zuordnung) → direkt sevdesk ──
  const sicher = !!bankMatch || meta.zuordnung === 'apartments'
  if (sicher) {
    const { uploadSevVoucherFile, createSevVoucherDraft } = await import('@/lib/sevdesk')
    let erstellt = 0
    const fehler: string[] = []
    for (const pdf of pdfs) {
      const up = await uploadSevVoucherFile(pdf.buf, pdf.name)
      if (!up.ok || !up.internalFilename) { fehler.push(up.error ?? 'Upload fehlgeschlagen'); continue }
      const v = await createSevVoucherDraft({
        internalFilename: up.internalFilename,
        supplierName: lieferant,
        description: (`Beleg (automatisch aus E-Mail): ${subject}`.slice(0, 140)
          + (betrag ? ` · ${betrag.toFixed(2)} €` : '')
          + (meta.belegnummer ? ` · Nr. ${String(meta.belegnummer).slice(0, 40)}` : '')
          + bankMatch).slice(0, 255),
        ...(datum ? { voucherDate: datum } : {}),
      })
      if (v.ok) erstellt++
      else fehler.push(v.error ?? 'saveVoucher fehlgeschlagen')
    }
    if (erstellt) {
      try {
        const { sendPushToTeam } = await import('@/lib/push')
        await sendPushToTeam('🧾 Beleg → sevdesk (A&H)',
          `${lieferant}${betrag ? ` · ${betrag.toFixed(2)} €` : ''}${bankMatch || ' — eindeutig zugeordnet'}`.slice(0, 140),
          '/team')
      } catch { /* best effort */ }
    }
    if (fehler.length) console.error('[inbound-mail] Beleg-Fischer-Fehler:', fehler)
    console.log('[inbound-mail] Beleg-Fischer → sevdesk:', { lieferant, betrag, datum, erstellt, bankMatch: !!bankMatch })
    return { ok: true, belege: erstellt, lieferant, betrag, bankTreffer: bankMatch || null, fehler }
  }

  // ── UNSICHER → Beleg-Inbox (Inhaber entscheidet Gesellschaft + Kostenstelle) ──
  try {
    if (opts.mailKey) {
      const { data: dupe } = await supabaseAdmin
        .from('beleg_inbox').select('id').eq('mail_key', opts.mailKey).limit(1)
      if (dupe?.length) return { ok: true, skipped: 'Beleg-Inbox: bereits erfasst' }
    }
    await ensureBelegeBucket()
    const rowId = crypto.randomUUID()
    const files: { path: string; name: string }[] = []
    for (const pdf of pdfs) {
      const path = `inbox/${rowId}/${pdf.name.replace(/[^\w.\-]/g, '_').slice(0, 80)}`
      const { error } = await supabaseAdmin.storage.from('belege')
        .upload(path, pdf.buf, { contentType: 'application/pdf', upsert: true })
      if (!error) files.push({ path, name: pdf.name })
    }
    if (!files.length) return { ok: false, error: 'Beleg-Inbox: Storage-Upload fehlgeschlagen' }
    const { error: insErr } = await supabaseAdmin.from('beleg_inbox').insert({
      id: rowId, source: 'mail', mail_key: opts.mailKey ?? null, mailbox: opts.mailbox ?? null,
      from_addr: from.slice(0, 160), subject: subject.slice(0, 200),
      lieferant, betrag, beleg_datum: datum,
      belegnummer: typeof meta.belegnummer === 'string' ? meta.belegnummer.slice(0, 60) : null,
      ki_hinweis: kiHinweis.slice(0, 300), files,
    })
    if (insErr) return { ok: false, error: `Beleg-Inbox: ${insErr.message}` }
    try {
      const { sendPushToTeam } = await import('@/lib/push')
      await sendPushToTeam('🧾 Beleg zur Zuordnung',
        `${lieferant}${betrag ? ` · ${betrag.toFixed(2)} €` : ''} — Gesellschaft/Kostenstelle in der App wählen`.slice(0, 140),
        '/team')
    } catch { /* best effort */ }
    console.log('[inbound-mail] Beleg-Fischer → Inbox:', { lieferant, betrag, datum })
    return { ok: true, belegInbox: rowId, lieferant, betrag }
  } catch (e) {
    return { ok: false, error: `Beleg-Inbox: ${String(e).slice(0, 200)}` }
  }
}

/**
 * §236 C2: Provisionsrechnung eines Portals (v. a. Booking.com kommt per
 * Mail mit PDF) → Datei zu sevdesk hochladen und als Beleg-ENTWURF anlegen.
 * Verbuchung (Reverse-Charge §13b, Zahlung gegen das Verrechnungskonto)
 * macht der Inhaber in der sevdesk-UI bzw. später die KI-Verbuchung.
 */
async function handleCommissionInvoice(attachments: unknown[], from: string, subject: string): Promise<Record<string, unknown>> {
  console.log('[inbound-mail] Provisionsrechnung erkannt:', {
    from: from.slice(0, 60), subject: subject.slice(0, 90), anhaenge: attachments.length,
    keys: attachments[0] && typeof attachments[0] === 'object' ? Object.keys(attachments[0] as object) : [],
  })
  const { uploadSevVoucherFile, createSevVoucherDraft } = await import('@/lib/sevdesk')
  let erstellt = 0
  const fehler: string[] = []
  for (const a of attachments) {
    if (!a || typeof a !== 'object') continue
    const pdf = await pdfFromAttachment(a as Record<string, unknown>)
    if (!pdf) continue
    const up = await uploadSevVoucherFile(pdf.buf, pdf.name)
    if (!up.ok || !up.internalFilename) { fehler.push(up.error ?? 'Upload fehlgeschlagen'); continue }
    const supplier = /booking/i.test(from) ? 'Booking.com B.V.'
      : /airbnb/i.test(from) ? 'Airbnb Ireland UC'
      : /expedia|vrbo|fewo|homeaway/i.test(from) ? 'Expedia Group / Vrbo' : 'Buchungsportal'
    const v = await createSevVoucherDraft({
      internalFilename: up.internalFilename,
      supplierName: supplier,
      description: `Provisionsrechnung (automatisch aus E-Mail): ${subject}`.slice(0, 200),
    })
    if (v.ok) erstellt++
    else fehler.push(v.error ?? 'saveVoucher fehlgeschlagen')
  }
  if (erstellt) {
    try {
      const { sendPushToTeam } = await import('@/lib/push')
      await sendPushToTeam('🧾 Provisionsrechnung eingegangen',
        `${subject.slice(0, 90)} — liegt als Beleg-Entwurf in sevdesk`, '/team')
    } catch { /* best effort */ }
  }
  if (fehler.length) console.error('[inbound-mail] Provisionsrechnung-Fehler:', fehler)
  console.log('[inbound-mail] Provisionsrechnung:', { erstellt, fehler: fehler.length })
  return { ok: true, provisionsBelege: erstellt, fehler }
}

/** Der komplette Klassifikations-Flow für EINE Mail (beide Zubringer). */
export async function processInboundMail(input: InboundMailInput): Promise<Record<string, unknown>> {
  const { from, subject, rawText, attachments } = input
  const mailOpts = { mailbox: input.mailbox, mailKey: input.mailKey }
  const relayEmail = input.relayEmail ?? ''

  // §236 C2: Provisionsrechnung? (Portal-Absender + Rechnungs-Betreff +
  // PDF-Anhang) — VOR dem Body-Längen-Guard, solche Mails sind oft kurz
  const isCommission = /(booking\.com|airbnb|expedia|vrbo|fewo)/i.test(from)
    && /invoice|rechnung|provision|commission|gutschrift/i.test(subject)
    && attachments.length > 0
  if (isCommission) return handleCommissionInvoice(attachments, from, subject)

  if (rawText.trim().length < 80) {
    // Kurzer Body, aber PDF dran → trotzdem durch den Beleg-Fischer
    if (attachments.length) return handleReceiptMail(attachments, from, subject, rawText, mailOpts)
    console.error('[inbound-mail] Mail-Body leer/zu kurz:', subject.slice(0, 80))
    return { ok: true, skipped: 'kein Mail-Text verfügbar' }
  }

  // Kein Portal-Absender → Antwort-Mail eines WEBSITE-Gasts? (§134 — der
  // Gast antwortet einfach auf unsere Bestätigungs-Mail von buchung@)
  // — bzw. Lieferanten-Beleg (§236 C3, entscheidet der Handler selbst)
  const relevant = /fewo-direkt|homeaway|vrbo|booking\.com|airbnb/i.test(from + ' ' + subject)
  if (!relevant) return handleWebsiteGuestReply(from, subject, rawText, attachments, mailOpts)

  // ── Claude extrahiert die Buchungsdaten ──
  const system = `Du extrahierst Buchungsdaten aus der Bestätigungs-E-Mail eines
Ferienwohnungs-Portals (FeWo-direkt/Vrbo, Booking.com, Airbnb …).
Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Markdown):
{
  "portal": "fewo-direkt" | "booking" | "airbnb" | "sonstige",
  "reservierungs_nr": "<z. B. HA-0P0GG8, null wenn nicht da>",
  "objekt_nr": "<Objekt-/Property-Nummer, nur Ziffern, z. B. 5239880, null>",
  "gast_name": "<buchende Person>",
  "urlauber_name": "<reisende Person, falls abweichend, sonst null>",
  "checkin": "YYYY-MM-DD",
  "checkout": "YYYY-MM-DD",
  "erwachsene": <Zahl|null>,
  "kinder": <Zahl|null>,
  "telefon": "<mit Ländervorwahl, null>",
  "email": "<null wenn nicht da>",
  "nachricht": "<NUR wenn die Mail eine persönliche NACHRICHT oder Anfrage des GASTS AN DEN GASTGEBER überbringt: deren reiner Text ohne Fußzeilen/Buttons/Systemtext. NICHT: Bewertungstexte, Buchungs-/Anreise-Erinnerungen, Status- oder Automatik-Mails des Portals — dann null>",
  "buchungsbetrag": <Zahl in Euro — der Betrag OHNE Gäste-Servicegebühr, den der Vermieter ansetzt ("Buchungsbetrag"), null>,
  "auszahlung": <geschätzte Auszahlung an den Vermieter, null>,
  "storniert": <true wenn die Mail eine STORNIERUNG bestätigt, sonst false>
}
Regeln: NUR Werte aus der Mail, nichts raten. Jahreszahlen aus dem Kontext
ableiten (Mail-Datum). Deutsche Zahlen ("465,00 €") als 465.0 ausgeben.`

  let parsed: Record<string, unknown> = {}
  try {
    const raw = await askClaude(system, rawText.slice(0, 12000), 2000)
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim())
  } catch (e) {
    console.error('[inbound-mail] KI-Extraktion fehlgeschlagen:', e)
    return { ok: false, error: 'Extraktion fehlgeschlagen' }
  }
  // STORNO-Mails komplett ignorieren — Stornierungen laufen wie gehabt
  // über den Smoobu-Webhook (der setzt die Buchung auf cancelled); eine
  // Storno-Bestätigung darf hier nichts anreichern
  if (parsed.storniert === true) {
    return { ok: true, skipped: 'Storno-Mail — wird vom Smoobu-Webhook behandelt' }
  }
  // Die Relay-Adresse aus dem Reply-To ist die Adresse, über die der Gast
  // tatsächlich erreichbar ist — sie schlägt eine evtl. im Text gefundene
  if (relayEmail) parsed.email = relayEmail

  const checkin = String(parsed.checkin ?? '')
  const checkout = String(parsed.checkout ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(checkout)) {
    // Gast-NACHRICHT statt Buchungsbestätigung: kein Zeitraum in der Mail,
    // aber ggf. eine Relay-Adresse im Reply-To und/oder ein Nachrichtentext →
    // Buchung über den Gastnamen zuordnen (nur bei EINDEUTIGEM Treffer unter
    // laufenden/kommenden Buchungen), Relay nach Smoobu, Text in den Chat (§129)
    // §240: Chat-Einträge aus Mails NUR für FeWo/HomeAway/Vrbo — Airbnb- und
    // Booking-Nachrichten kommen autoritativ über den Smoobu-Sync; deren
    // Benachrichtigungs-Mails erzeugten sonst Duplikate im Thread
    const fewoSource = /fewo-direkt|homeaway|vrbo/i.test(from + ' ' + subject) || parsed.portal === 'fewo-direkt'
    const msgText = fewoSource && typeof parsed.nachricht === 'string' ? parsed.nachricht.trim() : ''
    if (relayEmail || msgText.length >= 3) {
      const first = String(parsed.gast_name ?? '').trim().toLowerCase().split(/\s+/)[0]
      if (first) {
        const today = new Date().toISOString().slice(0, 10)
        const { data: open } = await supabaseAdmin
          .from('bookings')
          .select('id, guest_name, guest_email, smoobu_reservation_id')
          .gte('check_out', today).neq('status', 'cancelled').limit(200)
        const hits = (open ?? []).filter((b) => (b.guest_name ?? '').toLowerCase().startsWith(first))
        if (hits.length === 1) {
          const b = hits[0]
          if (relayEmail && !b.guest_email) await supabaseAdmin.from('bookings').update({ guest_email: relayEmail }).eq('id', b.id)
          const sm = relayEmail
            ? b.smoobu_reservation_id
              ? await updateReservation(Number(b.smoobu_reservation_id), { email: relayEmail })
              : 'keine smoobu_reservation_id'
            : 'keine relay-adresse'
          const saved = msgText.length >= 3 ? await saveGuestMessage(b.id, b.guest_name, msgText) : false
          console.log('[inbound-mail] Gastnachricht/Relay:', { booking: b.id, relayEmail: relayEmail || '—', nachricht: saved, smoobu: sm ?? 'ok' })
          return { ok: true, bookingId: b.id, relay: relayEmail || null, nachricht: saved, smoobu: sm ?? 'ok' }
        }
        console.log('[inbound-mail] Gastnachricht/Relay ohne eindeutige Buchung:', { first, treffer: hits.length, relayEmail })
      }
    }
    return { ok: true, skipped: 'kein Zeitraum erkannt', parsed }
  }

  // ── Buchung finden: 1) Listing über Portal-Objektnummer in der URL,
  //    2) Zeitraum (+ Kanal-Heuristik als Fallback) ──
  const { data: listings } = await supabaseAdmin
    .from('listings').select('id, title, vrbo_url, booking_url, airbnb_url, smoobu_id').eq('is_active', true)
  const objektNr = String(parsed.objekt_nr ?? '').replace(/\D/g, '')
  const listing = objektNr
    ? (listings ?? []).find((l) => [l.vrbo_url, l.booking_url, l.airbnb_url].some((u) => (u ?? '').includes(objektNr)))
    : null

  let q = supabaseAdmin
    .from('bookings')
    .select('id, listing_id, smoobu_reservation_id, total_price, adults, children, guest_name, guest_email, channel, status')
    .eq('check_in', checkin).eq('check_out', checkout).neq('status', 'cancelled')
  if (listing) q = q.eq('listing_id', listing.id)
  const { data: cands } = await q.limit(5)
  const candList = cands ?? []
  let booking: (typeof candList)[number] | null = candList[0] ?? null
  if (candList.length > 1) {
    // mehrere Buchungen im Zeitraum → über den Vornamen des Buchenden eingrenzen
    const first = String(parsed.gast_name ?? '').trim().toLowerCase().split(/\s+/)[0]
    booking = candList.find((b) => (b.guest_name ?? '').toLowerCase().startsWith(first)) ?? null
  }
  if (!booking) {
    console.log('[inbound-mail] keine passende Buchung:', { checkin, checkout, objektNr, kandidaten: (cands ?? []).length })
    return { ok: true, skipped: 'keine passende Buchung gefunden', parsed }
  }

  // ── Unsere Buchung anreichern (nur LEERE Felder — nie überschreiben) ──
  const upd: Record<string, unknown> = {}
  // §221: cent-genau (total_price ist numeric(10,2))
  const preis = typeof parsed.buchungsbetrag === 'number' ? Math.round(parsed.buchungsbetrag * 100) / 100 : null
  if (preis && (!booking.total_price || booking.total_price === 0)) upd.total_price = preis
  if (typeof parsed.erwachsene === 'number' && parsed.erwachsene > 0 && (booking.adults == null || booking.adults <= 1)) upd.adults = parsed.erwachsene
  if (typeof parsed.kinder === 'number' && (booking.children == null || booking.children === 0) && parsed.kinder > 0) upd.children = parsed.kinder
  if (typeof parsed.email === 'string' && parsed.email.includes('@') && !booking.guest_email) upd.guest_email = parsed.email
  if (Object.keys(upd).length) {
    await supabaseAdmin.from('bookings').update(upd).eq('id', booking.id)
  }

  // ── Preis/Gäste/Telefon auch in SMOOBU nachtragen ──
  let smoobu: string | null = 'keine smoobu_reservation_id'
  if (booking.smoobu_reservation_id) {
    const fields: Record<string, unknown> = {}
    if (preis) fields.price = preis
    if (typeof parsed.erwachsene === 'number' && parsed.erwachsene > 0) fields.adults = parsed.erwachsene
    if (typeof parsed.kinder === 'number' && parsed.kinder >= 0) fields.children = parsed.kinder
    if (typeof parsed.telefon === 'string' && parsed.telefon.length > 5) fields.phone = parsed.telefon
    if (typeof parsed.email === 'string' && parsed.email.includes('@')) fields.email = parsed.email
    smoobu = Object.keys(fields).length
      ? await updateReservation(Number(booking.smoobu_reservation_id), fields)
      : 'nichts zu übertragen'
  }

  // Persönliche Gast-Nachricht (z. B. Anfrage-Mails MIT Zeitraum) → Chat-Thread
  const mainFewo = /fewo-direkt|homeaway|vrbo/i.test(from + ' ' + subject) || parsed.portal === 'fewo-direkt'
  const mainMsg = mainFewo && typeof parsed.nachricht === 'string' ? parsed.nachricht.trim() : ''
  const savedMsg = mainMsg.length >= 3 ? await saveGuestMessage(booking.id, booking.guest_name, mainMsg) : false

  console.log('[inbound-mail] verarbeitet:', {
    booking: booking.id, felder: Object.keys(upd), smoobu: smoobu ?? 'ok',
    portal: parsed.portal, preis, nachricht: savedMsg,
  })
  return { ok: true, bookingId: booking.id, ergaenzt: Object.keys(upd), nachricht: savedMsg, smoobu: smoobu ?? 'ok' }
}

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
import { updateReservation, getRawReservation } from '@/lib/smoobu'

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
  /** FeWo-Daten 1.10.: Empfangszeit (ISO) — die KI leitet daraus die Jahreszahl ab */
  receivedAt?: string
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
  // §241: mailKey-Dedupe VOR allem — deckt Inbox- UND sevdesk-Pfad ab
  // (beleg_inbox protokolliert seit §241 jede verarbeitete Beleg-Mail)
  if (opts.mailKey) {
    const { data: dupe } = await supabaseAdmin
      .from('beleg_inbox').select('id').eq('mail_key', opts.mailKey).limit(1)
    if (dupe?.length) return { ok: true, skipped: 'Beleg bereits erfasst (mailKey)' }
  }
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
      `Du bekommst eine E-Mail (Betreff + Text), an der ein PDF hängt. Entscheide, ob es ein BUCHHALTUNGSBELEG ist (Rechnung, Quittung oder Gutschrift eines Lieferanten/Dienstleisters an TRIMOSA). WICHTIG: Mails, die eine Rechnung/Quittung als PDF ZUSTELLEN („New invoice available", „Your receipt", „recurring payment", „Rechnung im Anhang"), sind Belege — auch wenn der Mail-TEXT selbst nur eine kurze Benachrichtigung ist. KEINE Belege: Angebote, Mahn-/Zahlungs-Erinnerungen ohne Rechnung, Vertragsunterlagen, von TRIMOSA selbst AUSGESTELLTE Rechnungen. Antworte NUR mit JSON:
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

  // §241 Content-Dedupe: dieselbe Beleg-Mail kann über ZWEI Zubringer
  // kommen (Resend-Umleitung + Graph-Scan = verschiedene mailKeys) —
  // gleicher Lieferant + Betrag (+ Datum, wenn vorhanden) = Duplikat
  if (betrag) {
    let dq = supabaseAdmin.from('beleg_inbox').select('id')
      .eq('lieferant', lieferant).eq('betrag', betrag).limit(1)
    // Ohne Beleg-Datum nur ein 21-Tage-Fenster — sonst würde eine
    // wiederkehrende Monatsrechnung (gleicher Betrag) fälschlich geschluckt
    dq = datum ? dq.eq('beleg_datum', datum)
      : dq.gte('created_at', new Date(Date.now() - 21 * 86400_000).toISOString())
    const { data: cDupe } = await dq
    if (cDupe?.length) return { ok: true, skipped: 'Beleg bereits erfasst (Lieferant+Betrag)' }
  }

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
    const voucherIds: string[] = []
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
      if (v.ok) { erstellt++; if (v.voucherId) voucherIds.push(v.voucherId) }
      else fehler.push(v.error ?? 'saveVoucher fehlgeschlagen')
    }
    if (fehler.length) console.error('[inbound-mail] Beleg-Fischer-Fehler:', fehler)
    if (erstellt) {
      // Protokollzeile → mailKey-/Content-Dedupe greifen auch für diesen Pfad
      // §242 Beleg-Viewer: PDF-Kopie in unseren Storage, damit die
      // Buchhaltungs-Oberfläche den Beleg beim Verbuchen ANZEIGEN kann
      const rowId = crypto.randomUUID()
      const files: { path: string; name: string }[] = []
      try {
        await ensureBelegeBucket()
        for (const pdf of pdfs) {
          const path = `sevdesk/${rowId}/${pdf.name.replace(/[^\w.\-]/g, '_').slice(0, 80)}`
          const { error: upErr } = await supabaseAdmin.storage.from('belege')
            .upload(path, pdf.buf, { contentType: 'application/pdf', upsert: true })
          if (!upErr) files.push({ path, name: pdf.name })
        }
      } catch { /* Viewer-Kopie best effort */ }
      const protRow: Record<string, unknown> = {
        id: rowId, source: 'mail', mail_key: opts.mailKey ?? null, mailbox: opts.mailbox ?? null,
        from_addr: from.slice(0, 160), subject: subject.slice(0, 200),
        lieferant, betrag, beleg_datum: datum,
        ki_hinweis: kiHinweis.slice(0, 300), files, status: 'sevdesk',
        sevdesk_voucher_id: voucherIds[0] ?? null,
      }
      let { error: protErr } = await supabaseAdmin.from('beleg_inbox').insert(protRow)
      if (protErr && /sevdesk_voucher_id/.test(protErr.message)) {
        delete protRow.sevdesk_voucher_id
        ;({ error: protErr } = await supabaseAdmin.from('beleg_inbox').insert(protRow))
      }
      if (protErr) console.error('[inbound-mail] Protokollzeile:', protErr.message)
    }
    // §243f VOLL-AUTOMATIK: sichere Kategorien (Provisionen deterministisch,
    // gelernte Lieferanten mit Leistungs-Check) werden DIREKT verbucht inkl.
    // Zahlungs-Match + App-Zuordnung; der Push nennt das Endergebnis
    let autoText = ''
    if (erstellt && voucherIds[0]) {
      try {
        const { autoVerbucheBeleg } = await import('@/lib/beleg-ki')
        const auto = await autoVerbucheBeleg(voucherIds[0])
        autoText = auto.text
        try {
          const { sendPushToTeam } = await import('@/lib/push')
          await sendPushToTeam(auto.auto ? '✅ Beleg automatisch verbucht' : '🧾 Beleg → sevdesk (A&H)',
            `${lieferant} — ${auto.text}`.slice(0, 150), '/buchhaltung', { buchhaltung: true })
        } catch { /* best effort */ }
      } catch (e) { console.error('[inbound-mail] Auto-Verbuchung:', String(e).slice(0, 200)) }
    }
    console.log('[inbound-mail] Beleg-Fischer → sevdesk:', { lieferant, betrag, datum, erstellt, bankMatch: !!bankMatch, autoText })
    return { ok: true, belege: erstellt, lieferant, betrag, bankTreffer: bankMatch || null, auto: autoText || null, fehler }
  }

  // ── UNSICHER → Beleg-Inbox (Inhaber entscheidet Gesellschaft + Kostenstelle) ──
  try {
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
        '/buchhaltung', { buchhaltung: true })
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
async function handleCommissionInvoice(attachments: unknown[], from: string, subject: string, opts: { mailbox?: string; mailKey?: string } = {}): Promise<Record<string, unknown>> {
  if (opts.mailKey) {
    const { data: dupe } = await supabaseAdmin
      .from('beleg_inbox').select('id').eq('mail_key', opts.mailKey).limit(1)
    if (dupe?.length) return { ok: true, skipped: 'Provisionsrechnung bereits erfasst (mailKey)' }
  }
  console.log('[inbound-mail] Provisionsrechnung erkannt:', {
    from: from.slice(0, 60), subject: subject.slice(0, 90), anhaenge: attachments.length,
    keys: attachments[0] && typeof attachments[0] === 'object' ? Object.keys(attachments[0] as object) : [],
  })
  const { uploadSevVoucherFile, createSevVoucherDraft } = await import('@/lib/sevdesk')
  let erstellt = 0
  const commVoucherIds: string[] = []
  const fehler: string[] = []
  for (const a of attachments) {
    if (!a || typeof a !== 'object') continue
    const pdf = await pdfFromAttachment(a as Record<string, unknown>)
    if (!pdf) continue
    const up = await uploadSevVoucherFile(pdf.buf, pdf.name)
    if (!up.ok || !up.internalFilename) { fehler.push(up.error ?? 'Upload fehlgeschlagen'); continue }
    const supplier = /hometogo/i.test(from) ? 'HomeToGo GmbH'
      : /booking/i.test(from) ? 'Booking.com B.V.'
      : /airbnb/i.test(from) ? 'Airbnb Ireland UC'
      : /expedia|vrbo|fewo|homeaway/i.test(from) ? 'Expedia Group / Vrbo' : 'Buchungsportal'
    const v = await createSevVoucherDraft({
      internalFilename: up.internalFilename,
      supplierName: supplier,
      description: `Provisionsrechnung (automatisch aus E-Mail): ${subject}`.slice(0, 200),
    })
    if (v.ok) { erstellt++; if (v.voucherId) commVoucherIds.push(v.voucherId) }
    else fehler.push(v.error ?? 'saveVoucher fehlgeschlagen')
  }
  if (fehler.length) console.error('[inbound-mail] Provisionsrechnung-Fehler:', fehler)
  if (erstellt) {
    const protRow: Record<string, unknown> = {
      source: 'mail', mail_key: opts.mailKey ?? null, mailbox: opts.mailbox ?? null,
      from_addr: from.slice(0, 160), subject: subject.slice(0, 200),
      lieferant: 'Provisionsrechnung', ki_hinweis: 'automatisch → sevdesk-Entwurf',
      files: [], status: 'sevdesk',
      sevdesk_voucher_id: commVoucherIds[0] ?? null,
    }
    let { error: protErr } = await supabaseAdmin.from('beleg_inbox').insert(protRow)
    if (protErr && /sevdesk_voucher_id/.test(protErr.message)) {
      delete protRow.sevdesk_voucher_id
      ;({ error: protErr } = await supabaseAdmin.from('beleg_inbox').insert(protRow))
    }
    if (protErr) console.error('[inbound-mail] Protokollzeile:', protErr.message)
  }
  // §243f: Provisionsrechnungen sind deterministisch (5923/§13b) → die
  // Voll-Automatik bucht sie direkt (Betrag liest die Vision aus dem PDF)
  let autoText = ''
  if (erstellt && commVoucherIds[0]) {
    try {
      const { autoVerbucheBeleg } = await import('@/lib/beleg-ki')
      const auto = await autoVerbucheBeleg(commVoucherIds[0])
      autoText = auto.text
      try {
        const { sendPushToTeam } = await import('@/lib/push')
        await sendPushToTeam(auto.auto ? '✅ Provisionsrechnung automatisch verbucht' : '🧾 Provisionsrechnung eingegangen',
          `${subject.slice(0, 80)} — ${auto.text}`.slice(0, 150), '/buchhaltung', { buchhaltung: true })
      } catch { /* best effort */ }
    } catch (e) { console.error('[inbound-mail] Auto-Verbuchung:', String(e).slice(0, 200)) }
  }
  console.log('[inbound-mail] Provisionsrechnung:', { erstellt, fehler: fehler.length, autoText })
  return { ok: true, provisionsBelege: erstellt, auto: autoText || null, fehler }
}

/** Der komplette Klassifikations-Flow für EINE Mail (beide Zubringer). */
/**
 * Paragraph 298: Smoobu ignoriert Gastfelder (Name/E-Mail/Telefon) bei KANAL-Reservierungen still -
 * Antwort "Resource updated successfully", Feld bleibt leer (Test 9.9. an 135034132, beide Schreibweisen).
 * Die Reservierungs-NOTIZ uebernimmt Smoobu sehr wohl - dort landen die Werte als eine Zeile
 * "TRIMOSA-App · Gast: ... · E-Mail (FeWo-Messenger): ... · Tel: ..." (idempotent: Zeile wird ersetzt).
 * Liefert 'notiz' | 'felder ok' | 'nichts' | Fehlertext.
 */
export async function noteGuestDataInSmoobu(smoobuId: number, want: { name?: string | null; email?: string | null; phone?: string | null }): Promise<string> {
  const name = (want.name ?? '').replace(/\s+/g, ' ').trim()
  const email = (want.email ?? '').trim()
  const phone = (want.phone ?? '').trim()
  if (!name.includes(' ') && !email && !phone) return 'nichts'
  const raw = await getRawReservation(smoobuId)
  if (!raw) return 'smoobu liefert nichts'
  const has = (v: unknown) => typeof v === 'string' && v.trim().length > 0
  const nameMissing = name.includes(' ') && !has(raw.lastname)
  const mailMissing = !!email && !has(raw.email)
  const telMissing = !!phone && !has(raw.phone)
  if (!nameMissing && !mailMissing && !telMissing) return 'felder ok'
  const parts: string[] = []
  if (name) parts.push(`Gast: ${name}`)
  if (email) parts.push(`E-Mail (FeWo-Messenger): ${email}`)
  if (phone) parts.push(`Tel: ${phone}`)
  const line = `TRIMOSA-App · ${parts.join(' · ')}`
  const cur = String(raw.notice ?? '').split('\n').filter((l) => !l.trim().startsWith('TRIMOSA-App')).join('\n').trim()
  const notice = cur ? `${cur}\n${line}` : line
  if (String(raw.notice ?? '').trim() === notice) return 'notiz (unveraendert)'
  const err = await updateReservation(smoobuId, { notice })
  return err ? `notiz-fehler: ${err}` : 'notiz'
}

/* ── FeWo-Daten (1.10.): Helfer für die Zuordnung Mail → Buchung und die Aufgabe „Gastdaten fehlen" ── */

/** Platzhalter, die Smoobu/der Webhook setzen, wenn das Portal keinen Gastnamen liefert */
const NAME_PLACEHOLDER_RE = /^(externer gast|gast|guest|unbekannt|unknown|reserved|not available|blocked)$/i
const NAME_STOP = new Set(['dr', 'prof', 'herr', 'frau', 'mr', 'mrs', 'ms', 'und', 'and', 'von', 'van', 'de', 'der', 'den', 'di', 'la', 'le',
  'fuer', 'fur', 'an', 'from', 'for', 'to', 'gesendet', 'fewo', 'direkt', 'vrbo', 'homeaway', 'trimosa', 'gmbh', 'gast', 'guest', 'externer'])
/** Betreff-Muster der FeWo-Mails: „Sofortbuchung von X Y: …", „Reservierung für X Y: …", „… gesendet an X Y: …" */
const FEWO_SUBJ_NAME_RE = /(?:von|für|fuer|an|from|for|to)\s+([\p{L}'’.\- ]{3,60}?)(?:\s+gesendet)?:\s/iu

/** Namens-Tokens für den Abgleich Mail ↔ Buchung: klein, ohne Akzente (Jörg = Joerg), Bindestrich-Namen in Teilen
 *  (Hans-Dieter → hans, dieter), ohne Titel/Präpositionen. */
export function nameToks(n: string | null | undefined): string[] {
  return (n ?? '')
    .replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((t) => t.length >= 2 && !NAME_STOP.has(t))
    .map((t) => t.replace(/([aou])e/g, '$1'))
}

/** Aufgabe „Nachname fehlt" entsteht erst so viele Tage vor der Anreise (auch für die Diagnose-Zählung). */
export const FEWO_NAME_TASK_DAYS = 30

/** Was einer FeWo-direkt-Buchung fehlt: E-Mail (= kein Chat-Kanal) und/oder Nachname (einwortiger/leerer Name). */
export function fewoMissing(b: { guest_name: string | null; guest_email: string | null }): ('E-Mail' | 'Nachname')[] {
  const out: ('E-Mail' | 'Nachname')[] = []
  if (!(b.guest_email ?? '').includes('@')) out.push('E-Mail')
  const n = (b.guest_name ?? '').replace(/\s+/g, ' ').trim()
  if (!n || NAME_PLACEHOLDER_RE.test(n) || n.split(' ').length < 2) out.push('Nachname')
  return out
}

/** Kanal einer Buchung grob einordnen — Substring-Falle (§140/§262): fewo VOR direkt VOR booking.
 *  null = neutral (Smoobu, iCal-Name, Website, Direktbuchung …). */
function portalKind(channel: string | null | undefined): 'fewo' | 'airbnb' | 'booking' | 'sonstig' | null {
  const v = (channel ?? '').toLowerCase()
  if (/fewo|homeaway|vrbo|abritel/.test(v)) return 'fewo'
  if (/website|trimosa|direct|direkt/.test(v)) return null
  if (/airbnb/.test(v)) return 'airbnb'
  if (/booking/.test(v)) return 'booking'
  if (/hometogo|holidu|agoda|tripadvisor/.test(v)) return 'sonstig'
  return null
}

interface PortalCand { id: string; listing_id: string | null; guest_name: string | null; guest_email: string | null; channel: string | null; status?: string | null }

/**
 * FeWo-Daten (1.10.): die Buchung zu einer Portal-Buchungsmail wählen — unter den Buchungen mit EXAKT dem
 * Zeitraum der Mail. Reihenfolge: Relay-Adresse → Wohnung (Objektnummer in der Portal-URL) → Kanal → Name.
 * Vorher wurde ein einzelner Kandidat blind genommen (auch eine Booking-/Airbnb-Buchung mit gleichem
 * Wochenende, solange die FeWo-Buchung noch nicht importiert war) und bei mehreren entschied
 * startsWith(Vorname) — „hans-dieter".startsWith("dieter") ist false. Jetzt: Buchungen eines ANDEREN Portals
 * scheiden aus, Namen werden über Tokens verglichen, und ohne Wohnungs-Treffer (Wohnung ohne passende
 * vrbo_url) zählt ein einzelner Kandidat nur, wenn Kanal UND Name nicht widersprechen. Kein Treffer =
 * die Mail bleibt in der Warteschlange (pending) statt eine fremde Buchung anzureichern.
 * `strict` (Mail älter als 72 h): Auch MIT Wohnungs-Treffer zählt der einzelne Kandidat nur noch, wenn sein
 * Name dem der Mail nicht widerspricht — sonst bekäme ein ANDERER Gast, der dieselbe Wohnung später für exakt
 * denselben Zeitraum bucht (Anfrage ohne Buchung, Storno vor dem Import), Relay-Adresse und Daten der alten Mail.
 */
export function pickPortalBooking<T extends PortalCand>(
  cands: T[],
  o: { listingId: string | null; portal: 'fewo' | 'booking' | 'airbnb' | null; names: string[]; relayEmail?: string; strict?: boolean },
): { booking: T | null; grund: string } {
  const relay = (o.relayEmail ?? '').trim().toLowerCase()
  if (relay) {
    const hit = cands.find((b) => (b.guest_email ?? '').trim().toLowerCase() === relay)
    if (hit) return { booking: hit, grund: 'relay-adresse' }
  }
  // unbezahlte Website-Anfragen (status pending) sind nie das Ziel einer Portal-Mail
  let pool = cands.filter((b) => b.status !== 'pending')
  if (o.listingId) pool = pool.filter((b) => b.listing_id === o.listingId)
  const own = o.portal ? pool.filter((b) => portalKind(b.channel) === o.portal) : []
  // Buchungen eines anderen Portals scheiden aus; kanal-neutrale (Smoobu/iCal) bleiben Kandidaten
  if (o.portal) pool = own.length ? own : pool.filter((b) => portalKind(b.channel) === null)
  if (!pool.length) return { booking: null, grund: `kein Kandidat (${cands.length} im Zeitraum, Wohnung/Kanal passt nicht)` }
  const mailToks = new Set(o.names.flatMap(nameToks))
  const scored = pool
    .map((b) => ({ b, n: nameToks(b.guest_name).filter((t) => mailToks.has(t)).length }))
    .filter((x) => x.n > 0)
    .sort((a, c) => c.n - a.n)
  if (scored.length === 1 || (scored.length > 1 && scored[0].n > scored[1].n)) return { booking: scored[0].b, grund: 'name' }
  if (scored.length > 1) return { booking: null, grund: `mehrdeutig: ${scored.length} Namens-Treffer` }
  if (pool.length === 1) {
    // Widerspruch = die Buchung hat einen echten Namen (kein Platzhalter wie „Externer Gast"/„Unbekannt"),
    // die Mail auch, und kein Namensteil deckt sich (sonst hätte oben der Namens-Treffer gegriffen)
    const candHasName = !NAME_PLACEHOLDER_RE.test((pool[0].guest_name ?? '').replace(/\s+/g, ' ').trim()) && nameToks(pool[0].guest_name).length > 0
    const widerspruch = candHasName && mailToks.size > 0
    // genau eine Buchung dieser Wohnung im Zeitraum → sicher, auch ohne Namens-Treffer (anderer Rufname) —
    // außer bei einer alten Mail (strict): dann kann es die Buchung eines späteren, anderen Gasts sein
    if (o.listingId) {
      return o.strict && widerspruch
        ? { booking: null, grund: 'einziger Kandidat der Wohnung, aber anderer Name (alte Mail)' }
        : { booking: pool[0], grund: 'objektnummer' }
    }
    // ohne Wohnungs-Treffer: nur wenn der Kanal passt und die Namen sich nicht widersprechen
    if (own.length === 1 && !widerspruch) return { booking: pool[0], grund: 'kanal+zeitraum' }
    return { booking: null, grund: own.length === 1 ? 'einziger Kandidat, aber anderer Name' : 'einziger Kandidat ohne Kanal-/Namens-Treffer' }
  }
  return { booking: null, grund: `kein Namens-Treffer unter ${pool.length} Kandidaten` }
}

export async function processInboundMail(input: InboundMailInput, opts: { belegeOnly?: boolean; preParsed?: Record<string, unknown> } = {}): Promise<Record<string, unknown>> {
  const { from, subject, rawText, attachments } = input
  // FeWo-Daten 1.10.: pending-Wiederholung ohne erneuten KI-/Graph-Abruf — die beim Erstlauf extrahierten
  // Daten kommen fertig mit (lib/graph-mail). Dann entfallen Klassifikation und Extraktion.
  const pre = opts.preParsed && typeof opts.preParsed === 'object' ? opts.preParsed : null
  const mailOpts = { mailbox: input.mailbox, mailKey: input.mailKey }
  const relayEmail = input.relayEmail ?? ''

  // §236 C2: Provisionsrechnung? (Portal-Absender + Rechnungs-Betreff +
  // PDF-Anhang) — VOR dem Body-Längen-Guard, solche Mails sind oft kurz
  const isCommission = /(booking\.com|airbnb|expedia|vrbo|fewo|hometogo)/i.test(from)
    && /invoice|rechnung|provision|commission|gutschrift/i.test(subject)
    && attachments.length > 0
  if (isCommission) return handleCommissionInvoice(attachments, from, subject, mailOpts)

  // §241 Historien-Modus („nur Belege"): NUR der Beleg-Fischer läuft —
  // Gast-/Portal-Klassifikation alter Mails würde rückwirkend Chat-Einträge
  // mit heutigem Datum erzeugen
  if (opts.belegeOnly) {
    if (attachments.length) return handleReceiptMail(attachments, from, subject, rawText, mailOpts)
    return { ok: true, skipped: 'belege-only: kein Anhang' }
  }

  if (!pre && rawText.trim().length < 80) {
    // Kurzer Body, aber PDF dran → trotzdem durch den Beleg-Fischer
    if (attachments.length) return handleReceiptMail(attachments, from, subject, rawText, mailOpts)
    console.error('[inbound-mail] Mail-Body leer/zu kurz:', subject.slice(0, 80))
    return { ok: true, skipped: 'kein Mail-Text verfügbar' }
  }

  // Kein Portal-Absender → Antwort-Mail eines WEBSITE-Gasts? (§134 — der
  // Gast antwortet einfach auf unsere Bestätigungs-Mail von buchung@)
  // — bzw. Lieferanten-Beleg (§236 C3, entscheidet der Handler selbst)
  const relevant = /fewo-direkt|homeaway|vrbo|booking\.com|airbnb/i.test(from + ' ' + subject)
  if (!pre && !relevant) return handleWebsiteGuestReply(from, subject, rawText, attachments, mailOpts)
  // Paragraph 296: Bewertungs-Aufforderungen der Portale sind keine Buchungsmails - die KI las daraus
  // Zeitraeume und ordnete sie alten Buchungen zu (Jeannett, 1.9.)
  if (/@reviews?\.homeaway\.com|noreply@review/i.test(from) || /^(Schreiben Sie eine Bewertung|Bewerten Sie|Write a review|Rate your)/i.test(subject.trim())) {
    return { ok: true, skipped: 'Bewertungsaufforderung des Portals' }
  }

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
  if (pre) parsed = { ...pre }
  else try {
    // FeWo-Daten 1.10.: Empfangsdatum als Kopfzeile — der Prompt verlangt „Jahreszahlen aus dem Mail-Datum",
    // die KI bekam das Datum aber nie zu sehen
    const head = `Empfangen am: ${(input.receivedAt || new Date().toISOString()).slice(0, 10)}\n\n`
    const raw = await askClaude(system, head + rawText.slice(0, 12000), 2000)
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim())
  } catch (e) {
    console.error('[inbound-mail] KI-Extraktion fehlgeschlagen:', e)
    // retry: der Graph-Scan versucht FeWo-Mails nach einem KI-Aussetzer noch einige Stunden erneut
    return { ok: false, error: 'Extraktion fehlgeschlagen', retry: true }
  }
  // STORNO-Mails komplett ignorieren — Stornierungen laufen wie gehabt
  // über den Smoobu-Webhook (der setzt die Buchung auf cancelled); eine
  // Storno-Bestätigung darf hier nichts anreichern
  if (parsed.storniert === true) {
    // storno + parsed: lib/graph-mail streicht damit eine noch WARTENDE Buchungsmail derselben Reservierung
    return { ok: true, skipped: 'Storno-Mail — wird vom Smoobu-Webhook behandelt', storno: true, parsed }
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
      // Paragraph 305 (Pascal 18:22): Antworten aus dem FeWo-Messenger kommen mit der privaten Relay-Adresse als
      // Reply-To - die kennen wir je Buchung (guest_email). Exakter Treffer VOR der Vornamens-Heuristik.
      if (relayEmail) {
        const since = new Date(Date.now() - 45 * 86400_000).toISOString().slice(0, 10)
        const { data: byRelay } = await supabaseAdmin
          .from('bookings')
          .select('id, guest_name, guest_email, smoobu_reservation_id')
          .ilike('guest_email', relayEmail).neq('status', 'cancelled').gte('check_out', since)
          .order('check_in', { ascending: false }).limit(2)
        if (byRelay && byRelay.length >= 1) {
          const b = byRelay[0]
          const saved = msgText.length >= 3 ? await saveGuestMessage(b.id, b.guest_name, msgText) : false
          console.log('[inbound-mail] Gastnachricht per Relay-Adresse zugeordnet:', { booking: b.id, nachricht: saved })
          return { ok: true, bookingId: b.id, relay: relayEmail, nachricht: saved, zuordnung: 'relay-adresse' }
        }
      }
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
          // Paragraph 298: Smoobu verwirft das E-Mail-Feld bei Kanal-Buchungen -> Relay in die Notiz
          if (relayEmail && b.smoobu_reservation_id) {
            try { await noteGuestDataInSmoobu(Number(b.smoobu_reservation_id), { name: b.guest_name, email: relayEmail }) }
            catch (e) { console.error('[inbound-mail] Smoobu-Notiz:', String(e).slice(0, 120)) }
          }
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
  const fewoMail = /fewo-direkt|homeaway|vrbo/i.test(from + ' ' + subject) || parsed.portal === 'fewo-direkt'
  const portal = fewoMail ? 'fewo' as const
    : /booking\.com/i.test(from + ' ' + subject) || parsed.portal === 'booking' ? 'booking' as const
    : /airbnb/i.test(from + ' ' + subject) || parsed.portal === 'airbnb' ? 'airbnb' as const
    : null
  // FeWo-Daten 1.10.: Die Objektnummer steht bei FeWo deterministisch im Betreff („… FeWo-direkt.de #5490143") —
  // die KI sieht nur den Body und liefert sie oft nicht (oder eine andere Nummer). Beide Nummern gegen die
  // URL des jeweiligen Portals prüfen; mindestens 5 Ziffern, sonst träfe includes() jede URL.
  const objektNrs = [
    String(parsed.objekt_nr ?? '').replace(/\D/g, ''),
    fewoMail ? subject.match(/#\s?(\d{5,10})\b/)?.[1] ?? '' : '',
  ].filter((n, i, a) => n.length >= 5 && a.indexOf(n) === i)
  const objektNr = objektNrs.join('/')
  const listing = (listings ?? []).find((l) =>
    (portal === 'fewo' ? [l.vrbo_url] : portal === 'booking' ? [l.booking_url] : portal === 'airbnb' ? [l.airbnb_url] : [l.vrbo_url, l.booking_url, l.airbnb_url])
      .some((u) => objektNrs.some((n) => (u ?? '').includes(n)))) ?? null

  // Alle Buchungen mit exakt diesem Zeitraum (neueste zuerst) — die Auswahl trifft pickPortalBooking:
  // Relay-Adresse → Wohnung → Kanal → Namens-Tokens. Kein blinder Einzelkandidat mehr.
  const { data: cands } = await supabaseAdmin
    .from('bookings')
    .select('id, listing_id, smoobu_reservation_id, total_price, adults, children, guest_name, guest_email, channel, status')
    .eq('check_in', checkin).eq('check_out', checkout).neq('status', 'cancelled')
    .order('created_at', { ascending: false }).limit(40)
  const candList = cands ?? []
  // Namen aus allen Quellen der Mail: Absender-Anzeigename (nur FeWo-Relay), Betreff, KI (Bucher + Reisender)
  const matchNames = [
    fewoMail && /@messages\.homeaway\.com/i.test(from) ? from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] ?? '' : '',
    fewoMail ? subject.match(FEWO_SUBJ_NAME_RE)?.[1] ?? '' : '',
    String(parsed.gast_name ?? ''), String(parsed.urlauber_name ?? ''),
  ]
  // Prüfung 1.10.: Mail älter als 72 h (lange pending-Wartezeit, Rescan) → strenger — der einzelne Kandidat der
  // Wohnung zählt nur noch ohne Namens-Widerspruch (sonst träfe eine alte Mail die Buchung eines späteren Gasts)
  const mailAlt = !!input.receivedAt && Date.now() - Date.parse(input.receivedAt) > 72 * 3600_000
  const { booking, grund } = pickPortalBooking(candList, { listingId: listing?.id ?? null, portal, names: matchNames, relayEmail, strict: mailAlt })
  if (!booking) {
    console.log('[inbound-mail] keine passende Buchung:', { checkin, checkout, objektNr, wohnung: listing?.title ?? null, kandidaten: candList.length, grund })
    // Der skipped-Text ist der pending-Auslöser in lib/graph-mail — NICHT ändern.
    // fewo = lange Wartezeit (bis Anreise) nur für echte BUCHUNGSmails — eine Anfrage wird oft nie zur Buchung
    // und träfe sonst Wochen später einen anderen Gast mit demselben Zeitraum
    return { ok: true, skipped: 'keine passende Buchung gefunden', grund, fewo: fewoMail && !/anfrage|inquiry|enquiry|request/i.test(subject), objektNr: objektNr || null, parsed }
  }

  // ── Unsere Buchung anreichern (nur LEERE Felder — nie überschreiben) ──
  const upd: Record<string, unknown> = {}
  // §221: cent-genau (total_price ist numeric(10,2))
  const preis = typeof parsed.buchungsbetrag === 'number' ? Math.round(parsed.buchungsbetrag * 100) / 100 : null
  if (preis && (!booking.total_price || booking.total_price === 0)) upd.total_price = preis
  if (typeof parsed.erwachsene === 'number' && parsed.erwachsene > 0 && (booking.adults == null || booking.adults <= 1)) upd.adults = parsed.erwachsene
  if (typeof parsed.kinder === 'number' && (booking.children == null || booking.children === 0) && parsed.kinder > 0) upd.children = parsed.kinder
  if (typeof parsed.email === 'string' && parsed.email.includes('@') && !booking.guest_email) upd.guest_email = parsed.email
  // §293 (Pascal): VOLLER Name aus der Buchungsmail — Portale liefern oft nur den Vornamen
  // Paragraph 296: voller Name deterministisch aus dem FeWo-Betreff (Sofortbuchung von Michael Barth: ...,
  // Reservierung fuer Johannes Pohlschneider: ..., ... gesendet an Anja Keuter: ...) - die KI-Extraktion
  // liefert aus dem Body oft nur den Vornamen (Pohlschneider blieb beim Rescan 9.9. einwortig)
  // Paragraph 314 (Hans-Dieter Meinecke, 16.9.): Der Betreff lautete "Sofortbuchung von dieter meinecke: ..." (klein
  // geschrieben, anderer Rufname) - die Grossbuchstaben-Pruefung und die Praefix-Regel verwarfen ihn. Jetzt drei
  // Quellen in dieser Reihenfolge: Anzeigename des Absenders (FeWo-Relay-Mails tragen den Gastnamen im From),
  // Betreff, KI-Extraktion. Kleinschreibung wird normalisiert; der Name wird uebernommen, wenn sich ein
  // Vornamens-Teil mit unserem bisherigen Namen deckt (Hans-Dieter ~ dieter).
  const cap = (w: string) => w.split('-').map((x) => (x ? x[0].toLocaleUpperCase('de') + x.slice(1) : x)).join('-')
  const cleanName = (raw: string) => {
    // Pruefung 1.10.: Titel/Anrede vorn abschneiden (Dr. Dieter Meinecke -> sonst "Hans-Dieter Dr. Meinecke")
    const n = raw.replace(/\s+/g, ' ').trim().replace(/^(?:(?:dr|prof|herr|frau|mr|mrs|ms)\.?\s+)+/i, '')
    if (!/^[\p{L}'\u2019.\- ]{3,60}$/u.test(n) || n.split(' ').length < 2 || n.split(' ').length > 4) return ''
    if (/fewo|vrbo|homeaway|expedia|booking|airbnb|trimosa/i.test(n)) return ''
    return n === n.toLowerCase() || n === n.toUpperCase() ? n.toLowerCase().split(' ').map(cap).join(' ') : n
  }
  const fromName = fewoMail && /@messages\.homeaway\.com/i.test(from)
    ? cleanName((from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] ?? ''))
    : ''
  const subjName = fewoMail
    ? cleanName(subject.match(/(?:von|f\u00fcr|fuer|an|from|for|to)\s+([\p{L}'\u2019.\- ]{3,60}?)(?:\s+gesendet)?:\s/iu)?.[1] ?? '')
    : ''
  const aiName = cleanName(String(parsed.gast_name ?? ''))
  // Pruefung 1.10.: Platzhalter ("Externer Gast" aus dem Webhook) zaehlt wie ein leerer Name - sonst wuerde er nie ersetzt
  const oursRaw = (booking.guest_name ?? '').replace(/\s+/g, ' ').trim()
  const oursName = NAME_PLACEHOLDER_RE.test(oursRaw) ? '' : oursRaw
  // Pruefung 1.10.: derselbe Tokenizer wie bei der Zuordnung (Joerg = Jörg, Mueller = Müller)
  const toks = (n: string) => nameToks(n)
  const oursToks = new Set(toks(oursName))
  // Pruefung 1.10.: Haben wir selbst KEINEN Namen, zaehlt der Absender-Anzeigename nur, wenn Betreff oder KI ihn
  // bestaetigen - sonst landete ein Anzeigename wie "Gastgeber Support" ungeprueft als Gastname in der Buchung
  const confirmToks = new Set([subjName, aiName].flatMap(nameToks))
  const fromOk = !!oursName || nameToks(fromName).some((t) => confirmToks.has(t))
  let fullName = ''
  if (!oursName || oursName.split(' ').length === 1) {
    for (const cand of [fromOk ? fromName : '', subjName, aiName]) {
      if (!cand) continue
      // Pruefung 1.10.: auch "Anna" -> "Anna-Lena Schmidt" (Bindestrich nach unserem Vornamen) gilt als Praefix -
      // der Smoobu-Webhook schuetzt den vollen Namen nur, wenn er mit Smoobus Namen BEGINNT
      const lc = cand.toLowerCase(), ol = oursName.toLowerCase()
      if (!oursName || lc.startsWith(ol + ' ') || lc.startsWith(ol + '-')) { fullName = cand; break }
      // anderer Rufname: Nachname = alle Woerter, die NICHT zu unserem Vornamen gehoeren
      // (some statt every: "Dieter" + "Hans-Dieter Meinecke" -> "Dieter Meinecke")
      const words = cand.split(' ')
      const rest = words.filter((w) => !toks(w).some((t) => oursToks.has(t)))
      if (rest.length && rest.length < words.length) { fullName = `${oursName} ${rest.join(' ')}`; break }
    }
  }
  const nameParts = fullName.split(' ')
  if (fullName && nameParts.length >= 2 && fullName.length <= 80) {
    upd.guest_name = fullName
  }
  if (Object.keys(upd).length) {
    await supabaseAdmin.from('bookings').update(upd).eq('id', booking.id)
  }

  // ── Preis/Gäste/Telefon auch in SMOOBU nachtragen ──
  let smoobu: string | null = 'keine smoobu_reservation_id'
  let notiz = '-'
  if (booking.smoobu_reservation_id) {
    const fields: Record<string, unknown> = {}
    if (preis) fields.price = preis
    if (typeof parsed.erwachsene === 'number' && parsed.erwachsene > 0) fields.adults = parsed.erwachsene
    if (typeof parsed.kinder === 'number' && parsed.kinder >= 0) fields.children = parsed.kinder
    if (typeof parsed.telefon === 'string' && parsed.telefon.length > 5) fields.phone = parsed.telefon
    if (typeof parsed.email === 'string' && parsed.email.includes('@')) fields.email = parsed.email
    // Paragraph 297: Smoobu-PUT erwartet camelCase (wie createReservation) - firstname/lastname wurden still ignoriert
    if (typeof upd.guest_name === 'string') { fields.firstName = nameParts[0]; fields.lastName = nameParts.slice(1).join(' ') }
    smoobu = Object.keys(fields).length
      ? await updateReservation(Number(booking.smoobu_reservation_id), fields)
      : 'nichts zu übertragen'
    // Paragraph 298: Gastdaten, die Smoobu in den Feldern verwirft, in die Reservierungs-Notiz
    try {
      notiz = await noteGuestDataInSmoobu(Number(booking.smoobu_reservation_id), {
        name: typeof upd.guest_name === 'string' ? upd.guest_name : booking.guest_name,
        email: typeof parsed.email === 'string' && parsed.email.includes('@') ? parsed.email : booking.guest_email,
        phone: typeof parsed.telefon === 'string' && parsed.telefon.length > 5 ? parsed.telefon : null,
      })
    } catch (e) { notiz = `notiz-fehler: ${String(e).slice(0, 80)}` }
  }

  // Persönliche Gast-Nachricht (z. B. Anfrage-Mails MIT Zeitraum) → Chat-Thread
  const mainFewo = /fewo-direkt|homeaway|vrbo/i.test(from + ' ' + subject) || parsed.portal === 'fewo-direkt'
  const mainMsg = mainFewo && typeof parsed.nachricht === 'string' ? parsed.nachricht.trim() : ''
  const savedMsg = mainMsg.length >= 3 ? await saveGuestMessage(booking.id, booking.guest_name, mainMsg) : false

  console.log('[inbound-mail] verarbeitet:', {
    booking: booking.id, zuordnung: grund, felder: Object.keys(upd), smoobu: smoobu ?? 'ok',
    portal: parsed.portal, preis, nachricht: savedMsg,
  })
  return { ok: true, bookingId: booking.id, zuordnung: grund, ergaenzt: Object.keys(upd), nachricht: savedMsg, smoobu: smoobu ?? 'ok', notiz }
}

/**
 * §293 (Pascal 9.9.): FeWo-direkt-Buchungen, die 2 h nach Anlage noch ohne E-Mail (= ohne Chat-Kanal)
 * sind, bekommen EINE offene Aufgabe „Gastdaten fehlen" fürs Team — statt still leer zu bleiben.
 * Idempotent über source='system' + source_ref='fewo-daten:<booking>'. Läuft am Ende jedes Mail-Scans.
 *
 * FeWo-Daten 1.10. (Hans-Dieter, Sweet Spot 23.–25.10.): Die Aufgabe entstand NUR bei fehlender E-Mail und
 * nur in den ersten 7 Tagen nach Anlage — eine Buchung mit Relay-Adresse, aber einwortigem Namen blieb
 * unsichtbar. Jetzt: fehlende E-Mail für alle künftigen Aufenthalte; fehlt nur der NACHNAME (Titel „Nachname
 * fehlt", Prio mittel), entsteht die Aufgabe ab 30 Tagen vor der Anreise (FEWO_NAME_TASK_DAYS — keine
 * Aufgabenflut für weit entfernte Buchungen). Höchstens 5 neue Aufgaben je Lauf (nächste Anreise zuerst). Offene Aufgaben
 * schließen sich selbst, sobald die Daten da sind (bzw. die Buchung storniert/vorbei ist). Erledigte oder
 * verworfene Aufgaben entstehen NICHT neu (Dedupe über source_ref, jeder Status).
 * `pending` = wartende Buchungsmails des Graph-Scans (nur für den Hinweis in der Beschreibung).
 */
export async function ensureFewoDataTasks(pending: { subject: string; checkin?: string; checkout?: string; grund?: string }[] = []): Promise<number> {
  const now = Date.now()
  const today = new Date(now).toISOString().slice(0, 10)
  const nameHorizon = new Date(now + FEWO_NAME_TASK_DAYS * 86400_000).toISOString().slice(0, 10)
  const REF = 'fewo-daten:'
  const dd = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
  const kind = (missing: string[]) => (missing.includes('E-Mail') ? 'Gastdaten fehlen' : 'Nachname fehlt')

  // ── 1) Offene Aufgaben nachführen: Daten inzwischen da → erledigt; nur noch der Nachname fehlt → Titel anpassen ──
  try {
    const { data: open } = await supabaseAdmin
      .from('tasks').select('id, title, description, source_ref')
      .eq('source', 'system').like('source_ref', `${REF}%`)
      .in('status', ['offen', 'in_arbeit']).limit(100)
    const openTasks = (open ?? []) as { id: string; title: string | null; description: string | null; source_ref: string | null }[]
    const ids = openTasks.map((t) => String(t.source_ref ?? '').slice(REF.length)).filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    if (ids.length) {
      const { data: rows } = await supabaseAdmin
        .from('bookings').select('id, guest_name, guest_email, status, check_out').in('id', ids)
      const byId = new Map(((rows ?? []) as { id: string; guest_name: string | null; guest_email: string | null; status: string | null; check_out: string }[]).map((r) => [r.id, r]))
      let closed = 0
      for (const t of openTasks) {
        const b = byId.get(String(t.source_ref ?? '').slice(REF.length))
        if (!b) continue
        const missing = fewoMissing(b)
        const grund = b.status === 'cancelled' ? 'Buchung wurde storniert'
          : b.check_out < today ? 'Aufenthalt ist vorbei'
          : !missing.length ? 'E-Mail und voller Name sind inzwischen da' : ''
        if (grund) {
          const stamp = new Date(now).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
          const { error } = await supabaseAdmin.from('tasks').update({
            status: 'erledigt', completed_at: new Date(now).toISOString(),
            description: `${String(t.description ?? '')}\n\n✅ AUTOMATISCH ERLEDIGT ${stamp}: ${grund}`.slice(0, 2000),
          }).eq('id', t.id)
          if (error) console.error('[inbound-mail] fewo-daten-aufgabe schließen:', error.message)
          else closed++
        } else if (!missing.includes('E-Mail') && String(t.title ?? '').includes('FeWo-direkt: Gastdaten fehlen')) {
          // E-Mail ist da, es fehlt nur noch der Nachname → Titel/Prio nachziehen (nur unser eigener Titel)
          await supabaseAdmin.from('tasks').update({
            title: String(t.title).replace('Gastdaten fehlen', 'Nachname fehlt'), prio: 'mittel',
          }).eq('id', t.id)
        }
      }
      if (closed) console.log('[inbound-mail] FeWo-Gastdaten-Aufgaben automatisch erledigt:', closed)
    }
  } catch (e) { console.error('[inbound-mail] fewo-daten-aufgaben nachführen:', String(e).slice(0, 160)) }

  // ── 2) Neue Aufgaben: künftige FeWo-Buchungen (≥ 2 h alt) ohne E-Mail und/oder ohne Nachnamen ──
  const { data: bks } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_name, guest_email, check_in, check_out, channel, created_at, listing_id, listings(title)')
    .eq('status', 'confirmed')
    .lte('created_at', new Date(now - 2 * 3600_000).toISOString())
    .gte('check_out', today)
    .order('check_in', { ascending: true })
    .limit(500)
  const cands = ((bks ?? []) as { id: string; guest_name: string | null; guest_email: string | null; check_in: string; check_out: string; channel: string | null; listing_id: string | null; listings: { title: string } | { title: string }[] | null }[])
    .filter((b) => /fewo|homeaway|vrbo/i.test(b.channel ?? '') && fewoMissing(b).length > 0)
  if (!cands.length) return 0
  // vorhandene Aufgaben (JEDER Status) in einem Rutsch — exakte Refs, kein Limit-Risiko
  const have = new Set<string>()
  for (let i = 0; i < cands.length; i += 60) {
    const { data: ex, error } = await supabaseAdmin
      .from('tasks').select('source_ref').eq('source', 'system')
      .in('source_ref', cands.slice(i, i + 60).map((b) => `${REF}${b.id}`))
    if (error) { console.error('[inbound-mail] fewo-daten-aufgaben lesen:', error.message); return 0 }
    for (const t of ex ?? []) have.add(String(t.source_ref))
  }
  let created = 0
  for (const b of cands) {
    if (created >= 5) break
    const ref = `${REF}${b.id}`
    if (have.has(ref)) continue
    const missing = fewoMissing(b)
    const onlyName = !missing.includes('E-Mail')
    // „Nachname fehlt" erst ab 30 Tagen vor der Anreise — sonst entstünden nach dem Deploy auf einen Schlag
    // Aufgaben für ALLE künftigen FeWo-Buchungen mit einwortigem Namen (Smoobu liefert ihn fast nie)
    if (onlyName && b.check_in > nameHorizon) continue
    const title = ((Array.isArray(b.listings) ? b.listings[0] : b.listings) as { title: string } | null)?.title ?? 'Wohnung'
    const wait = pending.find((p) => p.checkin === b.check_in && p.checkout === b.check_out)
    const hint = wait
      ? `\n\nHinweis: Eine Buchungsmail mit genau diesem Zeitraum wartet noch auf Zuordnung („${wait.subject.slice(0, 90)}")${wait.grund ? ` — bisher: ${wait.grund}` : ''}. Sie wird bis zur Anreise bei jedem Mail-Scan erneut geprüft.`
      : ''
    const description = onlyName
      ? `Die FeWo-direkt-Buchung hat bei uns nur „${b.guest_name || 'keinen Namen'}" — der Nachname fehlt. Smoobu liefert ihn bei FeWo-direkt meist nicht, und aus der Buchungsbestätigungs-Mail konnte er bislang nicht übernommen werden. Die E-Mail-Adresse ist da, Auto-Nachrichten laufen also.\n\nBitte den vollen Namen in FeWo-direkt (Buchungsdetails) oder in der Bestätigungsmail in fewo@trimosa.de („Sofortbuchung von …" / „Reservierung für …") nachsehen und in Smoobu bei der Reservierung als Vor- und Nachname eintragen. Sobald der volle Name in der App ankommt, erledigt sich diese Aufgabe von selbst.${hint}\n\nBuchung: ${b.id}`
      : `Die FeWo-direkt-Buchung hat bei uns keine E-Mail-Adresse (und meist keine Personenzahl/keinen Nachnamen) — Smoobu hat sie nicht geliefert und die Buchungsbestätigungs-Mail wurde bislang keiner Buchung zugeordnet. Ohne E-Mail gehen KEINE Auto-Nachrichten (Anreise-Infos, Früh-Check-in) raus.\n\nBitte prüfen: Liegt die Bestätigungsmail („Sofortbuchung von …" / „Reservierung für …") in fewo@trimosa.de? Dann wird sie beim nächsten Mail-Scan automatisch zugeordnet. Sonst Gastdaten in Smoobu nachtragen oder den Gast über den FeWo-direkt-Messenger anschreiben.${hint}\n\nBuchung: ${b.id}`
    // nur der Nachname fehlt: nicht „heute fällig", sondern rechtzeitig vor der Anreise
    const dueName = new Date(Date.parse(`${b.check_in}T00:00:00Z`) - 3 * 86400_000).toISOString().slice(0, 10)
    const { error } = await supabaseAdmin.from('tasks').insert({
      title: `📮 FeWo-direkt: ${kind(missing)} — ${b.guest_name || 'Gast'} · ${title} · ${dd(b.check_in)}–${dd(b.check_out)}`.slice(0, 120),
      description,
      source: 'system', source_ref: ref,
      listing_id: b.listing_id, is_general: !b.listing_id,
      prio: onlyName ? 'mittel' : 'hoch', status: 'offen', visibility: 'team',
      due_date: onlyName && dueName > today ? dueName : today,
    })
    if (error) console.error('[inbound-mail] fewo-daten-aufgabe:', error.message)
    else created++
  }
  if (created) console.log('[inbound-mail] FeWo-Gastdaten-Aufgaben angelegt:', created)
  return created
}

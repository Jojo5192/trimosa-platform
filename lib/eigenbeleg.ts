import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sevJson, uploadSevVoucherFile, createSevVoucherDraft, bookSevVoucher, getReceiptGuidance } from '@/lib/sevdesk'

/**
 * 📘 EIGENBELEG (§243) — Zahlungen OHNE Fremdbeleg buchen (Miete, Kreditrate,
 * Privatentnahme, Sonstiges): Die App generiert einen Ersatzbeleg als
 * Mini-PDF (GoBD: Eigenbeleg mit Empfänger, Datum, Betrag, Zweck), legt ihn
 * als sevdesk-Beleg an, verbucht die Positionen und verknüpft die Zahlung.
 *
 * Steuer-Doktrin (dem Inhaber kommuniziert):
 *  - Miete/Pacht = voll absetzbar (6310); „Beleg" ist eigentlich der
 *    Mietvertrag als Dauerbeleg — der Eigenbeleg referenziert ihn.
 *  - Kreditrate: NUR der Zinsanteil ist Betriebsausgabe (7300); die TILGUNG
 *    ist erfolgsneutral — Gegenkonto 3150 (Verbindlichkeiten Kreditinstitute)
 *    falls sevdesk es akzeptiert, sonst 1370 Durchlaufende Posten (ebenfalls
 *    erfolgsneutral, ehrlich im Belegtext vermerkt).
 *  - Privatentnahme (2100) = nie Betriebsausgabe, nur Kapitalkonten-Bewegung.
 */

export type EigenbelegTyp = 'miete' | 'kredit' | 'privat' | 'sonstiges'

export interface EigenbelegPosition {
  accountDatevId: number
  taxRate: number
  amountGross: number
  name: string
}

const A4: [number, number] = [595.28, 841.89]
const M = 52
const NAVY = rgb(0.07, 0.13, 0.18)
const GOLD = rgb(0.68, 0.55, 0.18)
const GRAY = rgb(0.45, 0.44, 0.42)

/** WinAnsi verträgt keine Emojis/Nicht-Latin-1 — rausfiltern (qs-pdf-Muster). */
function safe(text: string): string {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/[^\x20-\x7E\xA0-\xFFäöüÄÖÜß€„“”‘’–—·…]/g, '').trim()
}

const eur = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' EUR'

async function eigenbelegPdf(opts: {
  empfaenger: string
  datum: string
  zweck: string
  positionen: EigenbelegPosition[]
  grundlage: string
}): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page = doc.addPage(A4)
  const w = A4[0]

  // Navy-Kopfbalken
  page.drawRectangle({ x: 0, y: A4[1] - 96, width: w, height: 96, color: NAVY })
  page.drawText('EIGENBELEG', { x: M, y: A4[1] - 52, size: 24, font: bold, color: rgb(1, 1, 1) })
  page.drawText('Ersatzbeleg gemäß GoBD', { x: M, y: A4[1] - 72, size: 11, font, color: GOLD })
  page.drawText('TRIMOSA Apartments & Homes eGbR', { x: w - M - bold.widthOfTextAtSize('TRIMOSA Apartments & Homes eGbR', 11), y: A4[1] - 52, size: 11, font: bold, color: rgb(1, 1, 1) })

  let y = A4[1] - 140
  const row = (label: string, value: string) => {
    page.drawText(label.toUpperCase(), { x: M, y, size: 8.5, font: bold, color: GRAY })
    page.drawText(safe(value).slice(0, 90), { x: M + 150, y, size: 11.5, font, color: rgb(0.1, 0.09, 0.08) })
    y -= 26
  }
  row('Zahlungsempfänger', opts.empfaenger)
  row('Belegdatum', opts.datum.split('-').reverse().join('.'))
  row('Zweck', opts.zweck)

  y -= 10
  page.drawLine({ start: { x: M, y }, end: { x: w - M, y }, thickness: 1, color: GOLD })
  y -= 24
  let summe = 0
  for (const p of opts.positionen) {
    const amt = eur(p.amountGross)
    page.drawText(safe(p.name).slice(0, 70), { x: M, y, size: 11.5, font, color: rgb(0.1, 0.09, 0.08) })
    page.drawText(amt, { x: w - M - font.widthOfTextAtSize(amt, 11.5), y, size: 11.5, font, color: rgb(0.1, 0.09, 0.08) })
    if (p.taxRate > 0) {
      y -= 14
      page.drawText(`enthaltene USt ${p.taxRate} %`, { x: M + 12, y, size: 8.5, font, color: GRAY })
    }
    y -= 24
  }
  for (const p of opts.positionen) summe += p.amountGross
  page.drawLine({ start: { x: M, y: y + 8 }, end: { x: w - M, y: y + 8 }, thickness: 0.5, color: GRAY })
  const s = eur(Math.round(summe * 100) / 100)
  page.drawText('GESAMT', { x: M, y: y - 12, size: 10, font: bold, color: GRAY })
  page.drawText(s, { x: w - M - bold.widthOfTextAtSize(s, 13), y: y - 13, size: 13, font: bold, color: NAVY })

  y -= 56
  const foot = safe(opts.grundlage)
  page.drawText('GRUNDLAGE / HINWEIS', { x: M, y, size: 8.5, font: bold, color: GRAY })
  y -= 15
  // simple Zeilenumbruch
  const words = foot.split(' ')
  let line = ''
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(probe, 9.5) <= w - 2 * M) line = probe
    else { page.drawText(line, { x: M, y, size: 9.5, font, color: GRAY }); y -= 13; line = word }
  }
  if (line) page.drawText(line, { x: M, y, size: 9.5, font, color: GRAY })

  page.drawText('Automatisch erstellt über die TRIMOSA-Buchhaltung · trimosa.de', {
    x: M, y: 46, size: 8, font, color: GRAY,
  })
  return Buffer.from(await doc.save())
}

/**
 * Tilgungs-Konto auflösen: 3150 (Verbindlichkeiten ggü. Kreditinstituten)
 * ist NICHT in der ReceiptGuidance — der forAccountNumber-Endpoint sagt uns
 * zur Laufzeit, ob sevdesk das Konto trotzdem kennt. Fallback: 1370
 * Durchlaufende Posten (ebenfalls erfolgsneutral). Ergebnis gecacht.
 */
export async function resolveTilgungKonto(): Promise<{ accountDatevId: number; kontoNr: string }> {
  const gg = globalThis as typeof globalThis & { __tilgungKonto?: { accountDatevId: number; kontoNr: string } }
  if (gg.__tilgungKonto) return gg.__tilgungKonto
  try {
    const raw = await sevJson<{ accountDatevId?: unknown }[]>('/ReceiptGuidance/forAccountNumber?accountNumber=3150')
    const id = Number(raw?.[0]?.accountDatevId)
    if (Number.isFinite(id) && id > 0) {
      gg.__tilgungKonto = { accountDatevId: id, kontoNr: '3150' }
      return gg.__tilgungKonto
    }
  } catch { /* 422 = Konto nicht in der Guidance → Fallback */ }
  const guidance = await getReceiptGuidance()
  const fallback = guidance.find((g) => g.accountNumber === '1370')
  if (!fallback) throw new Error('Weder Konto 3150 noch 1370 verfügbar — Tilgung nicht buchbar.')
  gg.__tilgungKonto = { accountDatevId: fallback.accountDatevId, kontoNr: '1370' }
  return gg.__tilgungKonto
}

export async function bucheEigenbeleg(opts: {
  empfaenger: string
  datum: string
  zweck: string
  positionen: EigenbelegPosition[]
  grundlage: string
  kostenstelle?: string | null
  zuordnung?: Record<string, unknown> | null
  txId: string
  txAccountId: string
  txDate?: string
}): Promise<{ ok: boolean; voucherId?: string; verknuepft?: boolean; hinweis?: string; error?: string }> {
  const gesamt = Math.round(opts.positionen.reduce((a, p) => a + p.amountGross, 0) * 100) / 100
  if (!opts.positionen.length || gesamt <= 0) return { ok: false, error: 'Keine gültigen Positionen.' }

  // 1) Eigenbeleg-PDF erzeugen + zu sevdesk hochladen
  const pdf = await eigenbelegPdf(opts)
  const up = await uploadSevVoucherFile(pdf, `Eigenbeleg-${opts.datum}.pdf`)
  if (!up.ok || !up.internalFilename) return { ok: false, error: up.error ?? 'PDF-Upload fehlgeschlagen' }

  // 2) Beleg-Entwurf mit dem PDF anlegen
  const draft = await createSevVoucherDraft({
    internalFilename: up.internalFilename,
    supplierName: opts.empfaenger.slice(0, 80),
    description: `Eigenbeleg (ohne Fremdbeleg): ${opts.zweck}`.slice(0, 255),
    voucherDate: opts.datum,
    ...(opts.kostenstelle ? { costCentreName: opts.kostenstelle } : {}),
  })
  if (!draft.ok || !draft.voucherId) return { ok: false, error: draft.error ?? 'Beleg-Anlage fehlgeschlagen' }

  // 3) Positionen buchen + Zahlung verknüpfen (Vorzeichen-Doktrin §242:
  //    Ausgabe → bookAmount negativ, macht bookSevVoucher selbst)
  const booked = await bookSevVoucher(draft.voucherId, {
    accountDatevId: opts.positionen[0].accountDatevId,
    taxRate: opts.positionen[0].taxRate,
    amountGross: gesamt,
    positions: opts.positionen.map((p) => ({
      accountDatevId: p.accountDatevId, taxRate: p.taxRate, amountGross: p.amountGross,
    })),
    costCentreName: opts.kostenstelle ?? null,
    txId: opts.txId, txAccountId: opts.txAccountId, txDate: opts.txDate,
  })
  if (!booked.ok) return { ok: false, voucherId: draft.voucherId, error: booked.error }

  // 4) PDF-Kopie in den Storage + Protokollzeile (Beleg-Viewer + interne
  //    Zuordnung) — fail-soft, der Beleg ist da schon gebucht
  try {
    const path = `sevdesk/eigen-${draft.voucherId}/Eigenbeleg-${opts.datum}.pdf`
    const { error: upErr } = await supabaseAdmin.storage.from('belege')
      .upload(path, pdf, { contentType: 'application/pdf', upsert: true })
    await supabaseAdmin.from('beleg_inbox').insert({
      source: 'app', status: 'sevdesk',
      lieferant: opts.empfaenger.slice(0, 120), betrag: gesamt, beleg_datum: opts.datum,
      subject: `Eigenbeleg: ${opts.zweck}`.slice(0, 200),
      files: upErr ? [] : [{ path, name: `Eigenbeleg-${opts.datum}.pdf` }],
      sevdesk_voucher_id: draft.voucherId,
      ...(opts.zuordnung ? { zuordnung: opts.zuordnung } : {}),
      decided_at: new Date().toISOString(),
    })
  } catch { /* fail-soft */ }

  return { ok: true, voucherId: draft.voucherId, verknuepft: booked.verknuepft, hinweis: booked.hinweis }
}

/* ── §243j MERKREGEL: wiederkehrende Ohne-Beleg-Zahlungen automatisch ──
 * Einmal als Eigenbeleg gebucht (privat/miete/sonstiges — NICHT kredit,
 * dessen Zins-/Tilgungs-Split wandert mit dem Tilgungsplan) → dieselbe
 * Zahlung (Empfaenger-Tokens + exakter Betrag) wird beim naechsten Mal
 * vom taeglichen Lauf automatisch gebucht, mit fortgeschriebenem Monat
 * im Zweck. Gespeichert in app_settings 'buchhaltung'.eigenRegeln. */

export interface EigenRegel {
  key: string
  typ: EigenbelegTyp
  empfaenger: string
  zweckPrefix: string
  accountDatevId: number
  taxRate: number
  posName: string
  grundlage: string
  kostenstelle?: string | null
  at: string
}

const MONATE_DE = ['Januar', 'Februar', 'M\u00E4rz', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

function nameTokens(name: string): string[] {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z]+/).filter((w) => w.length > 2)
}

export function eigenRegelKey(empfaenger: string, betrag: number): string {
  return nameTokens(empfaenger).sort().join(' ') + '|' + betrag.toFixed(2)
}

/** Monats-/Jahres-Suffix aus dem Zweck strippen (wird beim Auto-Buchen
 *  durch den Monat der neuen Zahlung ersetzt). */
export function zweckOhneMonat(zweck: string): string {
  return zweck
    .replace(new RegExp('\\s*[\u00B7\\-/,]?\\s*(' + MONATE_DE.join('|') + ')\\s*\\d{4}\\s*$', 'i'), '')
    .replace(/\s*[\u00B7\-/,]?\s*\d{1,2}[./]\d{4}\s*$/, '')
    .trim()
}

export async function saveEigenRegel(opts: {
  typ: EigenbelegTyp
  empfaenger: string
  betrag: number
  zweck: string
  position: EigenbelegPosition
  grundlage: string
  kostenstelle?: string | null
}): Promise<void> {
  if (opts.typ === 'kredit') return
  try {
    const { data } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', 'buchhaltung').maybeSingle()
    const cur = (data?.value ?? {}) as Record<string, unknown>
    const regeln = (cur.eigenRegeln ?? {}) as Record<string, EigenRegel>
    const key = eigenRegelKey(opts.empfaenger, opts.betrag)
    regeln[key] = {
      key, typ: opts.typ, empfaenger: opts.empfaenger,
      zweckPrefix: zweckOhneMonat(opts.zweck),
      accountDatevId: opts.position.accountDatevId, taxRate: opts.position.taxRate,
      posName: zweckOhneMonat(opts.position.name),
      grundlage: opts.grundlage,
      kostenstelle: opts.kostenstelle ?? null,
      at: new Date().toISOString(),
    }
    const keys = Object.keys(regeln)
    if (keys.length > 100) {
      keys.sort((a, b) => String(regeln[a].at).localeCompare(String(regeln[b].at)))
      for (const k of keys.slice(0, keys.length - 100)) delete regeln[k]
    }
    await supabaseAdmin.from('app_settings').upsert(
      { key: 'buchhaltung', value: { ...cur, eigenRegeln: regeln } }, { onConflict: 'key' })
  } catch { /* best effort */ }
}

/** Taeglicher Lauf (haengt am 3:50-payouts-Cron): offene Abbuchungen gegen
 *  die Merkregeln matchen (alle Regel-Tokens im Zahlungs-Namen + exakter
 *  Betrag) und automatisch als Eigenbeleg buchen. */
export async function runEigenbelegRegeln(): Promise<{ gebucht: number; details: string[] }> {
  const details: string[] = []
  try {
    const { data } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', 'buchhaltung').maybeSingle()
    const regeln = Object.values((((data?.value ?? {}) as Record<string, unknown>).eigenRegeln ?? {}) as Record<string, EigenRegel>)
    if (!regeln.length) return { gebucht: 0, details }
    const { findBankAccounts, listBankTransactions } = await import('@/lib/sevdesk-payouts')
    const banks = await findBankAccounts()
    let gebucht = 0
    const used = new Set<string>()
    for (const bank of banks) {
      for (const t of await listBankTransactions(bank.id, 60)) {
        if (Number(t.status) !== 100) continue
        const amt = Number(t.amount)
        if (amt >= 0) continue
        const txName = nameTokens(String(t.payeePayerName ?? ''))
        const regel = regeln.find((rg) => {
          if (Math.abs(Math.abs(amt) - Number(rg.key.split('|')[1])) > 0.005) return false
          const toks = nameTokens(rg.empfaenger)
          return toks.length > 0 && toks.every((w) => txName.includes(w))
        })
        if (!regel) continue
        const txId = String(t.id)
        if (used.has(txId)) continue
        const datum = String(t.valueDate ?? t.entryDate ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10)
        const d = new Date(datum + 'T12:00:00Z')
        const monat = MONATE_DE[d.getUTCMonth()] + ' ' + d.getUTCFullYear()
        const betrag = Math.round(Math.abs(amt) * 100) / 100
        const r = await bucheEigenbeleg({
          empfaenger: regel.empfaenger, datum,
          zweck: `${regel.zweckPrefix} \u00B7 ${monat}`,
          positionen: [{ accountDatevId: regel.accountDatevId, taxRate: regel.taxRate, amountGross: betrag, name: `${regel.posName} \u00B7 ${monat}` }],
          grundlage: regel.grundlage,
          kostenstelle: regel.kostenstelle ?? null,
          txId, txAccountId: bank.id, txDate: datum,
        })
        if (r.ok) {
          used.add(txId)
          gebucht++
          details.push(`${regel.zweckPrefix} \u00B7 ${monat} (${betrag.toFixed(2)} \u20AC)`)
          try {
            const { sendPushToTeam } = await import('@/lib/push')
            await sendPushToTeam('\u{1F4D8} Automatisch gebucht', `${regel.zweckPrefix} \u00B7 ${monat} \u00B7 ${betrag.toFixed(2).replace('.', ',')} \u20AC`, '/buchhaltung', { buchhaltung: true })
          } catch { /* best effort */ }
        } else {
          details.push(`FEHLER ${regel.zweckPrefix}: ${(r.error ?? '?').slice(0, 100)}`)
        }
      }
    }
    return { gebucht, details }
  } catch (e) {
    details.push(String(e instanceof Error ? e.message : e).slice(0, 150))
    return { gebucht: 0, details }
  }
}

/**
 * 💸 PHASE C (§236) — Finom-Payout-Verbuchung, server-only.
 *
 * Das Verrechnungskonten-Modell (§234/§235) braucht die Gegenseite: Die
 * echten Portal-Auszahlungen auf dem Finom-Konto (via finAPI automatisch in
 * sevdesk) werden als GELDTRANSIT gegen das passende Kanal-Verrechnungskonto
 * umgebucht — die Rechnungen selbst sind dort längst „bezahlt", die
 * Auszahlung gleicht das Verrechnungskonto aus. Die Differenz (Provision)
 * bleibt als Saldo sichtbar, bis die Provisionsrechnung als Ausgabe gegen
 * dasselbe Konto gebucht ist (C2).
 *
 * Mechanik: POST /CheckAccountTransaction auf dem VERRECHNUNGSKONTO mit
 * negativem Betrag + sourceTransaction = Finom-Transaktion (Spec: „source
 * of a money transit"). ⚠️ KALIBRIER-PUNKT §127: der erste echte Transfer
 * (action 'probe') beweist Payload-Form + Status-Verhalten — der Cron bucht
 * erst, wenn der Auto-Schalter (app_settings) bewusst umgelegt wurde.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sevJson, ensureClearingAccount } from '@/lib/sevdesk'

export interface SevAccount { id: string; name: string; type: string; status?: string | number }

export async function listAllCheckAccounts(): Promise<SevAccount[]> {
  const list = await sevJson<{ id: string; name: string; type: string; status?: string | number }[]>(
    '/CheckAccount?limit=100')
  return (list ?? []).map((a) => ({ id: String(a.id), name: String(a.name), type: String(a.type), status: a.status }))
}

/** Die ECHTEN Bankkonten (Finom via finAPI): ALLE type 'online' — Finom
 *  liefert Haupt- + Unterkonten getrennt (Kalibrierung 1.8.: „Main" +
 *  „Steuerrücklagen"); Payouts können auf jedem davon eintreffen. */
export async function findBankAccounts(): Promise<SevAccount[]> {
  const all = await listAllCheckAccounts()
  return all.filter((a) => a.type === 'online')
}

/** Kompatibilitäts-Helper (ein Konto) — bevorzugt „Main". */
export async function findBankAccount(): Promise<SevAccount | null> {
  const online = await findBankAccounts()
  return online.find((a) => /main|haupt|geschäft/i.test(a.name)) ?? online[0] ?? null
}

/** Auszahlungs-Klassifikation — bewusst ENG (kein Fallback!): unerkannte
 *  Eingänge bleiben unangetastet und landen nur im Report. Muster werden
 *  aus den echten Verwendungszwecken nachgeschärft (scan-Report). */
export function payoutClearingFor(text: string): string | null {
  const s = text.toLowerCase()
  if (/fewo|homeaway|vrbo|abritel|expedia/.test(s)) return 'Verrechnung FeWo-direkt'
  if (/airbnb/.test(s)) return 'Verrechnung Airbnb'
  if (/booking\.?\s?com|bookingcom|booking\.com/.test(s)) return 'Verrechnung Booking.com'
  if (/stripe/.test(s)) return 'Verrechnung Direkt/Website'
  if (/hometogo/.test(s)) return 'Verrechnung HomeToGo'
  return null
}

export interface SevTx {
  id: string; valueDate?: string | null; entryDate?: string | null
  amount: string | number; payeePayerName?: string | null; paymtPurpose?: string | null
  status: string | number
}

export async function listBankTransactions(accountId: string, days: number): Promise<SevTx[]> {
  const start = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const list = await sevJson<SevTx[]>(
    `/CheckAccountTransaction?checkAccount[id]=${accountId}&checkAccount[objectName]=CheckAccount&startDate=${start}&limit=200`)
  return list ?? []
}

/** Geldtransit: Gegen-Transaktion auf dem Verrechnungskonto, verknüpft über
 *  sourceTransaction. Betrag = −Auszahlung (das Verrechnungskonto gibt ab). */
export async function bookMoneyTransit(tx: SevTx, clearingLabel: string): Promise<{ ok: boolean; counterId?: string; error?: string }> {
  try {
    const clearingId = await ensureClearingAccount(clearingLabel)
    const created = await sevJson<{ id: string }>('/CheckAccountTransaction', {
      method: 'POST',
      body: JSON.stringify({
        checkAccount: { id: Number(clearingId), objectName: 'CheckAccount' },
        valueDate: String(tx.valueDate ?? tx.entryDate ?? new Date().toISOString()).slice(0, 10),
        amount: -Math.abs(Number(tx.amount)),
        payeePayerName: tx.payeePayerName ?? 'Geldtransit',
        paymtPurpose: `Auszahlung ${clearingLabel.replace('Verrechnung ', '')} → Bank (Geldtransit)`,
        status: 100,
        sourceTransaction: { id: Number(tx.id), objectName: 'CheckAccountTransaction' },
      }),
    })
    return { ok: true, counterId: String(created?.id ?? '') }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) }
  }
}

/* ── Zustand (app_settings 'sevdesk_payouts') ──────────────────────────── */

interface PayoutState { auto: boolean; processed: string[] }

export async function getPayoutState(): Promise<PayoutState> {
  const { data } = await supabaseAdmin
    .from('app_settings').select('value').eq('key', 'sevdesk_payouts').maybeSingle()
  const v = (data?.value ?? {}) as Partial<PayoutState>
  return { auto: v.auto === true, processed: Array.isArray(v.processed) ? v.processed.map(String) : [] }
}

async function savePayoutState(s: PayoutState): Promise<void> {
  await supabaseAdmin.from('app_settings').upsert(
    { key: 'sevdesk_payouts', value: { auto: s.auto, processed: s.processed.slice(-500) } },
    { onConflict: 'key' },
  )
}

export async function setPayoutAuto(on: boolean): Promise<void> {
  const s = await getPayoutState()
  await savePayoutState({ ...s, auto: on })
}

/* ── Der Lauf ──────────────────────────────────────────────────────────── */

export interface PayoutSyncReport {
  dryRun: boolean
  bank?: string
  zeitraumTage: number
  transaktionen: number
  payouts: { id: string; datum: string; betrag: number; von: string; zweck: string; konto: string; bankkonto: string }[]
  gebucht: number
  unerkannteEingaenge: { id: string; datum: string; betrag: number; von: string; zweck: string; bankkonto: string }[]
  moeglicheProvisionsAbbuchungen: { datum: string; betrag: number; von: string; zweck: string; bankkonto: string }[]
  fehler: { id: string; error: string }[]
  hinweis?: string
}

/**
 * Scan + (optional) Buchung: erkannte Portal-Eingänge der letzten `days`
 * Tage als Geldtransit gegen ihr Verrechnungskonto. Nur UNVERKNÜPFTE
 * Transaktionen (Status 100) — was in sevdesk schon zugeordnet ist, bleibt
 * unangetastet. Dedupe zusätzlich über die processed-Liste.
 */
export async function runPayoutSync(opts: { days?: number; dryRun?: boolean } = {}): Promise<PayoutSyncReport> {
  const days = Math.min(Math.max(Number(opts.days) || 14, 1), 120)
  const dryRun = opts.dryRun !== false
  const report: PayoutSyncReport = {
    dryRun, zeitraumTage: days, transaktionen: 0,
    payouts: [], gebucht: 0, unerkannteEingaenge: [], moeglicheProvisionsAbbuchungen: [], fehler: [],
  }
  const banks = await findBankAccounts()
  if (!banks.length) { report.hinweis = 'Kein Finom-/Online-Bankkonto in sevdesk gefunden (action accounts prüfen).'; return report }
  report.bank = banks.map((b) => `${b.name} (${b.id})`).join(' · ')

  const state = await getPayoutState()
  const txById = new Map<string, SevTx>()
  for (const bank of banks) {
    const txs = await listBankTransactions(bank.id, days)
    report.transaktionen += txs.length
    for (const tx of txs) {
      txById.set(String(tx.id), tx)
      const amount = Number(tx.amount)
      const text = `${tx.payeePayerName ?? ''} ${tx.paymtPurpose ?? ''}`.trim()
      const datum = String(tx.valueDate ?? tx.entryDate ?? '').slice(0, 10)
      const label = payoutClearingFor(text)
      if (amount > 0) {
        if (Number(tx.status) !== 100 || state.processed.includes(String(tx.id))) continue
        if (label) {
          report.payouts.push({
            id: String(tx.id), datum, betrag: amount,
            von: (tx.payeePayerName ?? '').slice(0, 60), zweck: (tx.paymtPurpose ?? '').slice(0, 90),
            konto: label, bankkonto: bank.name,
          })
        } else {
          report.unerkannteEingaenge.push({
            id: String(tx.id), datum, betrag: amount,
            von: (tx.payeePayerName ?? '').slice(0, 60), zweck: (tx.paymtPurpose ?? '').slice(0, 90),
            bankkonto: bank.name,
          })
        }
      } else if (amount < 0 && label) {
        // Abbuchung MIT Portal-Bezug = vermutlich Provisions-Lastschrift
        // (Booking zieht monatlich ein) — nur Report, Buchung kommt mit C2
        report.moeglicheProvisionsAbbuchungen.push({
          datum, betrag: amount, von: (tx.payeePayerName ?? '').slice(0, 60), zweck: (tx.paymtPurpose ?? '').slice(0, 90),
          bankkonto: bank.name,
        })
      }
    }
  }

  if (dryRun || !report.payouts.length) return report

  for (const p of report.payouts) {
    const tx = txById.get(p.id)!
    const r = await bookMoneyTransit(tx, p.konto)
    if (r.ok) {
      report.gebucht++
      state.processed.push(p.id)
    } else {
      report.fehler.push({ id: p.id, error: r.error ?? '?' })
    }
    await new Promise((ok) => setTimeout(ok, 400))
  }
  await savePayoutState(state)
  return report
}

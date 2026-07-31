/**
 * 🧾 sevdesk-Client (§233/§234) — server-only: Rechnungen anlegen, fertigstellen und als
 * bezahlt buchen — inkl. Kostenstellen je Wohnung und Kanal-Verrechnungs-
 * konten. Alle Fähigkeiten am 1.8.2026 live am Trial-Account bewiesen
 * (HANDOFF §233): saveInvoice (Buchhaltung 2.0 → taxRule statt taxType),
 * sendBy vergibt/behält die Nummer, bookAmount FULL_PAYMENT setzt Status
 * 1000 und schreibt automatisch fest (GoBD).
 *
 * ⚠️ Kalibrier-Punkte für den ersten scharfen Batch (§127-Muster):
 *  - Positions-price ist NETTO (PoC: price 100 + 19 % → Gesamt 119) —
 *    wir senden netto mit 4 Nachkommastellen und VERIFIZIEREN sumGross
 *    nach dem Anlegen (Abweichung > 2 ct → Fehler statt falscher Beleg).
 *  - sendBy darf die explizit gesetzte invoiceNumber nicht überschreiben
 *    (wird nach dem Fertigstellen gegengeprüft).
 */

const BASE = 'https://my.sevdesk.de/api/v1'

export function sevdeskConfigured(): boolean {
  return !!process.env.SEVDESK_API_TOKEN
}

async function sevFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = process.env.SEVDESK_API_TOKEN
  if (!token) throw new Error('SEVDESK_API_TOKEN fehlt (Vercel-Env).')
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })
}

async function sevJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await sevFetch(path, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`sevdesk ${init?.method ?? 'GET'} ${path} HTTP ${res.status}: ${text.slice(0, 300)}`)
  try {
    return (JSON.parse(text) as { objects: T }).objects
  } catch {
    throw new Error(`sevdesk ${path}: Antwort nicht parsebar: ${text.slice(0, 200)}`)
  }
}

/* ── Stammdaten-Caches (je Lambda-Instanz) ─────────────────────────── */

type Cache = {
  userId?: string
  costCentres?: Map<string, string>
  checkAccounts?: Map<string, string>
  contacts?: Map<string, string>
}
const g = globalThis as typeof globalThis & { __sevCache?: Cache }
function cache(): Cache {
  if (!g.__sevCache) g.__sevCache = {}
  return g.__sevCache
}

async function getSevUserId(): Promise<string> {
  const c = cache()
  if (c.userId) return c.userId
  const users = await sevJson<{ id: string }[]>('/SevUser')
  if (!users?.length) throw new Error('sevdesk: kein SevUser gefunden.')
  c.userId = String(users[0].id)
  return c.userId
}

/** Kostenstelle je Wohnungs-Titel — legt fehlende an; „PoC City Home"
 *  aus dem PoC (§233) wird beim ersten Lauf in „City Home" umbenannt. */
export async function ensureCostCentre(name: string): Promise<string> {
  const c = cache()
  if (!c.costCentres) {
    const list = await sevJson<{ id: string; name: string }[]>('/CostCentre?limit=100')
    c.costCentres = new Map((list ?? []).map((x) => [x.name, String(x.id)]))
    const poc = c.costCentres.get('PoC City Home')
    if (poc && !c.costCentres.get('City Home')) {
      await sevJson(`/CostCentre/${poc}`, { method: 'PUT', body: JSON.stringify({ name: 'City Home' }) })
      c.costCentres.delete('PoC City Home')
      c.costCentres.set('City Home', poc)
    }
  }
  const hit = c.costCentres.get(name)
  if (hit) return hit
  const created = await sevJson<{ id: string }>('/CostCentre', {
    method: 'POST',
    body: JSON.stringify({ name, number: String(100 + c.costCentres.size + 1), status: 100 }),
  })
  const id = String(created.id)
  c.costCentres.set(name, id)
  return id
}

/** Verrechnungskonto je Kanal (Portal-Zahlungen laufen nicht 1:1 über die
 *  Bank — bezahlt wird gegen das Kanal-Verrechnungskonto, §234). */
export async function ensureClearingAccount(label: string): Promise<string> {
  const c = cache()
  if (!c.checkAccounts) {
    const list = await sevJson<{ id: string; name: string }[]>('/CheckAccount?limit=100')
    c.checkAccounts = new Map((list ?? []).map((x) => [x.name, String(x.id)]))
  }
  const hit = c.checkAccounts.get(label)
  if (hit) return hit
  const created = await sevJson<{ id: string }>('/CheckAccount/Factory/clearingAccount', {
    method: 'POST',
    body: JSON.stringify({ name: label }),
  })
  const id = String(created.id)
  c.checkAccounts.set(label, id)
  return id
}

/** Kontakt je Gastname (exakter Namens-Match, sonst neu anlegen). */
export async function ensureContact(name: string): Promise<string> {
  const clean = name.trim() || 'Gast'
  const c = cache()
  if (!c.contacts) c.contacts = new Map()
  const hit = c.contacts.get(clean)
  if (hit) return hit
  const found = await sevJson<{ id: string; name: string | null }[]>(
    `/Contact?name=${encodeURIComponent(clean)}&limit=5`)
  const exact = (found ?? []).find((x) => (x.name ?? '').trim() === clean)
  if (exact) {
    c.contacts.set(clean, String(exact.id))
    return String(exact.id)
  }
  const created = await sevJson<{ id: string }>('/Contact', {
    method: 'POST',
    body: JSON.stringify({ name: clean, category: { id: 3, objectName: 'Category' } }),
  })
  c.contacts.set(clean, String(created.id))
  return String(created.id)
}

/* ── Rechnung anlegen + fertigstellen + bezahlt buchen ─────────────── */

export interface SevInvoiceInput {
  invoiceNumber: string
  /** Belegdatum (Inhaber-Regel §160: Anreisetag), 'YYYY-MM-DD' */
  invoiceDate: string
  contactName: string
  /** = Kostenstelle */
  apartmentTitle: string
  /** Verrechnungskonto-Label, z. B. 'Verrechnung Airbnb' */
  clearingLabel: string
  /** BRUTTO-Endbetrag (7 % Beherbergung) */
  amountGross: number
  positionName: string
  positionText: string
}

export async function createPaidInvoice(inp: SevInvoiceInput, opts: { book?: boolean } = {}): Promise<{ sevdeskId: string; number: string }> {
  const [userId, contactId, costCentreId] = await Promise.all([
    getSevUserId(), ensureContact(inp.contactName), ensureCostCentre(inp.apartmentTitle),
  ])
  const clearingId = await ensureClearingAccount(inp.clearingLabel)

  // Positions-price = NETTO (PoC-bewiesen) — 4 Nachkommastellen halten den
  // Brutto-Zielbetrag auf den Cent (380,88 / 1,07 = 355,9626 → ×1,07 = 380,88)
  const net = Math.round((inp.amountGross / 1.07) * 10000) / 10000

  const saved = await sevJson<{ invoice: { id: string } }>('/Invoice/Factory/saveInvoice', {
    method: 'POST',
    body: JSON.stringify({
      invoice: {
        objectName: 'Invoice',
        invoiceNumber: inp.invoiceNumber,
        invoiceDate: inp.invoiceDate,
        discount: 0,
        status: 100,
        invoiceType: 'RE',
        currency: 'EUR',
        mapAll: true,
        contact: { id: Number(contactId), objectName: 'Contact' },
        contactPerson: { id: Number(userId), objectName: 'SevUser' },
        taxRate: 7,
        taxText: 'Umsatzsteuer 7%',
        taxRule: { id: 1, objectName: 'TaxRule' },
        costCentre: { id: Number(costCentreId), objectName: 'CostCentre' },
      },
      invoicePosSave: [{
        objectName: 'InvoicePos',
        quantity: 1,
        price: net,
        name: inp.positionName,
        text: inp.positionText,
        taxRate: 7,
        mapAll: true,
        unity: { id: 1, objectName: 'Unity' },
      }],
      invoicePosDelete: null,
      discountSave: null,
      discountDelete: null,
      takeDefaultAddress: true,
    }),
  })
  const sevdeskId = String(saved.invoice.id)

  return finishAndBook(sevdeskId, inp, opts)
}

/** Fertigstellen (+ optional bezahlt buchen) — auch als RESUME für
 *  hängengebliebene Rechnungen nutzbar (Status wird vorher gelesen, nichts
 *  läuft doppelt). ⚠️ Das Bezahlt-Buchen schreibt in sevdesk 2.0
 *  AUTOMATISCH FEST (PoC §233) — Inhaber-Vorgabe 1.8.: „nicht direkt
 *  festschreiben" → book default false; das Buchen ist ein separater
 *  zweiter Migrations-Durchgang nach der Sichtprüfung. */
export async function finishAndBook(sevdeskId: string, inp: SevInvoiceInput, opts: { book?: boolean } = {}): Promise<{ sevdeskId: string; number: string }> {
  let inv = (await sevJson<{ id: string; status: string; invoiceNumber: string | null; sumGross: string | number }[]>(
    `/Invoice/${sevdeskId}`))[0]

  // Brutto-Verifikation VOR dem Fertigstellen (Entwurf wäre noch korrigierbar)
  const sum = Number(inv.sumGross)
  if (Number.isFinite(sum) && Math.abs(sum - inp.amountGross) > 0.02) {
    throw new Error(`Brutto-Abweichung: sevdesk ${sum} vs. Soll ${inp.amountGross} (Netto-Rundung prüfen)`)
  }

  if (Number(inv.status) < 200) {
    await sevJson(`/Invoice/${sevdeskId}/sendBy`, {
      method: 'PUT',
      body: JSON.stringify({ sendType: 'VPR', sendDraft: false }),
    })
    inv = (await sevJson<typeof inv[]>(`/Invoice/${sevdeskId}`))[0]
    if ((inv.invoiceNumber ?? '') !== inp.invoiceNumber) {
      throw new Error(`Nummern-Drift: gesetzt ${inp.invoiceNumber}, sevdesk ${inv.invoiceNumber}`)
    }
  }

  if (opts.book === true && Number(inv.status) < 1000) {
    const clearingId = await ensureClearingAccount(inp.clearingLabel)
    await sevJson(`/Invoice/${sevdeskId}/bookAmount`, {
      method: 'PUT',
      body: JSON.stringify({
        amount: inp.amountGross,
        date: Math.floor(Date.parse(inp.invoiceDate + 'T12:00:00Z') / 1000),
        type: 'FULL_PAYMENT',
        checkAccount: { id: Number(clearingId), objectName: 'CheckAccount' },
      }),
    })
  }

  return { sevdeskId, number: inp.invoiceNumber }
}

/** Kanal → Verrechnungskonto-Label. Reihenfolge ist Substring-kritisch
 *  (§140-Falle in BEIDE Richtungen): „FeWo-direkt" enthält „direkt" →
 *  FeWo MUSS vor dem Direkt-Check stehen; „Direct booking" enthält
 *  „booking" → Direkt MUSS vor dem Booking-Check stehen. */
export function clearingLabelFor(channelName: string | null | undefined): string {
  const s = (channelName ?? '').toLowerCase()
  if (/fewo|homeaway|vrbo|abritel/.test(s)) return 'Verrechnung FeWo-direkt'
  if (/direct|direkt|website/.test(s)) return 'Verrechnung Direkt/Website'
  if (s.includes('airbnb')) return 'Verrechnung Airbnb'
  if (s.includes('booking')) return 'Verrechnung Booking.com'
  if (s.includes('hometogo')) return 'Verrechnung HomeToGo'
  return 'Verrechnung Direkt/Website'
}

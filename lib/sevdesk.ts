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

export async function sevFetch(path: string, init?: RequestInit): Promise<Response> {
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

export async function sevJson<T>(path: string, init?: RequestInit): Promise<T> {
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

/** Ist eine Rechnungsnummer in sevdesk schon vergeben? (Duplikat-Schutz —
 *  sevdesk lehnt Duplikate NICHT ab, sondern vergibt beim Fertigstellen
 *  still eine Auto-Nummer; live erwischt beim Rik-Bos-Fall, §234.) */
export async function invoiceNumberExists(num: string): Promise<boolean> {
  const list = await sevJson<{ id: string }[]>(`/Invoice?invoiceNumber=${encodeURIComponent(num)}&limit=1`)
  return (list ?? []).length > 0
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
  /* ── §235 Engine-Zusätze (alle optional — der Neuaufbau bleibt unberührt) ── */
  /** Einmal-Adresse als kompletter Text mit Zeilenumbrüchen (Invoice.address);
   *  ohne addressText druckt sevdesk die Standard-Anschrift des Kontakts */
  addressText?: string
  /** Fußtext unter den Positionen („Bereits bezahlt über …") */
  footText?: string
  /** §201 „auf Rechnung": Zahlungsziel in Tagen (Invoice.timeToPay) */
  timeToPay?: number
  /** Leistungszeitraum (= Aufenthalt), 'YYYY-MM-DD' */
  deliveryDate?: string
  deliveryDateUntil?: string
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
        ...(inp.addressText ? { address: inp.addressText } : {}),
        ...(inp.footText ? { footText: inp.footText } : {}),
        ...(inp.timeToPay ? { timeToPay: inp.timeToPay } : {}),
        ...(inp.deliveryDate ? { deliveryDate: inp.deliveryDate } : {}),
        ...(inp.deliveryDateUntil ? { deliveryDateUntil: inp.deliveryDateUntil } : {}),
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
      // Mit Einmal-Adresse darf die Kontakt-Standardanschrift nicht gewinnen
      takeDefaultAddress: !inp.addressText,
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
      // sevdesk hat still eine Auto-Nummer vergeben (Duplikat, §234) —
      // die Waise sofort selbst aufräumen (frisch, offen, nicht
      // festgeschrieben → Entwurf → löschen), dann sauber scheitern;
      // der nächste Lauf vergibt dank invoiceNumberExists eine freie Nummer.
      let aufgeraeumt = false
      try {
        await sevFetch(`/Invoice/${sevdeskId}/resetToDraft`, { method: 'PUT' })
        const del = await sevFetch(`/Invoice/${sevdeskId}`, { method: 'DELETE' })
        aufgeraeumt = del.ok
      } catch { /* best effort */ }
      throw new Error(`Nummern-Drift: gesetzt ${inp.invoiceNumber}, sevdesk ${inv.invoiceNumber} — Waise ${aufgeraeumt ? 'gelöscht' : 'NICHT gelöscht (manuell prüfen)'}`)
    }
  }

  if (opts.book === true && Number(inv.status) < 1000) {
    const clearingId = await ensureClearingAccount(inp.clearingLabel)
    // Gebucht wird EXAKT der Rechnungsbetrag laut sevdesk (sumGross) — bei
    // 1–2 ct Netto-Rundungsdrift gegenüber Smoobu wirft bookAmount sonst
    // 422 „Payment difference amount must be 0.0" (§234, 4 Live-Fälle).
    const exactGross = Number(inv.sumGross)
    await sevJson(`/Invoice/${sevdeskId}/bookAmount`, {
      method: 'PUT',
      body: JSON.stringify({
        amount: Number.isFinite(exactGross) && exactGross > 0 ? exactGross : inp.amountGross,
        date: Math.floor(Date.parse(inp.invoiceDate + 'T12:00:00Z') / 1000),
        type: 'FULL_PAYMENT',
        checkAccount: { id: Number(clearingId), objectName: 'CheckAccount' },
      }),
    })
  }

  return { sevdeskId, number: inp.invoiceNumber }
}

/** §235: PDF einer Rechnung (Gast-Download). preventSendBy=true, damit der
 *  Abruf den Versand-Status der Rechnung nicht verändert. Antwort laut
 *  Spec: { filename, mimeType, base64encoded, content } in der objects-Hülle. */
export async function getSevInvoicePdf(sevdeskId: string): Promise<{ ok: boolean; pdf?: Buffer; filename?: string; error?: string }> {
  try {
    const doc = await sevJson<{ filename?: string; content?: string; base64Encoded?: boolean; base64encoded?: boolean }>(
      `/Invoice/${sevdeskId}/getPdf?preventSendBy=true`)
    if (!doc?.content) return { ok: false, error: 'getPdf ohne content' }
    return { ok: true, pdf: Buffer.from(doc.content, 'base64'), filename: doc.filename }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) }
  }
}

/** §235-Nachtrag: Nach resetToOpen bleibt die Zahlung als UNVERKNÜPFTE
 *  Transaktion auf dem Verrechnungskonto liegen (Spec: „Linked transactions
 *  will be unlinked") — vor dem Neu-Verbuchen aufräumen, sonst liegt der
 *  Betrag doppelt auf dem Konto. Verrechnungskonten enthalten NUR unsere
 *  bookAmount-Buchungen → exakter Betrag + isBooked=false ist eindeutig. */
async function deleteClearingOrphan(clearingId: string, amount: number): Promise<boolean> {
  try {
    const list = await sevJson<{ id: string; amount: string | number }[]>(
      `/CheckAccountTransaction?checkAccount[id]=${clearingId}&checkAccount[objectName]=CheckAccount&isBooked=false&limit=50`)
    const hit = (list ?? []).find((t) => Math.abs(Math.abs(Number(t.amount)) - amount) < 0.005)
    if (!hit) return false
    const del = await sevFetch(`/CheckAccountTransaction/${hit.id}`, { method: 'DELETE' })
    return del.ok
  } catch {
    return false
  }
}

/** §235-Nachtrag: Empfänger DIREKT auf der bestehenden Rechnung ändern —
 *  möglich, solange sie nicht festgeschrieben ist (Inhaber-Doktrin:
 *  Festschreibung erst mit der UStVA). Partial-PUT wie beim CostCentre-
 *  Rename (§234-bewiesen); danach PDF neu rendern, damit der Gast-Link
 *  sofort die neue Anschrift zeigt.
 *
 *  KASKADE für BEZAHLTE Rechnungen (Inhaber-Idee 1.8.): lehnt sevdesk das
 *  direkte PUT bei Status ≥ 1000 ab → Zahlung rückgängig (resetToOpen) →
 *  ändern → Waisen-Transaktion vom Verrechnungskonto räumen → Zahlung neu
 *  verbuchen (bookAmount, exakter sumGross). Jeder Teilschritt ist über
 *  einen erneuten Aufruf selbstheilend (rebook greift auch, wenn ein
 *  früherer Versuch die Rechnung offen zurückließ). */
export async function updateSevInvoiceRecipient(sevdeskId: string, opts: {
  contactName: string
  addressText?: string
  /** Zahlungs-Sicherung für gebuchte Rechnungen: hält die Rechnung nach der
   *  Änderung garantiert wieder auf „bezahlt" (nur bei bezahlten Belegen
   *  übergeben — „auf Rechnung" bleibt bewusst offen) */
  rebook?: { clearingLabel: string; date: string }
}): Promise<{ ok: boolean; enshrined?: boolean; rebooked?: boolean; error?: string }> {
  try {
    type Inv = { id: string; status: string; enshrined?: string | null; sumGross: string | number }
    let inv = (await sevJson<Inv[]>(`/Invoice/${sevdeskId}`))[0]
    if (!inv) return { ok: false, error: 'Rechnung nicht gefunden' }
    if (inv.enshrined) return { ok: false, enshrined: true, error: 'Rechnung ist festgeschrieben' }
    const sumGross = Number(inv.sumGross)

    const contactId = await ensureContact(opts.contactName)
    const putRecipient = () => sevJson(`/Invoice/${sevdeskId}`, {
      method: 'PUT',
      body: JSON.stringify({
        contact: { id: Number(contactId), objectName: 'Contact' },
        address: opts.addressText ?? opts.contactName,
      }),
    })

    let usedReset = false
    try {
      await putRecipient()
    } catch (e) {
      if (!opts.rebook || Number(inv.status) < 1000) throw e
      // Bezahlt-Status blockiert das Update → Zahlung rückgängig, dann ändern
      await sevJson(`/Invoice/${sevdeskId}/resetToOpen`, { method: 'PUT' })
      usedReset = true
      await putRecipient()
    }

    // Zahlungs-Sicherung: steht die Rechnung (nach Reset oder einem früher
    // abgebrochenen Versuch) auf OFFEN, wird die Zahlung wieder verbucht
    let rebooked = false
    if (opts.rebook) {
      if (usedReset) inv = (await sevJson<Inv[]>(`/Invoice/${sevdeskId}`))[0]
      if (Number(inv.status) < 1000) {
        const clearingId = await ensureClearingAccount(opts.rebook.clearingLabel)
        const orphanWeg = await deleteClearingOrphan(clearingId, sumGross)
        if (usedReset && !orphanWeg) console.warn('[sevdesk] Waisen-Transaktion nach resetToOpen nicht gefunden — Verrechnungskonto prüfen:', sevdeskId)
        await sevJson(`/Invoice/${sevdeskId}/bookAmount`, {
          method: 'PUT',
          body: JSON.stringify({
            amount: sumGross,
            date: Math.floor(Date.parse(opts.rebook.date + 'T12:00:00Z') / 1000),
            type: 'FULL_PAYMENT',
            checkAccount: { id: Number(clearingId), objectName: 'CheckAccount' },
          }),
        })
        rebooked = true
      }
    }

    try {
      await sevFetch(`/Invoice/${sevdeskId}/render`, {
        method: 'POST', body: JSON.stringify({ forceReload: true }),
      })
    } catch { /* best effort — getPdf rendert zur Not selbst neu */ }
    return { ok: true, rebooked }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) }
  }
}

/** §235: Rechnung stornieren — sevdesk erzeugt die Stornorechnung, verrechnet
 *  sie automatisch und setzt das Original auf „cancelled" (Spec: cancelInvoice).
 *  ⚠️ Storniert = festgeschrieben (PoC §233) — GoBD-korrekt, nicht rückgängig. */
export async function cancelSevInvoice(sevdeskId: string): Promise<{ ok: boolean; cancellationId?: string; cancellationNumber?: string | null; error?: string }> {
  try {
    const sr = await sevJson<{ id: string; invoiceNumber?: string | null }>(
      `/Invoice/${sevdeskId}/cancelInvoice`, { method: 'POST' })
    return { ok: true, cancellationId: String(sr?.id ?? ''), cancellationNumber: sr?.invoiceNumber ?? null }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) }
  }
}

/** §236 C2: Beleg-Datei (Provisionsrechnung-PDF) zu sevdesk hochladen —
 *  multipart, deshalb eigener fetch (sevFetch erzwingt JSON-Content-Type). */
export async function uploadSevVoucherFile(pdf: Buffer, filename: string): Promise<{ ok: boolean; internalFilename?: string; error?: string }> {
  const token = process.env.SEVDESK_API_TOKEN
  if (!token) return { ok: false, error: 'SEVDESK_API_TOKEN fehlt' }
  try {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), filename)
    const res = await fetch(`${BASE}/Voucher/Factory/uploadTempFile`, {
      method: 'POST', headers: { Authorization: token }, body: form, cache: 'no-store',
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: `uploadTempFile HTTP ${res.status}: ${text.slice(0, 200)}` }
    const obj = (JSON.parse(text) as { objects?: { filename?: string } }).objects
    return obj?.filename
      ? { ok: true, internalFilename: obj.filename }
      : { ok: false, error: `uploadTempFile ohne filename: ${text.slice(0, 200)}` }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) }
  }
}

/** §236 C2: Beleg als ENTWURF anlegen (Status 50) — Datei + Lieferant +
 *  Beschreibung; die Verbuchung (Positionen, Reverse-Charge §13b, Zahlung
 *  gegen das Verrechnungskonto) bleibt bewusst beim Inhaber bzw. der
 *  späteren KI-Verbuchungs-Runde. Payload minimal — Kalibrierung §127. */
export async function createSevVoucherDraft(opts: {
  internalFilename: string
  supplierName: string
  description: string
  voucherDate?: string
  /** §238: Kostenstelle (Wohnung/Standort) — aus der Beleg-Inbox gewählt */
  costCentreName?: string
}): Promise<{ ok: boolean; voucherId?: string; error?: string }> {
  try {
    const costCentreId = opts.costCentreName ? await ensureCostCentre(opts.costCentreName) : null
    const saved = await sevJson<{ voucher: { id: string } }>('/Voucher/Factory/saveVoucher', {
      method: 'POST',
      body: JSON.stringify({
        voucher: {
          objectName: 'Voucher',
          mapAll: true,
          status: 50,
          creditDebit: 'C',
          voucherType: 'VOU',
          supplierName: opts.supplierName,
          description: opts.description,
          ...(opts.voucherDate ? { voucherDate: opts.voucherDate } : {}),
          ...(costCentreId ? { costCentre: { id: Number(costCentreId), objectName: 'CostCentre' } } : {}),
          // Auch der ENTWURF braucht eine Steuerregel (422 „Valid tax type
          // must be given", Kalibrierung 1.8.) — Standard: vorsteuer-
          // abziehbare Aufwendungen; §13b (Portale) stellt die Verbuchung um
          taxRule: { id: 9, objectName: 'TaxRule' },
        },
        voucherPosSave: null,
        voucherPosDelete: null,
        filename: opts.internalFilename,
      }),
    })
    return { ok: true, voucherId: String(saved?.voucher?.id ?? '') }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) }
  }
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

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
export async function uploadSevVoucherFile(pdf: Buffer, filename: string, mime = 'application/pdf'): Promise<{ ok: boolean; internalFilename?: string; error?: string }> {
  const token = process.env.SEVDESK_API_TOKEN
  if (!token) return { ok: false, error: 'SEVDESK_API_TOKEN fehlt' }
  try {
    const form = new FormData()
    // §243f: lexoffice-Belege sind teils BILDER (JPG-Scans) — falscher
    // MIME/Endung liess sevdesk mit 500 "Error while trying to read the
    // file" abbrechen
    form.append('file', new Blob([new Uint8Array(pdf)], { type: mime }), filename)
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
  /** §243o: 'D' = EINNAHME-Beleg (Erstattung/Auslagenausgleich) — Default 'C' (Ausgabe) */
  creditDebit?: 'C' | 'D'
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
          creditDebit: opts.creditDebit ?? 'C',
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

/* ── §239 BUCHHALTUNGSMODUL: Belege sichten + verbuchen ohne sevdesk-UI ── */

export interface SevVoucherLite {
  id: string
  status: number
  creditDebit: string | null
  supplierName: string | null
  description: string | null
  voucherDate: string | null
  sumGross: number | null
  costCentreName: string | null
}

/** Belege (Entwürfe status 50 + offene status 100) fürs Buchhaltungsmodul. */
export async function listSevVouchers(statuses: number[] = [50, 100]): Promise<SevVoucherLite[]> {
  const out: SevVoucherLite[] = []
  for (const st of statuses) {
    // §243b: PAGINIERT — beim limit=50-Deckel fielen frisch aus der Inbox
    // uebernommene Belege aus der Liste, sobald >50 Entwuerfe existierten
    // (§129-Lektion: sevdesk-Listen IMMER paginieren)
    for (let offset = 0; offset < 500; offset += 100) {
      const list = await sevJson<Record<string, unknown>[]>(`/Voucher?status=${st}&limit=100&offset=${offset}&embed=costCentre`)
      for (const v of list ?? []) {
        const cc = v.costCentre as { name?: string } | null
        out.push({
          id: String(v.id), status: Number(v.status),
          creditDebit: (v.creditDebit as string | null) ?? null,
          supplierName: (v.supplierName as string | null) ?? null,
          description: (v.description as string | null) ?? null,
          voucherDate: v.voucherDate ? String(v.voucherDate).slice(0, 10) : null,
          sumGross: v.sumGross != null ? Number(v.sumGross) : null,
          costCentreName: cc?.name ?? null,
        })
      }
      if (!list || list.length < 100) break
    }
  }
  // Neueste zuerst — stabil ueber die numerische ID
  out.sort((a, b) => Number(b.id) - Number(a.id))
  return out
}

export interface ReceiptGuide {
  accountDatevId: number
  accountNumber: string
  accountName: string
  description: string | null
}

/** sevdesks Buchungskategorien-Katalog (ReceiptGuidance) — 1h-Cache. */
export async function getReceiptGuidance(): Promise<ReceiptGuide[]> {
  const gg = globalThis as typeof globalThis & { __sevGuidance?: { at: number; list: ReceiptGuide[] } }
  if (gg.__sevGuidance && Date.now() - gg.__sevGuidance.at < 3600_000) return gg.__sevGuidance.list
  const raw = await sevJson<Record<string, unknown>[]>('/ReceiptGuidance/forAllAccounts')
  const list = (raw ?? []).map((r) => ({
    accountDatevId: Number(r.accountDatevId),
    accountNumber: String(r.accountNumber ?? ''),
    accountName: String(r.accountName ?? ''),
    description: (r.description as string | null) ?? null,
  })).filter((r) => Number.isFinite(r.accountDatevId) && r.accountName)
  gg.__sevGuidance = { at: Date.now(), list }
  return list
}

/** Kostenstelle auf einem bestehenden Beleg setzen (Partial-PUT, §234-Muster). */
export async function updateSevVoucherCostCentre(voucherId: string, costCentreName: string | null): Promise<{ ok: boolean; error?: string }> {
  try {
    const body = costCentreName
      ? { costCentre: { id: Number(await ensureCostCentre(costCentreName)), objectName: 'CostCentre' } }
      : { costCentre: null }
    await sevJson(`/Voucher/${voucherId}`, { method: 'PUT', body: JSON.stringify(body) })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300) }
  }
}

/**
 * Beleg VERBUCHEN ohne sevdesk-UI (§239): Position (Buchungskategorie via
 * accountDatev + Steuersatz + Brutto) setzen, Beleg finalisieren (status
 * 100) und optional direkt mit einer offenen Bank-Transaktion verknüpfen
 * (Voucher-bookAmount mit checkAccountTransaction → Zahlung zugeordnet).
 * ⚠️ Payload-Form der VoucherPos am ersten echten Fall kalibrieren (§127).
 */
export async function bookSevVoucher(voucherId: string, opts: {
  accountDatevId: number
  taxRate: number
  amountGross: number
  costCentreName?: string | null
  /** §242: Position als ANLAGEGUT markieren — sevdesk führt sie dann im
   *  Anlagenmodul (Nutzungsdauer/AfA-Start bestätigt der Inhaber dort;
   *  die Public API kann keine AfA-Parameter setzen) */
  isAsset?: boolean
  /** offene Bank-Transaktion, die die Zahlung darstellt */
  txId?: string
  txAccountId?: string
  txDate?: string
  /** §243: MEHRERE Positionen (Eigenbeleg Kreditrate: Zins + Tilgung) —
   *  wenn gesetzt, gewinnen sie über die Einzel-Felder; bookAmount läuft
   *  über die Brutto-SUMME */
  positions?: { accountDatevId: number; taxRate: number; amountGross: number; isAsset?: boolean }[]
  /** §243h: echtes RECHNUNGSDATUM setzen (Mail-Scan-Belege trugen sonst
   *  das Scan-Datum — UStVA-Periode!) */
  voucherDate?: string
  /** §243b: USt-Regel des Belegs — Default 9 (vorsteuerabziehbare
   *  Aufwendungen); 5 = Reverse Charge §13b (Portal-Provisionen, Konto
   *  5923) — steuert die UStVA-Kennziffern! */
  taxRuleId?: number
  /** §243o: EINNAHME-Beleg (creditDebit 'D') — bookAmount muss dann POSITIV
   *  sein (wie der Bank-Eingang; Vorzeichen-Doktrin §242 gespiegelt) */
  einnahme?: boolean
}): Promise<{ ok: boolean; verknuepft?: boolean; hinweis?: string; error?: string }> {
  try {
    const posList = opts.positions?.length
      ? opts.positions
      : [{ accountDatevId: opts.accountDatevId, taxRate: opts.taxRate, amountGross: opts.amountGross, isAsset: opts.isAsset }]
    const gross = Math.round(posList.reduce((a, p) => a + p.amountGross, 0) * 100) / 100

    // §242-Härtung: saveVoucher kann nur ENTWÜRFE ändern — ein Beleg, der
    // schon Status 100 hat (z. B. weil ein früherer bookAmount scheiterte),
    // muss erst zurück in den Entwurf
    let zahlungGeloest = false
    try {
      const cur = await sevJson<{ status?: string | number }[] | { status?: string | number }>(`/Voucher/${voucherId}`)
      const st = Number(Array.isArray(cur) ? cur[0]?.status : (cur as { status?: string | number })?.status)
      // §243c: BEZAHLTE Belege (1000) erst zurueck auf offen — loest die
      // Bank-Verknuepfung (Transaktion wird wieder frei; der Aufrufer
      // verknuepft sie neu bzw. der Bankabgleich matcht sie)
      if (st === 1000) {
        await sevFetch(`/Voucher/${voucherId}/resetToOpen`, { method: 'PUT', body: '{}' })
        zahlungGeloest = true
      }
      if (st === 100 || st === 1000) await sevFetch(`/Voucher/${voucherId}/resetToDraft`, { method: 'PUT', body: '{}' })
    } catch { /* best effort — saveVoucher meldet sonst selbst */ }
    const costCentreId = opts.costCentreName ? await ensureCostCentre(opts.costCentreName) : null
    // §242b: bestehende Positionen ERSETZEN — ein Re-Save (Reparatur,
    // zweiter Anlauf) hängte sonst Positionen an (Juni-Hetzner: 2×8,26)
    let posDelete: { id: number; objectName: 'VoucherPos' }[] | null = null
    try {
      const existing = await sevJson<{ id: unknown }[]>(`/VoucherPos?voucher[id]=${voucherId}&voucher[objectName]=Voucher&limit=20`)
      if (existing?.length) posDelete = existing.map((x) => ({ id: Number(x.id), objectName: 'VoucherPos' as const }))
    } catch { /* best effort */ }
    const doSave = (taxRuleId: number) => sevJson('/Voucher/Factory/saveVoucher', {
      method: 'POST',
      body: JSON.stringify({
        voucher: {
          id: Number(voucherId),
          objectName: 'Voucher',
          mapAll: true,
          status: 100,
          // §242: USt-Regel EXPLIZIT — der Update-Save darf die Regel des
          // Entwurfs (9 = vorsteuerabziehbare Aufwendungen) nicht kippen;
          // Sonderkonten (§13b EU/Drittland) brauchen ihre eigene Regel
          taxRule: { id: taxRuleId, objectName: 'TaxRule' },
          // §243q: Gutschriften/Erstattungen — Beleg als EINNAHME (D) drehen
          ...(opts.einnahme ? { creditDebit: 'D' } : {}),
          ...(opts.voucherDate ? { voucherDate: opts.voucherDate } : {}),
          // costCentreName '' = Kostenstelle EXPLIZIT entfernen (§243c —
          // Gaestemanagement-Umbuchung: KSt weg, Zuordnung = alle Wohnungen)
          ...(costCentreId ? { costCentre: { id: Number(costCentreId), objectName: 'CostCentre' } } : opts.costCentreName === '' ? { costCentre: null } : {}),
        },
        voucherPosSave: posList.map((p) => {
          const pg = Math.round(p.amountGross * 100) / 100
          return {
            objectName: 'VoucherPos',
            mapAll: true,
            accountDatev: { id: p.accountDatevId, objectName: 'AccountDatev' },
            taxRate: p.taxRate,
            net: false,
            isAsset: p.isAsset === true,
            sumNet: Math.round((pg / (1 + p.taxRate / 100)) * 100) / 100,
            sumGross: pg,
          }
        }),
        voucherPosDelete: posDelete,
      }),
    })
    try {
      await doSave(opts.taxRuleId ?? 9)
    } catch (e) {
      // §243b SELBSTKALIBRIEREND: sevdesk nennt im 422 die fuer das Konto
      // erlaubte Steuerregel („Allowed tax rules: TaxRule(id=14, …") —
      // einmaliger Retry damit deckt ALLE Sonderkonten ab (5923→14,
      // Drittlands-Leistungen etc.), ohne jede Regel zu hartkodieren
      const msg = String(e instanceof Error ? e.message : e)
      const m = msg.match(/Allowed tax rules: TaxRule\(id=(\d+)/)
      if (!m) throw e
      await doSave(Number(m[1]))
    }
    if (opts.txId && opts.txAccountId) {
      await sevJson(`/Voucher/${voucherId}/bookAmount`, {
        method: 'PUT',
        body: JSON.stringify({
          // §242-VORZEICHEN-LEKTION (empirisch, Hetzner-Juni): AUSGABE-
          // Zahlungen müssen NEGATIV übergeben werden (wie die Bank-
          // Abbuchung) — positiv ergab paidAmount −X und „offen" = 2×X
          // (Teilbezahlt-Chaos); Einnahme-Rechnungen (§234) bleiben positiv
          amount: opts.einnahme ? gross : -gross,
          date: Math.floor(Date.parse((opts.txDate ?? new Date().toISOString().slice(0, 10)) + 'T12:00:00Z') / 1000),
          type: 'FULL_PAYMENT',
          checkAccount: { id: Number(opts.txAccountId), objectName: 'CheckAccount' },
          checkAccountTransaction: { id: Number(opts.txId), objectName: 'CheckAccountTransaction' },
        }),
      })
      return { ok: true, verknuepft: true, ...(zahlungGeloest ? { hinweis: 'Alte Zahlung geloest und neu verknuepft.' } : {}) }
    }
    return { ok: true, verknuepft: false, ...(zahlungGeloest ? { hinweis: 'Alte Zahlung wurde geloest — Transaktion ist wieder offen (neu verknuepfen oder Bankabgleich).' } : {}) }
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    // §242: Scheitert NUR der bookAmount (Beleg ist da schon kategorisiert +
    // finalisiert), ist das kein Fehler — sevdesks eigene Bank-Automatik hat
    // die Zahlung oft schon vergeben; der Bankabgleich erledigt den Rest
    if (/bookAmount/.test(msg)) {
      return { ok: true, verknuepft: false, hinweis: 'Beleg verbucht — Zahlung war nicht verknüpfbar (vermutlich hat sevdesks Bank-Automatik sie schon vergeben).' }
    }
    return { ok: false, error: msg.slice(0, 300) }
  }
}

/** §243o: Transaktion in sevdesk als PRIVAT markieren (Status 300) —
 *  Spiegel der App-Funktion „Kein Beleg nötig". Das Update-Schema erlaubt
 *  status 100/200/300/400 explizit (Spec Model_CheckAccountTransactionUpdate);
 *  Rückweg = wieder auf 100 (offen). */
export async function markTransactionPrivate(txId: string, on = true): Promise<{ ok: boolean; error?: string }> {
  try {
    await sevJson(`/CheckAccountTransaction/${txId}`, {
      method: 'PUT', body: JSON.stringify({ status: on ? 300 : 100 }),
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 200) }
  }
}

/** §243o: Beleg LÖSCHEN (Import-Duplikate). DELETE /Voucher steht NICHT in
 *  der Spec (die ist notorisch unvollständig, vgl. CostCentre-CRUD) —
 *  Kalibrier-Versuch: bezahlt → resetToOpen, finalisiert → resetToDraft,
 *  dann DELETE. Scheitert der DELETE (404/405), bleibt der Beleg als
 *  Entwurf und die UI-Löschung ist der Fallback. */
export async function deleteSevVoucher(voucherId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const cur = await sevJson<{ status?: string | number }[] | { status?: string | number }>(`/Voucher/${voucherId}`)
    const st = Number(Array.isArray(cur) ? cur[0]?.status : (cur as { status?: string | number })?.status)
    if (st === 1000) await sevFetch(`/Voucher/${voucherId}/resetToOpen`, { method: 'PUT', body: '{}' })
    if (st >= 100) await sevFetch(`/Voucher/${voucherId}/resetToDraft`, { method: 'PUT', body: '{}' })
    const res = await sevFetch(`/Voucher/${voucherId}`, { method: 'DELETE' })
    if (!res.ok) {
      const t = await res.text()
      return { ok: false, error: `DELETE HTTP ${res.status}: ${t.slice(0, 150)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 200) }
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

/** §240: Kostenstellen-Doktrin — bestehende Rechnungen von Wohnungs- auf
 *  STANDORT-Kostenstellen umziehen (mapping: WohnungsTitel → StandortName).
 *  Idempotent (bereits umgezogene werden übersprungen), festgeschriebene
 *  Belege werden nie angefasst. */
export async function migrateInvoiceCostCentres(
  mapping: Record<string, string>,
  opts: { dryRun?: boolean; limit?: number } = {},
): Promise<{ geprueft: number; geaendert: number; uebersprungen: number; fehler: string[]; dryRun: boolean }> {
  const dryRun = opts.dryRun !== false
  const limit = Math.min(Math.max(opts.limit ?? 400, 1), 500)
  const fehler: string[] = []
  let geprueft = 0, geaendert = 0, uebersprungen = 0

  // Ziel-Kostenstellen einmal auflösen/anlegen
  const targetIds = new Map<string, string>()
  for (const ziel of [...new Set(Object.values(mapping))]) {
    targetIds.set(ziel, await ensureCostCentre(ziel))
  }

  for (let offset = 0; offset < 2000; offset += 100) {
    const page = await sevJson<Record<string, unknown>[]>(
      `/Invoice?limit=100&offset=${offset}&embed=costCentre`)
    if (!page.length) break
    for (const inv of page) {
      geprueft++
      const cc = inv.costCentre as { id?: unknown; name?: string } | null
      const ziel = cc?.name ? mapping[cc.name] : undefined
      if (!ziel) { uebersprungen++; continue }
      if (inv.enshrined) { uebersprungen++; fehler.push(`${inv.invoiceNumber}: festgeschrieben — nicht angefasst`); continue }
      if (geaendert >= limit) continue
      if (!dryRun) {
        try {
          const r = await sevFetch(`/Invoice/${inv.id}`, {
            method: 'PUT',
            body: JSON.stringify({ costCentre: { id: Number(targetIds.get(ziel)), objectName: 'CostCentre' } }),
          })
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 140)}`)
          await new Promise((res) => setTimeout(res, 250))
        } catch (e) {
          fehler.push(`${inv.invoiceNumber}: ${String(e instanceof Error ? e.message : e)}`)
          continue
        }
      }
      geaendert++
    }
    if (page.length < 100) break
  }
  return { geprueft, geaendert, uebersprungen, fehler: fehler.slice(0, 20), dryRun }
}

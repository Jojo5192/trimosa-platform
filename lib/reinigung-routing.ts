/**
 * 🧹 Reinigungs-Weiterleitung (Pascal 6.10.2026 · Entscheid des Inhabers: „Aufgabe + Push an die Firma"):
 * Fragen zu Late Check-out, Late Check-in und Early Check-in sowie Reinigungsmängel aus Gast-Chats und Bewertungen
 * gehen automatisch als AUFGABE mit Push an die für die Wohnung zuständige Reinigungskraft
 * (listings.cleaning_responsible). Die Antwort an den Gast bleibt beim Team im Gäste-Chat: Die Reinigungskraft
 * antwortet im Aufgaben-Kommentar, Admins/Gastgeber bekommen dazu einen Push (meldeReinigungsAntwort, aufgerufen
 * aus app/api/tasks/[id]/comments). Die Reinigungskraft sieht KEINE Gäste-Chats.
 *
 * Hier geht NIE etwas an Gäste raus — kein Smoobu-, Mail- oder Chat-Versand, nur interne Aufgaben und Pushes.
 *
 * Ablauf je Lauf (Cron alle 15 Min, app/api/reinigung/routing):
 *  1. neue Gast-Nachrichten (Buchungs-Threads + Direkt-Chats) und neue Bewertungen seit dem Cursor lesen
 *     (app_settings 'reinigung_routing_cursor', Start bei „jetzt minus 2 Stunden", nie Tage rückwirkend)
 *  2. Stichwort-Vorfilter → nur Treffer gehen an die KI (FAST_MODEL, höchstens 40 je Lauf, Rest im nächsten Lauf)
 *  3. Treffer → EINE Aufgabe (source reinigung_frage | reinigung_mangel, source_ref msg:<id> | bew:<portal>:<id>);
 *     gleiche Buchung + gleiches Thema binnen 24 h → die offene Aufgabe wird ergänzt statt doppelt angelegt
 *  4. Push an die Reinigungskraft; erreicht er kein Gerät oder ist niemand hinterlegt → Push ans Büro
 *
 * Fragen bekommen KEIN Fälligkeitsdatum (und stehen zusätzlich in KEINE_ARBEIT von lib/early-checkin.ts) — sie
 * sperren den Early Check-in also nie. Mängel sind fällig zur nächsten Anreise und dürfen sperren (echte Arbeit).
 * Reine Logik (Vorfilter, KI-Auswertung, Texte, Dedupe, Cursor) liegt in lib/reinigung-routing-logik.ts.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { istInaktiveBuchung } from '@/lib/booking-status'
import { askClaude, FAST_MODEL } from '@/lib/ai'
import { sendPushToUser } from '@/lib/push'
import { getTaskPermissions } from '@/lib/tasks'
import {
  antwortPushTitel, berlinHeute, bewertungsQuelleLabel, datumKurz, findeOffeneAufgabe, frageBeschreibung, frageTitel,
  frageTitelPrefix, istFrageThema, istReinigungsSource, kanalLabel, KLASSIFIKATION_SYSTEM, klassifikationsEingabe,
  leseZustand, mangelBeschreibung, mangelTitel, MANGEL_PREFIX, MAX_FEHLVERSUCHE, nachtragText, plusTage, pushText,
  raeumeZustandAuf, schonErfasst, THEMA_LABEL, threadKeyFuer, untergrenzeVon, vorfilter, vorfilterBewertung,
  werteKlassifikationAus, ZUSAMMENFUEHREN_MS,
  type Herkunft, type Klassifikation, type ReinigungsSource, type ReinigungsThema, type RoutingZustand,
} from '@/lib/reinigung-routing-logik'

// Reine Funktionen auch hier anbieten (Tests/Aufrufer brauchen nur einen Import-Pfad)
export {
  vorfilter, vorfilterBewertung, werteKlassifikationAus, frageTitel, frageBeschreibung, mangelTitel,
  mangelBeschreibung, schonErfasst, findeOffeneAufgabe, istReinigungsSource,
} from '@/lib/reinigung-routing-logik'

const CURSOR_KEY = 'reinigung_routing_cursor'
const MAX_KLASSIFIKATIONEN = 40
/** Route hat maxDuration 120 s — nach 85 s keine neue KI-Anfrage mehr, der Rest bleibt für Schreiben + Pushes */
const ZEITBUDGET_MS = 85_000
const KI_ZEITLIMIT_MS = 20_000
const MAX_NACHRICHTEN = 500
const MAX_BEWERTUNGEN = 100
const BEWERTUNG_MAX_ALTER_TAGE = 30

interface ListingZeile {
  id: string; title: string; location_group: string | null; cleaning_responsible: string | null
  check_in_time: string | null; check_out_time: string | null
}
interface BuchungZeile {
  id: string; listing_id: string | null; guest_name: string | null; check_in: string; check_out: string
  status: string | null; channel: string | null; source: string | null
}
interface KonvZeile { id: string; guest_id: string | null; guest_name: string | null; booking_id: string | null; listing_id: string | null }
interface AufgabeZeile {
  id: string; title: string; description: string | null; source: string; status: string
  created_at: string; source_ref: string | null; assignee_id: string | null
}

/** Eine neue Gast-Nachricht oder Bewertung, die geprüft wird */
interface Eintrag {
  herkunft: Herkunft
  ref: string
  createdAt: string
  text: string
  textDe: string | null
  lang: string | null
  bookingId: string | null
  conversationId: string | null
  listingId: string | null
  gastName: string | null
  note: number | null
  portal: string | null
  portalId: string | null
  autor: string | null
  bewertungsDatum: string | null
}

export interface VorschauEintrag {
  ergebnis: 'angelegt' | 'ergaenzt' | 'doppelt' | 'uebersprungen'
  herkunft: Herkunft
  ref: string
  thema: ReinigungsThema
  titel?: string
  /** nur im Probelauf */
  beschreibung?: string
  an?: string
  push?: string
  grund?: string
  aufgabeId?: string
}

export interface RoutingErgebnis {
  dryRun: boolean
  seit: string
  /** neue (noch nicht geprüfte) Gast-Nachrichten / Bewertungen in diesem Lauf */
  nachrichten: number
  bewertungen: number
  kiGeprueft: number
  angelegt: number
  ergaenzt: number
  doppelt: number
  uebersprungen: number
  fehler: number
  abgebrochen?: 'limit' | 'zeit' | 'ki-fehler' | 'db-fehler' | 'lauf-aktiv'
  /** gesetzt, wenn die KI-Einordnung komplett ausfiel → die Route meldet eine Störung (lib/ausfall.ts) */
  ausfall?: string
  vorschau: VorschauEintrag[]
}

interface Kontext {
  heute: string
  dryRun: boolean
  listings: Map<string, ListingZeile>
  buchungen: Map<string, BuchungZeile>
  namen: Map<string, string>
  /** nur Probelauf: was in DIESEM Lauf angelegt würde — damit Folge-Nachrichten derselben Buchung als „ergänzt"
   *  erscheinen wie im echten Lauf (dort steht die Aufgabe dann schon in der Datenbank) */
  geplant: { source: ReinigungsSource; titelPrefix: string; threadKey: string; titel: string }[]
}

interface Plan {
  source: ReinigungsSource
  titel: string
  titelPrefix: string
  beschreibung: string
  listingId: string | null
  locationGroup: string | null
  assignee: string | null
  prio: 'hoch' | 'mittel'
  dueDate: string | null
}

// Lauf-Lock (gleiche Instanz): zwei echte Läufe dürfen nicht parallel über denselben Cursor gehen
const g = globalThis as typeof globalThis & { __reinigungRouting?: boolean }

function leeresErgebnis(dryRun: boolean, seit: string): RoutingErgebnis {
  return { dryRun, seit, nachrichten: 0, bewertungen: 0, kiGeprueft: 0, angelegt: 0, ergaenzt: 0, doppelt: 0, uebersprungen: 0, fehler: 0, vorschau: [] }
}

/**
 * Ein Lauf. dryRun: zeigt, was angelegt WÜRDE — keine Aufgabe, kein Push, kein Cursor-Schreiben (die KI wird
 * trotzdem gefragt). stunden (nur mit dryRun, 1–72): festes Rückblick-Fenster statt Cursor, inkl. schon geprüfter
 * Nachrichten — zum Ausprobieren an echten Beispielen.
 */
export async function runReinigungsRouting(opts: { dryRun?: boolean; stunden?: number } = {}): Promise<RoutingErgebnis> {
  const dryRun = opts.dryRun === true
  if (!dryRun) {
    if (g.__reinigungRouting) return { ...leeresErgebnis(false, ''), abgebrochen: 'lauf-aktiv' }
    g.__reinigungRouting = true
  }
  try {
    return await lauf(dryRun, opts.stunden)
  } finally {
    if (!dryRun) g.__reinigungRouting = false
  }
}

async function lauf(dryRun: boolean, stunden?: number): Promise<RoutingErgebnis> {
  const t0 = Date.now()
  const runStart = new Date(t0).toISOString()
  const heute = berlinHeute()

  // ── Cursor-Zustand ──
  const { data: zRow, error: zErr } = await supabaseAdmin.from('app_settings').select('value').eq('key', CURSOR_KEY).maybeSingle()
  if (zErr) throw new Error(`Cursor nicht lesbar: ${zErr.message}`)
  const { zustand } = leseZustand(zRow?.value, t0)
  const probe = dryRun && Number.isFinite(stunden) && Number(stunden) > 0 ? Math.min(72, Math.max(1, Math.round(Number(stunden)))) : null
  const seit = probe ? new Date(t0 - probe * 3_600_000).toISOString() : untergrenzeVon(zustand, t0)
  const erg = leeresErgebnis(dryRun, seit)

  // ── Wohnungen (kleine Tabelle, einmal laden) ──
  const { data: lRows, error: lErr } = await supabaseAdmin
    .from('listings').select('id, title, location_group, cleaning_responsible, check_in_time, check_out_time')
  if (lErr) throw new Error(`Wohnungen nicht ladbar: ${lErr.message}`)
  const listings = new Map(((lRows ?? []) as ListingZeile[]).map((l) => [l.id, l]))

  // ── Neue Gast-Nachrichten (Buchungs-Threads), Direkt-Chat-Nachrichten, neue Bewertungen ──
  const [bm, dm, rv] = await Promise.all([
    supabaseAdmin.from('messages')
      .select('id, content, content_de, lang, created_at, booking_id')
      .eq('sender_type', 'guest').not('booking_id', 'is', null)
      .gt('created_at', seit).order('created_at', { ascending: true }).limit(MAX_NACHRICHTEN),
    supabaseAdmin.from('messages')
      .select('id, content, content_de, lang, created_at, sender_id, conversation_id')
      .not('conversation_id', 'is', null)
      .gt('created_at', seit).order('created_at', { ascending: true }).limit(MAX_NACHRICHTEN),
    // Nachgeholte Alt-Bewertungen tragen created_at = Bewertungsdatum → review_date-Grenze hält sie draußen
    supabaseAdmin.from('reviews')
      .select('id, listing_id, source, source_review_id, author_name, rating, review_text, review_date, booking_id, created_at')
      .gt('created_at', seit).gte('review_date', plusTage(heute, -BEWERTUNG_MAX_ALTER_TAGE))
      .not('review_text', 'is', null)
      .order('created_at', { ascending: true }).limit(MAX_BEWERTUNGEN),
  ])
  if (bm.error) throw new Error(`Gast-Nachrichten nicht ladbar: ${bm.error.message}`)
  if (dm.error) throw new Error(`Direkt-Chat-Nachrichten nicht ladbar: ${dm.error.message}`)
  if (rv.error) throw new Error(`Bewertungen nicht ladbar: ${rv.error.message}`)
  const bmRows = (bm.data ?? []) as { id: string; content: string | null; content_de: string | null; lang: string | null; created_at: string; booking_id: string }[]
  const dmRows = (dm.data ?? []) as { id: string; content: string | null; content_de: string | null; lang: string | null; created_at: string; sender_id: string | null; conversation_id: string }[]
  const rvRows = (rv.data ?? []) as {
    id: string; listing_id: string; source: string; source_review_id: string | null; author_name: string | null; rating: number | string | null
    review_text: string | null; review_date: string; booking_id: string | null; created_at: string
  }[]

  // Direkt-Chats: nur Nachrichten des GASTES zählen (Gast = conversations.guest_id)
  const convs = new Map<string, KonvZeile>()
  const convIds = [...new Set(dmRows.map((m) => m.conversation_id))]
  for (let i = 0; i < convIds.length; i += 100) {
    const { data, error } = await supabaseAdmin
      .from('conversations').select('id, guest_id, guest_name, booking_id, listing_id').in('id', convIds.slice(i, i + 100))
    if (error) throw new Error(`Direkt-Chats nicht ladbar: ${error.message}`)
    for (const c of (data ?? []) as KonvZeile[]) convs.set(c.id, c)
  }

  const eintraege: Eintrag[] = []
  const refs = new Set<string>()
  const leer = { conversationId: null, listingId: null, gastName: null, note: null, portal: null, portalId: null, autor: null, bewertungsDatum: null }
  for (const m of bmRows) {
    const ref = `msg:${m.id}`
    if (refs.has(ref)) continue
    refs.add(ref)
    eintraege.push({ ...leer, herkunft: 'chat', ref, createdAt: m.created_at, text: m.content ?? '', textDe: m.content_de ?? null, lang: m.lang ?? null, bookingId: m.booking_id })
  }
  for (const m of dmRows) {
    const c = convs.get(m.conversation_id)
    if (!c || !m.sender_id || m.sender_id !== c.guest_id) continue
    const ref = `msg:${m.id}`
    if (refs.has(ref)) continue
    refs.add(ref)
    eintraege.push({
      ...leer, herkunft: 'chat', ref, createdAt: m.created_at, text: m.content ?? '', textDe: m.content_de ?? null, lang: m.lang ?? null,
      bookingId: c.booking_id ?? null, conversationId: c.id, listingId: c.listing_id ?? null, gastName: c.guest_name ?? null,
    })
  }
  for (const r of rvRows) {
    // Portal-ID statt Zeilen-ID: Kopien geteilter Booking-Unterkünfte (§124) sind DIESELBE Bewertung
    const ref = r.source_review_id ? `bew:${r.source}:${r.source_review_id}` : `bew:${r.id}`
    if (refs.has(ref)) continue
    refs.add(ref)
    const note = Number(r.rating)
    eintraege.push({
      ...leer, herkunft: 'bewertung', ref, createdAt: r.created_at, text: r.review_text ?? '', textDe: null, lang: null,
      bookingId: r.booking_id ?? null, listingId: r.listing_id, note: Number.isFinite(note) ? note : null,
      portal: r.source, portalId: r.source_review_id, autor: r.author_name, bewertungsDatum: r.review_date,
    })
  }
  eintraege.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))

  // Hing eine Abfrage am Zeilenlimit, nur bis zu deren letzter Zeile arbeiten (Rest im nächsten Lauf)
  const grenze = (rows: { created_at: string }[], max: number) => (rows.length >= max ? Date.parse(rows[rows.length - 1].created_at) : Infinity)
  const bis = Math.min(grenze(bmRows, MAX_NACHRICHTEN), grenze(dmRows, MAX_NACHRICHTEN), grenze(rvRows, MAX_BEWERTUNGEN))
  const begrenzt = Number.isFinite(bis)
  if (begrenzt) console.warn('[reinigung-routing] Zeilenlimit erreicht — Rest im nächsten Lauf')

  const offen = eintraege
    .filter((e) => !begrenzt || Date.parse(e.createdAt) <= bis)
    .filter((e) => probe || !(e.herkunft === 'chat' ? zustand.gesehen[e.ref] : zustand.bewertungen[e.ref]))
  erg.nachrichten = offen.filter((e) => e.herkunft === 'chat').length
  erg.bewertungen = offen.length - erg.nachrichten

  // Vorfilter vorab (rein, billig) — Buchungen nur für die Kandidaten laden
  const kandidat = new Map<string, boolean>()
  for (const e of offen) {
    const pruefText = [e.textDe, e.text].filter(Boolean).join('\n')
    kandidat.set(e.ref, pruefText.trim().length >= 6 && (e.herkunft === 'chat' ? vorfilter(pruefText).length > 0 : vorfilterBewertung(e.text, e.note)))
  }
  const buchungen = await ladeBuchungen([...new Set(offen.filter((e) => kandidat.get(e.ref)).map((e) => e.bookingId).filter((x): x is string => !!x))])
  const ctx: Kontext = { heute, dryRun, listings, buchungen, namen: new Map(), geplant: [] }

  const markiere = (e: Eintrag) => {
    if (e.herkunft === 'chat') zustand.gesehen[e.ref] = e.createdAt
    else zustand.bewertungen[e.ref] = runStart
    delete zustand.fehlversuche[e.ref]
  }

  let stopVor: Eintrag | null = null
  let kiFehler = ''
  for (const e of offen) {
    if (Date.now() - t0 > ZEITBUDGET_MS) { erg.abgebrochen = 'zeit'; stopVor = e; break }
    if (!kandidat.get(e.ref)) { markiere(e); continue }
    if (erg.kiGeprueft >= MAX_KLASSIFIKATIONEN) { erg.abgebrochen = 'limit'; stopVor = e; break }

    const booking = e.bookingId ? buchungen.get(e.bookingId) ?? null : null
    const listing = listingVon(ctx, booking, e)
    let raw: string
    try {
      raw = await mitZeitlimit(askClaude(KLASSIFIKATION_SYSTEM, klassifikationsEingabe({
        herkunft: e.herkunft,
        text: e.text,
        textDe: e.textDe,
        regulaerCheckin: uhrzeit(listing?.check_in_time, '15:00'),
        regulaerCheckout: uhrzeit(listing?.check_out_time, '11:00'),
        anreise: booking?.check_in ?? null,
        abreise: booking?.check_out ?? null,
        kanal: e.herkunft === 'bewertung' ? bewertungsQuelleLabel(e.portal) : kanalLabel(booking?.channel, booking?.source),
        note: e.note,
      }), 600, FAST_MODEL), KI_ZEITLIMIT_MS)
      erg.kiGeprueft++
    } catch (err) {
      erg.fehler++
      kiFehler = String(err instanceof Error ? err.message : err).slice(0, 160)
      console.error('[reinigung-routing] KI-Einordnung fehlgeschlagen:', e.ref, kiFehler)
      if (zaehleFehlversuch(zustand, e.ref)) markiere(e)
      erg.abgebrochen = 'ki-fehler'
      stopVor = e
      break
    }

    const k = werteKlassifikationAus(raw, e.herkunft)
    if (!k) console.warn('[reinigung-routing] KI-Antwort nicht lesbar:', e.ref, raw.slice(0, 120))
    if (!k || k.thema === 'keins') { markiere(e); continue }

    try {
      const v = await verarbeiteTreffer(e, k, ctx)
      erg.vorschau.push(v)
      erg[v.ergebnis]++
    } catch (err) {
      erg.fehler++
      console.error('[reinigung-routing] Aufgabe fehlgeschlagen:', e.ref, err)
      if (zaehleFehlversuch(zustand, e.ref)) markiere(e)
      erg.abgebrochen = 'db-fehler'
      stopVor = e
      break
    }
    markiere(e)
  }

  if (erg.abgebrochen === 'ki-fehler' && erg.kiGeprueft === 0) {
    erg.ausfall = `Late-Check-out-Fragen und Reinigungsmängel gehen gerade nicht an die Reinigung, die KI-Einordnung ist nicht erreichbar (${kiFehler}).`
  }

  if (!dryRun) {
    // Cursor nur bis vor die erste NICHT verarbeitete Zeile vorziehen
    const since = stopVor
      ? new Date(Date.parse(stopVor.createdAt) - 1).toISOString()
      : begrenzt ? new Date(bis - 1).toISOString() : runStart
    const neu: RoutingZustand = raeumeZustandAuf({ ...zustand, since, ueberlappen: !begrenzt }, t0)
    const { error } = await supabaseAdmin.from('app_settings').upsert({ key: CURSOR_KEY, value: neu, updated_at: runStart })
    if (error) throw new Error(`Cursor nicht gespeichert: ${error.message}`)
  }
  return erg
}

/** Ein KI-Treffer → Aufgabe anlegen, vorhandene ergänzen oder (Dublette/unpassend) überspringen */
async function verarbeiteTreffer(e: Eintrag, k: Klassifikation, ctx: Kontext): Promise<VorschauEintrag> {
  const basis = { herkunft: e.herkunft, ref: e.ref, thema: k.thema }
  const skip = (grund: string): VorschauEintrag => ({ ...basis, ergebnis: 'uebersprungen', grund })
  const booking = e.bookingId ? ctx.buchungen.get(e.bookingId) ?? null : null
  if (booking && istInaktiveBuchung(booking.status)) return skip(booking.status === 'cancelled' ? 'Buchung storniert' : 'Buchung noch nicht bezahlt')
  const listing = listingVon(ctx, booking, e)
  const vorname = vornameVon(booking?.guest_name ?? e.gastName ?? (e.herkunft === 'bewertung' ? e.autor : null))
  const zitat = zitatFuer(e, k)
  const regIn = uhrzeit(listing?.check_in_time, '15:00')
  const regOut = uhrzeit(listing?.check_out_time, '11:00')

  let plan: Plan
  if (istFrageThema(k.thema)) {
    if (e.herkunft !== 'chat' || !booking || !listing) return skip('Frage ohne zuordenbare Buchung/Wohnung')
    const datum = k.thema === 'late_checkout' ? booking.check_out : booking.check_in
    if (datum < ctx.heute) return skip(`${THEMA_LABEL[k.thema]}-Termin ${datumKurz(datum)} liegt in der Vergangenheit`)
    // Wechsel am selben Tag: Late Check-out → reist am Abreisetag jemand an? Check-in-Themen → reist am Anreisetag jemand ab?
    let q = supabaseAdmin.from('bookings').select('id').eq('listing_id', listing.id).eq('status', 'confirmed').neq('id', booking.id)
    q = k.thema === 'late_checkout' ? q.eq('check_in', datum) : q.eq('check_out', datum)
    const { data: wechsel, error: wErr } = await q.limit(1)
    plan = {
      source: 'reinigung_frage',
      titel: frageTitel(k.thema, vorname, listing.title, datum),
      titelPrefix: frageTitelPrefix(k.thema),
      beschreibung: frageBeschreibung({
        thema: k.thema, vorname, wohnung: listing.title, kanal: kanalLabel(booking.channel, booking.source),
        anreise: booking.check_in, abreise: booking.check_out, regulaerCheckin: regIn, regulaerCheckout: regOut,
        gewuenschteZeit: k.gewuenschte_zeit, wechselAmSelbenTag: wErr ? null : (wechsel?.length ?? 0) > 0,
        zitat, zeitpunkt: e.createdAt,
      }),
      listingId: listing.id,
      locationGroup: null,
      assignee: listing.cleaning_responsible ?? null,
      // zeitkritisch, wenn der Termin heute/morgen ist
      prio: datum <= plusTage(ctx.heute, 1) ? 'hoch' : 'mittel',
      dueDate: null, // Fragen dürfen den Early Check-in nie sperren
    }
  } else {
    if (!listing) return skip('Mangel ohne zuordenbare Wohnung')
    // Booking-Bewertung einer geteilten Unterkunft (§124): hängt an mehreren Wohnungen → Standort statt geratener Wohnung
    let listingIds = [listing.id]
    if (e.herkunft === 'bewertung' && e.portal && e.portalId) {
      const { data } = await supabaseAdmin.from('reviews').select('listing_id').eq('source', e.portal).eq('source_review_id', e.portalId).limit(20)
      const ids = [...new Set(((data ?? []) as { listing_id: string | null }[]).map((r) => r.listing_id).filter((x): x is string => !!x))]
      if (ids.length > 1) listingIds = ids
    }
    const gruppe = (listing.location_group ?? '').trim() || null
    const mehrere = listingIds.length > 1
    const verantwortliche = [...new Set(listingIds.map((id) => ctx.listings.get(id)?.cleaning_responsible ?? null))]
    let q = supabaseAdmin.from('bookings').select('check_in').in('listing_id', listingIds).eq('status', 'confirmed').gte('check_in', ctx.heute)
    if (booking) q = q.neq('id', booking.id)
    const { data: na } = await q.order('check_in', { ascending: true }).limit(1)
    const naechste = ((na ?? []) as { check_in: string }[])[0]?.check_in ?? null
    const gastImHaus = e.herkunft === 'chat' && !!booking && booking.check_in <= ctx.heute && ctx.heute < booking.check_out
    const wohnung = mehrere && gruppe ? `${gruppe} (Haus)` : listing.title
    plan = {
      source: 'reinigung_mangel',
      titel: mangelTitel(wohnung, k.zusammenfassung),
      titelPrefix: MANGEL_PREFIX,
      beschreibung: mangelBeschreibung({
        wohnung, herkunft: e.herkunft,
        kanal: e.herkunft === 'bewertung' ? bewertungsQuelleLabel(e.portal) : kanalLabel(booking?.channel, booking?.source),
        zeitpunkt: e.herkunft === 'bewertung' ? (e.bewertungsDatum ?? e.createdAt.slice(0, 10)) : e.createdAt,
        vorname: vorname === 'Gast' ? null : vorname,
        aufenthalt: booking && e.herkunft === 'chat' ? { anreise: booking.check_in, abreise: booking.check_out } : null,
        note: e.note, zitat, naechsteAnreise: naechste, gastImHaus, mehrereWohnungen: mehrere,
      }),
      listingId: mehrere && gruppe ? null : listing.id,
      locationGroup: mehrere && gruppe ? gruppe : null,
      // geteilte Unterkunft: nur zuweisen, wenn alle Wohnungen dieselbe Reinigungskraft haben
      assignee: mehrere ? (verantwortliche.length === 1 ? verantwortliche[0] : null) : listing.cleaning_responsible ?? null,
      prio: 'hoch',
      dueDate: naechste, // echte Arbeit vor der nächsten Anreise → darf den Early Check-in sperren
    }
  }

  // ── Dedupe 1: gleiche source_ref nie doppelt ──
  const { data: gleich, error: gErr } = await supabaseAdmin.from('tasks').select('id').eq('source_ref', e.ref).limit(1)
  if (gErr) throw new Error(`Dublettenprüfung fehlgeschlagen: ${gErr.message}`)
  if (gleich?.length) return { ...basis, ergebnis: 'doppelt', titel: plan.titel, grund: 'Aufgabe zu dieser Nachricht/Bewertung gibt es schon', aufgabeId: String(gleich[0].id) }

  // ── Dedupe 2: je Buchung + Thema höchstens eine offene Aufgabe binnen 24 h → ergänzen ──
  const threadKey = e.herkunft === 'chat' ? threadKeyFuer(e.bookingId, e.conversationId) : null
  if (ctx.dryRun && threadKey) {
    const vorher = ctx.geplant.find((x) => x.source === plan.source && x.titelPrefix === plan.titelPrefix && x.threadKey === threadKey)
    if (vorher) return { ...basis, ergebnis: 'ergaenzt', titel: vorher.titel, push: 'Probelauf — kein Push gesendet', grund: 'ergänzt die in diesem Probelauf geplante Aufgabe' }
  }
  const ziel = threadKey ? await findeZielAufgabe(plan, threadKey) : null
  if (ziel) {
    if (schonErfasst(e.ref, zitat, [ziel])) {
      return { ...basis, ergebnis: 'doppelt', titel: ziel.title, grund: 'steht schon in der offenen Aufgabe', aufgabeId: ziel.id }
    }
    const beschreibung = (String(ziel.description ?? '') + nachtragText(e.createdAt, zitat, k.gewuenschte_zeit)).slice(0, 4000)
    const an = await nameVon(ziel.assignee_id, ctx)
    if (ctx.dryRun) {
      return { ...basis, ergebnis: 'ergaenzt', titel: ziel.title, beschreibung, an, push: 'Probelauf — kein Push gesendet', aufgabeId: ziel.id }
    }
    const { error } = await supabaseAdmin.from('tasks').update({ description: beschreibung, updated_at: new Date().toISOString() }).eq('id', ziel.id)
    if (error) throw new Error(`Aufgabe nicht ergänzt: ${error.message}`)
    const push = await benachrichtige(ziel.assignee_id, ziel.title, `Nachtrag: ${pushText(k)}`, `/team?task=${ziel.id}`)
    return { ...basis, ergebnis: 'ergaenzt', titel: ziel.title, an, push, aufgabeId: ziel.id }
  }

  // ── Neue Aufgabe ──
  const an = await nameVon(plan.assignee, ctx)
  if (ctx.dryRun) {
    if (threadKey) ctx.geplant.push({ source: plan.source, titelPrefix: plan.titelPrefix, threadKey, titel: plan.titel })
    return {
      ...basis, ergebnis: 'angelegt', titel: plan.titel, beschreibung: plan.beschreibung, an,
      push: plan.assignee ? 'Push an die Reinigungskraft (Probelauf — nicht gesendet)' : 'Push ans Büro (Probelauf — nicht gesendet)',
    }
  }
  const { data: neu, error } = await supabaseAdmin.from('tasks').insert({
    title: plan.titel,
    description: plan.beschreibung,
    source: plan.source,
    source_ref: e.ref,
    listing_id: plan.listingId,
    location_group: plan.locationGroup,
    is_general: !plan.listingId && !plan.locationGroup,
    prio: plan.prio,
    status: 'offen',
    visibility: 'team',
    assignee_id: plan.assignee,
    due_date: plan.dueDate,
    created_by: null,
  }).select('id').single()
  if (error || !neu) throw new Error(`Aufgabe nicht angelegt: ${error?.message ?? 'unbekannt'}`)
  const id = String(neu.id)
  const push = await benachrichtige(plan.assignee, plan.titel, pushText(k), `/team?task=${id}`)
  return { ...basis, ergebnis: 'angelegt', titel: plan.titel, an, push, aufgabeId: id }
}

/** Offene Aufgabe derselben Buchung + desselben Themas (≤ 24 h), die ergänzt werden soll */
async function findeZielAufgabe(plan: Plan, threadKey: string): Promise<AufgabeZeile | null> {
  let q = supabaseAdmin.from('tasks')
    .select('id, title, description, source, status, created_at, source_ref, assignee_id')
    .eq('source', plan.source).in('status', ['offen', 'in_arbeit'])
    .gte('created_at', new Date(Date.now() - ZUSAMMENFUEHREN_MS).toISOString())
  if (plan.listingId) q = q.eq('listing_id', plan.listingId)
  const { data, error } = await q.limit(30)
  if (error) throw new Error(`Offene Aufgaben nicht ladbar: ${error.message}`)
  const rows = (data ?? []) as AufgabeZeile[]
  if (!rows.length) return null
  // Gast-Thread je Kandidat über die Nachricht in source_ref auflösen (msg:<id>)
  const msgIds = rows.map((r) => String(r.source_ref ?? '')).filter((s) => s.startsWith('msg:')).map((s) => s.slice(4))
  const threads = await threadKeysVonNachrichten(msgIds)
  const treffer = findeOffeneAufgabe(
    rows.map((r) => ({
      id: r.id, source: r.source, status: r.status, title: r.title, created_at: r.created_at,
      threadKey: String(r.source_ref ?? '').startsWith('msg:') ? threads.get(String(r.source_ref).slice(4)) ?? null : null,
    })),
    { source: plan.source, titelPrefix: plan.titelPrefix, threadKey },
    Date.now(),
  )
  return treffer ? rows.find((r) => r.id === treffer.id) ?? null : null
}

async function threadKeysVonNachrichten(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!ids.length) return out
  const { data, error } = await supabaseAdmin.from('messages').select('id, booking_id, conversation_id').in('id', ids.slice(0, 100))
  if (error) throw new Error(`Nachrichten nicht ladbar: ${error.message}`)
  const rows = (data ?? []) as { id: string; booking_id: string | null; conversation_id: string | null }[]
  // Direkt-Chat-Nachricht: Buchung der Unterhaltung (wie beim neuen Eintrag)
  const convIds = [...new Set(rows.filter((m) => !m.booking_id && m.conversation_id).map((m) => m.conversation_id as string))]
  const convBooking = new Map<string, string | null>()
  if (convIds.length) {
    const { data: cs } = await supabaseAdmin.from('conversations').select('id, booking_id').in('id', convIds)
    for (const c of (cs ?? []) as { id: string; booking_id: string | null }[]) convBooking.set(c.id, c.booking_id)
  }
  for (const m of rows) {
    const key = threadKeyFuer(m.booking_id ?? (m.conversation_id ? convBooking.get(m.conversation_id) ?? null : null), m.conversation_id)
    if (key) out.set(m.id, key)
  }
  return out
}

async function ladeBuchungen(ids: string[]): Promise<Map<string, BuchungZeile>> {
  const out = new Map<string, BuchungZeile>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabaseAdmin
      .from('bookings').select('id, listing_id, guest_name, check_in, check_out, status, channel, source').in('id', ids.slice(i, i + 100))
    if (error) throw new Error(`Buchungen nicht ladbar: ${error.message}`)
    for (const b of (data ?? []) as BuchungZeile[]) out.set(b.id, b)
  }
  return out
}

function listingVon(ctx: Kontext, booking: BuchungZeile | null, e: Eintrag): ListingZeile | null {
  return (booking?.listing_id ? ctx.listings.get(booking.listing_id) : undefined)
    ?? (e.listingId ? ctx.listings.get(e.listingId) : undefined)
    ?? null
}

function vornameVon(name: string | null | undefined): string {
  return String(name ?? '').trim().split(/\s+/)[0] || 'Gast'
}

/** „15:00:00" / „15:00" → „15:00"; sonst Standard */
function uhrzeit(v: string | null | undefined, standard: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v ?? '').trim())
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : standard
}

/** Deutsches Gast-Zitat: content_de (Live-Übersetzung) > deutsches Original > KI-Übersetzung > Original */
function zitatFuer(e: Eintrag, k: Klassifikation): string {
  if (e.herkunft === 'bewertung') return k.zitat_de || e.text
  if (e.textDe?.trim()) return e.textDe
  if (e.lang === 'de') return e.text
  return k.zitat_de || e.text
}

async function nameVon(id: string | null, ctx: Kontext): Promise<string> {
  if (!id) return 'Büro (keine Reinigungskraft hinterlegt)'
  const hit = ctx.namen.get(id)
  if (hit) return hit
  const { data } = await supabaseAdmin.from('profiles').select('display_name').eq('id', id).maybeSingle()
  const name = String((data as { display_name?: string | null } | null)?.display_name ?? '').trim() || 'Reinigungskraft'
  ctx.namen.set(id, name)
  return name
}

/** true = endgültig aufgegeben (nach MAX_FEHLVERSUCHE Läufen) — der Eintrag wird dann als geprüft vermerkt */
function zaehleFehlversuch(z: RoutingZustand, ref: string): boolean {
  const n = (z.fehlversuche[ref] ?? 0) + 1
  if (n >= MAX_FEHLVERSUCHE) {
    console.error('[reinigung-routing] gebe nach', n, 'Fehlversuchen auf:', ref)
    delete z.fehlversuche[ref]
    return true
  }
  z.fehlversuche[ref] = n
  return false
}

function mitZeitlimit<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Zeitlimit ${Math.round(ms / 1000)} s überschritten`)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (err) => { clearTimeout(t); reject(err) })
  })
}

/* ── Pushes ──────────────────────────────────────────────────────────────────── */

/**
 * Push an die Reinigungskraft (Kategorie 'tasks', Tap öffnet die Aufgabe). Erreicht er kein Gerät oder ist keine
 * Reinigungskraft hinterlegt → Push ans Büro. Rückgabe = lesbare Notiz fürs Lauf-Ergebnis.
 */
async function benachrichtige(assignee: string | null, titel: string, text: string, url: string): Promise<string> {
  const geraete = (n: number) => `${n} ${n === 1 ? 'Gerät' : 'Geräte'}`
  if (assignee) {
    const n = await sendPushToUser(assignee, titel, text, url, undefined, 'tasks')
      .catch((err) => { console.error('[reinigung-routing] Push an Reinigung:', err); return 0 })
    if (n > 0) return `Push an die Reinigungskraft (${geraete(n)})`
    const m = await pushAnsBuero(titel, `Reinigung per Push nicht erreichbar · ${text}`, url, { mitMitarbeitern: true })
    return `Reinigungskraft per Push nicht erreichbar → Büro (${geraete(m)})`
  }
  const m = await pushAnsBuero(titel, `Keine Reinigungskraft hinterlegt · ${text}`, url, { mitMitarbeitern: true })
  return `keine Reinigungskraft hinterlegt → Büro (${geraete(m)})`
}

/**
 * Push ans Büro: Admins/Gastgeber — mit mitMitarbeitern zusätzlich Mitarbeiter, sofern sie laut Aufgaben-Rechten
 * 'team'-Aufgaben sehen dürfen. Bewusst NICHT sendPushToTeam: das erreicht auch Dienstleister (andere
 * Reinigungsfirmen, Handwerker), die die Aufgabe nicht öffnen können und Gast-Details nicht sehen sollen.
 */
async function pushAnsBuero(titel: string, text: string, url: string, opts: { mitMitarbeitern?: boolean; ohne?: string } = {}): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('profiles').select('id, is_admin, is_host, is_staff').or('is_admin.eq.true,is_host.eq.true,is_staff.eq.true')
  if (error) { console.error('[reinigung-routing] Büro-Empfänger nicht ladbar:', error.message); return 0 }
  const mitStaff = opts.mitMitarbeitern ? (await getTaskPermissions()).staff.view === 'all' : false
  const ids = ((data ?? []) as { id: string; is_admin: boolean | null; is_host: boolean | null; is_staff: boolean | null }[])
    .filter((p) => (p.is_admin || p.is_host || (mitStaff && p.is_staff)) && p.id !== opts.ohne)
    .map((p) => p.id)
  const n = await Promise.all(ids.map((id) => sendPushToUser(id, titel, text, url, undefined, 'tasks').catch(() => 0)))
  return n.reduce((a, b) => a + b, 0)
}

/** Gast-Thread zur Nachricht in source_ref ('msg:<id>') → '/team?conv=<bookingId|conversationId>' */
export async function gastThreadUrl(sourceRef: string | null | undefined): Promise<string | null> {
  const ref = String(sourceRef ?? '')
  if (!ref.startsWith('msg:')) return null
  const { data } = await supabaseAdmin.from('messages').select('booking_id, conversation_id').eq('id', ref.slice(4)).maybeSingle()
  const m = data as { booking_id: string | null; conversation_id: string | null } | null
  const id = m?.booking_id ?? m?.conversation_id ?? null
  return id ? `/team?conv=${id}` : null
}

/**
 * Antwort-Rückweg: Die Reinigung hat eine weitergeleitete Aufgabe kommentiert → Push an Admins/Gastgeber (ohne den
 * Kommentierenden). Bei Fragen führt der Tap direkt in den Gast-Thread — dort antwortet das Team dem Gast.
 */
export async function meldeReinigungsAntwort(
  task: { id: string; title: string; source: string | null; source_ref?: string | null },
  kommentar: string,
  autorId: string,
): Promise<number> {
  if (!istReinigungsSource(task.source)) return 0
  const url = (task.source === 'reinigung_frage' ? await gastThreadUrl(task.source_ref) : null) ?? `/team?task=${task.id}`
  return pushAnsBuero(antwortPushTitel(task.title, task.source), kommentar, url, { ohne: autorId })
}

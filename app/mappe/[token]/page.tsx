import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { istInaktiveBuchung } from '@/lib/booking-status'
import { makeTr } from '@/lib/static-translate'
import { isUiLang, UI_LANG_META, type UiLang } from '@/lib/i18n'
import { REGIONS } from '@/lib/regions'
import { checkRateLimit } from '@/lib/rate-limit'
import { parseGuide, collectGuideTexts, translateBlocks, blockVisibleInPhase, blockForListing, blockHasContent, mergeContactIntoChat, DE_LABELS, type ChatBlock, type GuideCtx, type GuideLabels, type GuidePhase } from '@/lib/guide'
import { ensureDoorCode, getRevealDays } from '@/lib/locks'
import { guestLangFor } from '@/lib/auto-messages-engine'
import GuideBlocks from '@/components/guide/GuideBlocks'
import MappeChat from '@/components/guide/MappeChat'
import MappeInvoice, { type MappeInvoiceLabels, type MappeInvoiceRecipient } from '@/components/guide/MappeInvoice'
import { SEV_ENGINE_STICHTAG, previewSevRecipient } from '@/lib/sevdesk-engine'
import MappeNav, { type MappeNavItem } from '@/components/guide/MappeNav'
import MappeVerlaengern, { type MappeVerlaengernLabels, type MappeVerlaengerung } from '@/components/guide/MappeVerlaengern'

/**
 * 📖 Öffentliche Gästemappe — persönlicher, unguessbarer Link je Buchung
 * (/mappe/<portal_token>). Startsprache = Buchungssprache des Gasts,
 * umschaltbar über ?lang=. Nicht indexierbar (noindex + robots-Disallow).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120 // Erstübersetzung einer Sprache kann dauern

export const metadata: Metadata = { robots: { index: false, follow: false } }

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export default async function MappePage({ params, searchParams }: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ lang?: string; verlaengern?: string; verlaengert?: string }>
}) {
  const { token } = await params
  const { lang: langParam, verlaengern: verlParam, verlaengert: verlBezahlt } = await searchParams
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound()

  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  const allowed = await checkRateLimit(`mappe:${ip}`, 120, 3600)
  if (!allowed) notFound()

  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('*, listings(*), conversations(id, guest_id)')
    .eq('portal_token', token)
    .maybeSingle()
  // 'pending_payment' (Sofortbuchung, Zahlung läuft) hat zwar schon ein portal_token, ist aber noch keine Buchung
  if (!booking || istInaktiveBuchung(booking.status)) notFound()
  const listing = (Array.isArray(booking.listings) ? booking.listings[0] : booking.listings) as Record<string, unknown> | null
  if (!listing) notFound()

  // §163: Startsprache = KOMMUNIKATIONSSPRACHE des Gasts (gleiche Kette wie
  // Chat/Auto-Nachrichten: letzte erkannte Gast-Nachricht > guest_lang >
  // Telefon-Vorwahl > de); ?lang= übersteuert. Sprachen außerhalb des
  // Mappen-Angebots (it/es/…) fallen auf Englisch zurück.
  let lang: UiLang
  if (isUiLang(langParam ?? '')) {
    lang = langParam as UiLang
  } else {
    const convRaw = (booking as { conversations?: unknown }).conversations
    const conv = (Array.isArray(convRaw) ? convRaw[0] : convRaw) as { id: string; guest_id: string | null } | null
    const detected = await guestLangFor(
      { id: String(booking.id), guest_id: (booking.guest_id as string | null) ?? null, guest_lang: (booking.guest_lang as string | null) ?? null },
      conv?.id, conv?.guest_id,
    ).catch(() => 'de')
    lang = isUiLang(detected) ? (detected as UiLang) : detected !== 'de' ? 'en' : 'de'
  }

  // ── Hausregeln aus dem Inserat als lesbare Zeilen ──
  const rules: string[] = []
  if (listing.rule_quiet_hours) rules.push(`🌙 Ruhezeiten: ${listing.rule_quiet_start ?? '22:00'}–${listing.rule_quiet_end ?? '07:00'} Uhr`)
  rules.push(listing.rule_smoking_allowed ? '🚬 Rauchen erlaubt' : '🚭 Nichtraucher-Wohnung')
  rules.push(listing.rule_pets_allowed ? '🐾 Haustiere willkommen' : '🐾 Keine Haustiere')
  if (!listing.rule_events_allowed) rules.push('🎉 Keine Partys oder Veranstaltungen')
  const maxG = (listing.rule_max_guests ?? listing.max_guests) as number | null
  if (maxG) rules.push(`👥 Maximal ${maxG} Gäste`)
  if (typeof listing.rule_additional_rules === 'string' && listing.rule_additional_rules.trim()) {
    rules.push(`➕ ${listing.rule_additional_rules.trim()}`)
  }

  const region = Object.entries(REGIONS).find(([, r]) =>
    typeof listing.location === 'string' && listing.location.includes(r.locationMatch)
  )

  // ── 🧾 §266c: Rechnungs-Status für den Mappe-Abschnitt ──
  // sevdesk-Welt (Anreise ab Stichtag): Download sobald die Rechnung
  // existiert + Empfänger-Formular (vorher = Wunsch wird gespeichert).
  // Alt-Welt (lexoffice): nur Download, wenn eine Rechnung existiert.
  const istSevWelt = String(booking.check_in) >= SEV_ENGINE_STICHTAG
  let invoiceStatus: 'bereit' | 'kommt' | null = null
  let invoiceNumber: string | null = null
  let invoiceRecipient: MappeInvoiceRecipient | null = null
  let invoiceCanEdit = false
  try {
    if (istSevWelt) {
      const { data: inv } = await supabaseAdmin
        .from('sevdesk_invoices').select('sevdesk_id, invoice_number, status').eq('booking_id', booking.id).maybeSingle()
      if (inv?.sevdesk_id && inv.status !== 'storniert') {
        invoiceStatus = 'bereit'
        invoiceNumber = (inv.invoice_number as string | null) ?? null
        invoiceCanEdit = true
      } else {
        // §243ac-Randfall (Manuela-Marc-Klasse): Legacy-lexoffice-Rechnung
        // trotz sev-Welt — Download ja, Änderungen nur übers Team
        const { data: legacy } = await supabaseAdmin
          .from('lexoffice_invoices').select('lexoffice_id, voucher_number').eq('booking_id', booking.id).maybeSingle()
        if (legacy?.lexoffice_id) {
          invoiceStatus = 'bereit'
          invoiceNumber = (legacy.voucher_number as string | null) ?? null
        } else {
          invoiceStatus = 'kommt'
          invoiceCanEdit = true
        }
      }
      if (invoiceCanEdit) invoiceRecipient = await previewSevRecipient(String(booking.id))
    } else {
      const { data: inv } = await supabaseAdmin
        .from('lexoffice_invoices').select('lexoffice_id, voucher_number').eq('booking_id', booking.id).maybeSingle()
      if (inv?.lexoffice_id) {
        invoiceStatus = 'bereit'
        invoiceNumber = (inv?.voucher_number as string | null) ?? null
      }
      // Alt-Buchung ohne Rechnung → Abschnitt gar nicht zeigen
    }
  } catch (e) { console.error('[mappe] rechnung-status:', e) }

  // §150 Pool-Modell: Der gemeinsame Baustein-Pool (app_settings
  // 'guide_global') gewinnt, sobald er für DIESE Wohnung Bausteine enthält;
  // sonst greift weiter die alte Wohnungs-Mappe (sanfte Migration).
  const { data: poolRow } = await supabaseAdmin
    .from('app_settings').select('value').eq('key', 'guide_global').maybeSingle()
  const poolForListing = parseGuide(poolRow?.value)
    .filter((b) => blockForListing(b, String(booking.listing_id)))
  const blocksDe = poolForListing.length ? poolForListing : parseGuide(listing.guide)

  // ── Türcode-Automatik (§132): Code on-demand erzeugen, sobald das
  //    Anzeige-Fenster erreicht ist (deckt kurzfristige Buchungen ohne
  //    nächtlichen Cron-Lauf ab); vorher nur der Hinweis, ab wann er kommt ──
  let doorCode: string | null = null
  let doorNoteDe: string | null = null
  const locksArr = (listing.locks as { provider: string }[] | null) ?? []
  console.log('[mappe] door-check:', { booking: String(booking.id).slice(0, 8), locks: locksArr.length, checkIn: booking.check_in, checkOut: booking.check_out, status: booking.status })
  // §202/§203: Aufenthalts-Fenster mit Stunden-Puffer (Inhaber-Doktrin) —
  // „Während"-Inhalte ab PHASE_LEAD_H Stunden vor Check-in bis PHASE_TAIL_H
  // Stunden nach Check-out; der Türcode verschwindet mit demselben Ende.
  const PHASE_LEAD_H = 4
  const PHASE_TAIL_H = 4
  const berlinNow = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date())
  const shiftHours = (hhmm: string, delta: number) => {
    const [h, m] = hhmm.split(':').map(Number)
    const t = Math.min(Math.max((h || 0) + delta, 0), 23)
    return `${String(t).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`
  }
  const ciTime = String(listing.check_in_time ?? '16:00').slice(0, 5)
  const coTime = String(listing.check_out_time ?? '10:00').slice(0, 5)
  const stayStart = `${booking.check_in} ${shiftHours(ciTime, -PHASE_LEAD_H)}`
  const stayEnd = `${booking.check_out} ${shiftHours(coTime, PHASE_TAIL_H)}`
  const abgereist = berlinNow > stayEnd
  // §266c-Review: „wird am Anreisetag erstellt" wäre NACH der Abreise ohne
  // Rechnung dauerhaft falsch → Abschnitt dann ausblenden; und das
  // Empfänger-Formular endet 30 Tage nach Abreise (wie der Chat/die API).
  if (invoiceStatus === 'kommt' && abgereist) invoiceStatus = null
  {
    const editGrenze = new Date(String(booking.check_out) + 'T00:00:00Z')
    editGrenze.setUTCDate(editGrenze.getUTCDate() + 30)
    if (Date.now() > editGrenze.getTime()) invoiceCanEdit = false
  }
  if (locksArr.length && !abgereist) {
    const revealDays = await getRevealDays()
    const daysToArrival = Math.ceil((new Date(String(booking.check_in) + 'T00:00:00Z').getTime() - Date.now()) / 86400_000)
    console.log('[mappe] door-window:', { daysToArrival, revealDays, hatCode: !!booking.door_code })
    if (daysToArrival <= revealDays) {
      doorCode = (booking.door_code as string | null) ?? null
      if (!doorCode) {
        try { doorCode = await ensureDoorCode(String(booking.id)) } catch (e) { console.error('[mappe] door-code:', e) }
      }
      // §250: TTLock-Keypads (Minden UG) verlangen die Raute als Abschluss —
      // fürs Gast-Auge direkt an den Code hängen (nur ANZEIGE; der
      // gespeicherte door_code bleibt reine Ziffern).
      if (doorCode && locksArr.some((l) => l.provider === 'ttlock')) {
        doorCode = `${doorCode} #`
      }
      // 🧭 Service-Blueprint 14.10.: Code ließ sich (noch) nicht anlegen → Block nicht still verschwinden lassen,
      // sondern sagen, was los ist und wo es Hilfe gibt (das Team bekommt parallel einen Push vom Auto-Nachrichten-Lauf)
      if (!doorCode) doorNoteDe = 'Dein Türcode wird gerade vorbereitet. Steht er bis zur Anreise nicht hier, schreib uns bitte im Chat – wir helfen sofort.'
    } else {
      doorNoteDe = `Dein Türcode erscheint hier ${revealDays} Tage vor Anreise.`
    }
  }

  // 🌙 Verlängerung (Pascal 6.10., lib/zahlungen.ts): Angebot nur bis zur Abreise und nur für Wohnungen mit
  // Smoobu-Anbindung; bestehende Verlängerungen samt eigenem Türcode der Zusatzbuchung immer zeigen
  const verlMoeglich = !abgereist && booking.status === 'confirmed' && !!listing.smoobu_id
  const verlBestehend: MappeVerlaengerung[] = []
  try {
    const { verlaengerungenVon } = await import('@/lib/zahlungen')
    for (const v of await verlaengerungenVon(String(booking.id))) {
      let code: string | null = null
      if (v.extId) {
        const { data: ext } = await supabaseAdmin.from('bookings').select('door_code, status').eq('id', v.extId).maybeSingle()
        if (ext && ext.status !== 'cancelled') {
          code = (ext.door_code as string | null) ?? null
          if (!code && locksArr.length) { try { code = await ensureDoorCode(v.extId) } catch (e) { console.error('[mappe] verl-code:', e) } }
          // TTLock-Keypads verlangen die Raute als Abschluss (nur Anzeige, wie beim Haupt-Code)
          if (code && locksArr.some((l) => l.provider === 'ttlock')) code = `${code} #`
          verlBestehend.push({ von: v.von, bis: v.bis, doorCode: code })
        }
      }
    }
  } catch (e) { console.error('[mappe] verlaengerungen:', e) }
  // 🧾 Weitere Rechnungen: bezahlte Zahllinks (Extras) und Verlängerungen (eigene Zusatzbuchung, Rechnung ab deren Start)
  const weitereRechnungen: { href: string; label: string; nummer: string | null }[] = []
  try {
    const { listeZahllinks, verlaengerungenVon } = await import('@/lib/zahlungen')
    for (const z of await listeZahllinks(String(booking.id))) {
      if (z.status === 'bezahlt' && z.rechnung?.sevdeskId) weitereRechnungen.push({ href: `/api/rechnung/${token}?zusatz=${encodeURIComponent(z.id)}`, label: `${z.zweck} (${z.betrag.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €)`, nummer: z.rechnung.number ?? null })
    }
    for (const v of await verlaengerungenVon(String(booking.id))) {
      if (!v.extId) continue
      const [{ data: ext }, { data: inv }] = await Promise.all([
        supabaseAdmin.from('bookings').select('portal_token, status').eq('id', v.extId).maybeSingle(),
        supabaseAdmin.from('sevdesk_invoices').select('sevdesk_id, invoice_number').eq('booking_id', v.extId).maybeSingle(),
      ])
      if (ext?.portal_token && ext.status !== 'cancelled' && inv?.sevdesk_id) {
        weitereRechnungen.push({ href: `/api/rechnung/${ext.portal_token}`, label: `VERL:${fmtDate(v.von)}–${fmtDate(v.bis)}`, nummer: (inv.invoice_number as string | null) ?? null })
      }
    }
  } catch (e) { console.error('[mappe] weitere Rechnungen:', e) }

  const verlStartRoh = Number(verlParam)
  const verlStart = Number.isFinite(verlStartRoh) && verlStartRoh >= 1 ? Math.min(14, Math.round(verlStartRoh)) : null
  const verlZeigen = verlMoeglich || verlBestehend.length > 0 || verlBezahlt === '1'

  // Hat die Mappe (noch) keinen door-Block, wird er bei aktiver Türcode-
  // Automatik SYNTHETISCH eingefügt — sonst hätte der Code keinen Platz zum
  // Erscheinen (auch bei komplett leerer Mappe bekommt der Gast so den Code)
  let blocksAll = blocksDe
  if ((doorCode || doorNoteDe) && !blocksDe.some((b) => b.type === 'door')) {
    let idx = -1
    for (const t of ['steps', 'map', 'times'] as const) {
      const i = blocksDe.findIndex((b) => b.type === t)
      if (i >= 0) { idx = i + 1; break }
    }
    if (idx < 0) idx = Math.min(1, blocksDe.length)
    blocksAll = [
      ...blocksDe.slice(0, idx),
      { id: 'auto-door', type: 'door' as const, title: 'Türcode', text: '' },
      ...blocksDe.slice(idx),
    ]
  }

  const ctxDe: GuideCtx = {
    listingTitle: String(listing.title ?? ''),
    address: (listing.address as string | null) ?? null,
    lat: (listing.latitude as number | null) ?? null,
    lon: (listing.longitude as number | null) ?? null,
    checkIn: (listing.check_in_time as string | null) ?? null,
    checkOut: (listing.check_out_time as string | null) ?? null,
    rules,
    regionName: region ? region[1].name : null,
    regionSlug: region ? region[0] : null,
    regionClaim: region ? region[1].claim : null,
    doorCode,
    doorNote: doorNoteDe,
    googlePlaceId: (listing.google_place_id as string | null) ?? null,
  }

  // ── Übersetzung (Blöcke + Labels + UI + Hausregeln) in einem Batch ──
  const UI_DE = {
    hallo: 'Hallo', deinAufenthalt: 'Dein Zuhause auf Zeit:', zeitraum: 'Zeitraum',
    untitled: 'Deine Gästemappe', fallback: 'Der Gastgeber hat diese Mappe noch nicht befüllt — bei Fragen melde dich gern direkt.',
  }
  const CHAT_DE = {
    title: 'Nachricht an dein Gastgeber-Team',
    hint: 'Schreib uns direkt hier — deine Nachricht landet sofort bei uns im Team und wir antworten so schnell wie möglich.',
    placeholder: 'Deine Nachricht…',
    send: 'Senden',
    empty: 'Noch keine Nachrichten — schreib uns einfach!',
    contactTitle: 'Kontakt',
    navLabel: 'Kontakt & Chat',
  }
  const WEITERE_DE = { titel: 'Weitere Rechnungen', verlaengerung: 'Verlängerung', ansehen: 'ansehen (PDF)' }
  // 🌙 Verlängerung (Pascal 6.10.) — {n}/{datum} sind Platzhalter, die die Übersetzung stehen lässt
  const VERL_DE: MappeVerlaengernLabels = {
    navLabel: 'Verlängern',
    title: 'Aufenthalt verlängern',
    hint: 'Du möchtest länger bleiben? Wähle die Zahl der Nächte — wir prüfen sofort, ob die Wohnung frei ist, und du kannst direkt bezahlen.',
    nights1: '{n} Nacht',
    nightsN: '{n} Nächte',
    check: 'Verfügbarkeit und Preis prüfen',
    free: 'Frei:',
    price: 'Preis:',
    pay: 'Jetzt verlängern und bezahlen',
    busy: 'Einen Moment…',
    taken: 'Leider ist die Wohnung in diesem Zeitraum schon belegt. Schreib uns gern im Chat — vielleicht finden wir eine andere Lösung.',
    error: 'Das hat gerade nicht geklappt — bitte versuche es noch einmal oder schreib uns im Chat.',
    paidTitle: 'Danke — deine Zahlung ist eingegangen!',
    paidHint: 'Wir tragen die Verlängerung gerade ein. Dein Türcode für die zusätzlichen Nächte erscheint gleich hier.',
    extendedUntil: 'Verlängert bis {datum}',
    newCode: 'Dein Türcode ab {datum}:',
    newCodeLater: 'Dein Türcode für die zusätzlichen Nächte erscheint hier rechtzeitig.',
  }
  const INV_DE: MappeInvoiceLabels = {
    navLabel: 'Rechnung',
    titleReady: 'Deine Rechnung',
    titleUpcoming: 'Deine Rechnung',
    hintReady: 'Deine Rechnung liegt bereit — du kannst sie jederzeit als PDF ansehen und speichern.',
    hintUpcoming: 'Deine Rechnung wird am Anreisetag automatisch erstellt und erscheint dann hier. Brauchst du sie auf eine Firma oder eine bestimmte Anschrift? Dann leg den Empfänger gern schon jetzt fest.',
    download: 'Rechnung ansehen (PDF)',
    editRecipient: 'Rechnungsempfänger anpassen',
    name: 'Name / Firma',
    supplement: 'Zusatz (z. B. Ansprechpartner)',
    street: 'Straße und Hausnummer',
    zip: 'PLZ',
    city: 'Ort',
    country: 'Land',
    save: 'Übernehmen',
    savedStored: 'Gespeichert — deine Rechnung wird mit diesen Angaben erstellt.',
    savedUpdated: 'Deine Rechnung wurde aktualisiert — das PDF zeigt sofort die neue Fassung.',
    legacyHint: 'Du brauchst eine Änderung an dieser Rechnung? Schreib uns kurz über den Chat — wir kümmern uns.',
  }
  let blocks = blocksAll
  let ctx = ctxDe
  let labels: GuideLabels = DE_LABELS
  let ui = UI_DE
  let chatLabels = CHAT_DE
  let invLabels = INV_DE
  let verlLabels = VERL_DE
  let weitereLabels = WEITERE_DE
  if (lang !== 'de') {
    const tr = await makeTr(lang, [
      ...collectGuideTexts(blocksAll), ...rules,
      ...Object.values(DE_LABELS), ...Object.values(UI_DE), ...Object.values(CHAT_DE), ...Object.values(INV_DE), ...Object.values(VERL_DE), ...Object.values(WEITERE_DE),
      ctxDe.regionClaim ?? '', ctxDe.doorNote ?? '',
    ])
    blocks = translateBlocks(blocksAll, tr)
    ctx = {
      ...ctxDe, rules: rules.map(tr),
      regionClaim: ctxDe.regionClaim ? tr(ctxDe.regionClaim) : null,
      doorNote: ctxDe.doorNote ? tr(ctxDe.doorNote) : null,
    }
    labels = Object.fromEntries(Object.entries(DE_LABELS).map(([k, v]) => [k, tr(v)])) as unknown as GuideLabels
    ui = Object.fromEntries(Object.entries(UI_DE).map(([k, v]) => [k, tr(v)])) as typeof UI_DE
    chatLabels = Object.fromEntries(Object.entries(CHAT_DE).map(([k, v]) => [k, tr(v)])) as typeof CHAT_DE
    invLabels = Object.fromEntries(Object.entries(INV_DE).map(([k, v]) => [k, tr(v)])) as unknown as MappeInvoiceLabels
    verlLabels = Object.fromEntries(Object.entries(VERL_DE).map(([k, v]) => [k, tr(v)])) as unknown as MappeVerlaengernLabels
    weitereLabels = Object.fromEntries(Object.entries(WEITERE_DE).map(([k, v]) => [k, tr(v)])) as typeof WEITERE_DE
  }

  // §136: Bausteine nach Aufenthalts-Phase + Mindest-Nächten filtern —
  // z. B. Check-in-Anleitung nur vor/bei Anreise, Danke-Block erst danach
  const nights = Math.max(1, Math.round(
    (new Date(String(booking.check_out) + 'T00:00:00Z').getTime() - new Date(String(booking.check_in) + 'T00:00:00Z').getTime()) / 86400_000,
  ))
  const guidePhase: GuidePhase = berlinNow < stayStart ? 'vor' : berlinNow <= stayEnd ? 'waehrend' : 'nach'
  blocks = blocks.filter((b) => blockVisibleInPhase(b, guidePhase, nights))

  // §166: Kontakt + Chat = EIN Punkt „Kontakt & Chat" (geteilte Logik mit
  // der Builder-Vorschau) — Telefon/Hinweis wandern in den chat-Block
  blocks = mergeContactIntoChat(blocks)
  const chatBlock = blocks.find((b): b is ChatBlock => b.type === 'chat')

  const firstName = String(booking.guest_name ?? '').trim().split(/\s+/)[0] || null
  const range = `${fmtDate(booking.check_in)} – ${fmtDate(booking.check_out)}`

  // §154 Sprung-Navigation: Chips aus den sichtbaren Bausteinen (Labels sind
  // bereits übersetzt) + fester Chat-Anker am Ende
  const navItems: MappeNavItem[] = []
  for (const b of blocks) {
    if (!blockHasContent(b, ctx)) continue
    const anchor = `mb-${b.id}`
    switch (b.type) {
      case 'heading': if (b.text.trim()) navItems.push({ id: anchor, label: b.text.trim() }); break
      case 'steps': if (b.title.trim()) navItems.push({ id: anchor, label: b.title.trim(), icon: '📋' }); break
      case 'info': if (b.title.trim()) navItems.push({ id: anchor, label: b.title.trim(), icon: b.emoji || 'ℹ️' }); break
      case 'wifi': navItems.push({ id: anchor, label: labels.wifi, icon: '📶' }); break
      case 'door': navItems.push({ id: anchor, label: b.title.trim() || labels.doorCodeLabel, icon: '🔑' }); break
      case 'map': navItems.push({ id: anchor, label: labels.addressTitle, icon: '📍' }); break
      case 'rules': navItems.push({ id: anchor, label: labels.rulesTitle, icon: '🏠' }); break
      case 'region': navItems.push({ id: anchor, label: labels.regionTitle, icon: '🗺️' }); break
      case 'inventar': if (b.title.trim()) navItems.push({ id: anchor, label: b.title.trim(), icon: '📦' }); break
      case 'review': navItems.push({ id: anchor, label: b.title.trim() || labels.reviewTitle, icon: '⭐' }); break
      case 'chat': navItems.push({ id: 'mb-chat', label: chatLabels.navLabel, icon: '💬' }); break
      default: break // text/warning/times/image ohne eigenen Chip
    }
  }
  if (verlZeigen) navItems.push({ id: 'verlaengern', label: verlLabels.navLabel, icon: '🌙' })
  if (invoiceStatus || weitereRechnungen.length) navItems.push({ id: 'mb-rechnung', label: invLabels.navLabel, icon: '🧾' })
  const hasChatBlock = blocks.some((b) => b.type === 'chat')
  if (!hasChatBlock) navItems.push({ id: 'mb-chat', label: chatLabels.navLabel, icon: '💬' })

  // §163: Chat-Baustein bestimmt die Position des echten Chats — die Block-
  // Liste wird am chat-Block gesplittet und der Chat dazwischen gerendert
  const chatIdx = blocks.findIndex((b) => b.type === 'chat')
  const blocksBefore = chatIdx >= 0 ? blocks.slice(0, chatIdx) : blocks
  const blocksAfter = chatIdx >= 0 ? blocks.slice(chatIdx + 1) : []
  const hasRealContent = blocks.some((b) => b.type !== 'chat')

  return (
    <div style={{ minHeight: '100vh', background: '#F5F3EE', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      {/* Kopf */}
      <div style={{ background: 'linear-gradient(160deg, #12222E 0%, #172A22 100%)', padding: '34px 20px 28px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          {/* §150: echtes Logo — §154: beide Maße auto + nur max-Grenzen,
              sonst verzerrt maxWidth bei fixer Höhe das Seitenverhältnis */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="TRIMOSA Apartments & Homes" style={{ maxHeight: 44, maxWidth: '65%', width: 'auto', height: 'auto', display: 'block', marginBottom: 16 }} />
          <h1 style={{ margin: '0 0 6px', fontSize: 25, fontWeight: 800, color: '#F5F0E8', letterSpacing: '-0.3px' }}>
            {firstName ? `${ui.hallo} ${firstName}! 👋` : ui.untitled}
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: 'rgba(245,240,232,0.75)', lineHeight: 1.6 }}>
            {ui.deinAufenthalt} <strong style={{ color: '#E3C878' }}>{ctx.listingTitle}</strong>
            <span style={{ display: 'block', fontSize: 12.5, color: 'rgba(245,240,232,0.55)', marginTop: 2 }}>{ui.zeitraum}: {range}</span>
          </p>
          {/* Sprachwahl */}
          <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
            {(Object.keys(UI_LANG_META) as UiLang[]).map((l) => (
              <a key={l} href={`?lang=${l}`} style={{
                padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, textDecoration: 'none',
                background: l === lang ? 'var(--gold, #AE8D2D)' : 'rgba(245,240,232,0.12)',
                color: l === lang ? '#fff' : 'rgba(245,240,232,0.75)',
              }}>{UI_LANG_META[l].flag} {l.toUpperCase()}</a>
            ))}
          </div>
        </div>
      </div>

      {/* §154: Sprung-Navigation (sticky, Scroll-Spy) */}
      <MappeNav items={navItems} />

      {/* Inhalt */}
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '22px 16px 48px' }}>
        {hasRealContent
          ? <GuideBlocks blocks={blocksBefore} ctx={ctx} labels={labels} />
          : <p style={{ fontSize: 14, color: '#8A8065', lineHeight: 1.7 }}>{ui.fallback}</p>}
        {/* 🌙 Aufenthalt verlängern (Pascal 6.10.) — Zahlung per Stripe, Zusatznächte als eigene Buchung */}
        {verlZeigen && (
          <div id="verlaengern" style={{ scrollMarginTop: 70, margin: '14px 0' }}>
            <MappeVerlaengern
              token={token}
              lang={lang}
              labels={verlLabels}
              startNaechte={verlStart}
              bezahlt={verlBezahlt === '1'}
              bestehende={verlBestehend}
              moeglich={verlMoeglich}
            />
          </div>
        )}
        {/* 🧾 §266c: Rechnung — Download + Empfänger-Anpassung durch den Gast */}
        {invoiceStatus && (
          <div id="mb-rechnung" style={{ scrollMarginTop: 70, margin: '14px 0' }}>
            <MappeInvoice
              token={token}
              labels={invLabels}
              status={invoiceStatus}
              invoiceNumber={invoiceNumber}
              initial={invoiceRecipient}
              canEdit={invoiceCanEdit}
            />
          </div>
        )}
        {weitereRechnungen.length > 0 && (
          <div id={invoiceStatus ? undefined : 'mb-rechnung'} style={{ scrollMarginTop: 70, margin: '14px 0', background: '#fff', borderRadius: 16, padding: '16px 18px', boxShadow: '0 1px 4px rgba(35,28,10,0.06)' }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: '#2A2620', marginBottom: 8 }}>🧾 {weitereLabels.titel}</div>
            {weitereRechnungen.map((r) => (
              <a key={r.href} href={r.href} target="_blank" rel="noreferrer" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid #F0EBDF', textDecoration: 'none', fontSize: 14, color: '#2A2620' }}>
                <span>{r.label.startsWith('VERL:') ? `${weitereLabels.verlaengerung} ${r.label.slice(5)}` : r.label}{r.nummer ? <span style={{ color: '#8A8065' }}> · {r.nummer}</span> : null}</span>
                <span style={{ color: 'var(--gold, #AE8D2D)', fontWeight: 700, whiteSpace: 'nowrap' }}>{weitereLabels.ansehen}</span>
              </a>
            ))}
          </div>
        )}
        {/* 💬 Direkter Draht zum Team (§136) — Position folgt dem chat-Baustein (§163) */}
        <div id="mb-chat" style={{ scrollMarginTop: 70, margin: '14px 0' }}>
          <MappeChat token={token} labels={chatLabels} lang={lang} phone={chatBlock?.phone || null} note={chatBlock?.note || null} />
        </div>
        {blocksAfter.length > 0 && <GuideBlocks blocks={blocksAfter} ctx={ctx} labels={labels} />}
        <p style={{ margin: '34px 0 0', textAlign: 'center', fontSize: 11, color: '#B0A793' }}>
          TRIMOSA Apartments &amp; Homes · trimosa.de
        </p>
      </div>
    </div>
  )
}

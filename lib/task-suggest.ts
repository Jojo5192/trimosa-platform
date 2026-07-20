/**
 * 🤖 KI-Aufgabenvorschläge (Team-App Phase 3): analysiert NEUE Gastnachrichten
 * (Buchungs- + Direkt-Chat) und NEUE Bewertungen seit dem letzten Lauf und
 * erzeugt Aufgaben mit status='vorschlag' (sichtbar nur für Admins, die sie in
 * der Vorschläge-Inbox annehmen/verwerfen). Cursor in app_settings, Prompt im
 * Prompt-Studio editierbar ('task_suggest'). Läuft täglich per Cron + manuell.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { askClaude } from '@/lib/ai'
import { getPrompt } from '@/lib/prompts'
import { sendPushToUser } from '@/lib/push'

const CURSOR_KEY = 'task_ai_cursor'
const MAX_MESSAGES = 250
const MAX_REVIEWS = 100

interface Suggestion { titel: string; beschreibung: string; wohnung: string | null; prio: string; quelle: string }
export interface SuggestSummary { nachrichten: number; bewertungen: number; vorschlaege: number; note?: string }

async function getCursor(): Promise<string> {
  try {
    const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', CURSOR_KEY).maybeSingle()
    const since = (data?.value as { since?: string } | undefined)?.since
    if (since) return since
  } catch { /* Tabelle fehlt → Default */ }
  return new Date(Date.now() - 7 * 86400_000).toISOString()
}

async function setCursor(since: string): Promise<void> {
  await supabaseAdmin.from('app_settings').upsert({ key: CURSOR_KEY, value: { since }, updated_at: new Date().toISOString() })
}

/**
 * JSON-Array robust parsen — wird die Antwort trotz Budget am Token-Limit
 * abgeschnitten, retten wir alle VOLLSTÄNDIGEN Einträge bis zum letzten '}'.
 */
function parseSuggestions(raw: string): Suggestion[] {
  const start = raw.indexOf('[')
  if (start === -1) throw new Error('Keine JSON-Antwort: ' + raw.slice(0, 150))
  const end = raw.lastIndexOf(']')
  if (end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)) as Suggestion[] } catch { /* weiter zum Rettungspfad */ }
  }
  const lastObj = raw.lastIndexOf('}')
  if (lastObj > start) {
    try { return JSON.parse(raw.slice(start, lastObj + 1) + ']') as Suggestion[] } catch { /* unten werfen */ }
  }
  throw new Error('JSON nicht parsebar (Antwort-Ende): …' + raw.slice(-150))
}

/** sinceDaysOverride: Zeitraum erzwingen (z. B. 42 = 6-Wochen-Backfill) statt Cursor. */
export async function runTaskSuggest(sinceDaysOverride?: number): Promise<SuggestSummary> {
  const since = sinceDaysOverride
    ? new Date(Date.now() - sinceDaysOverride * 86400_000).toISOString()
    : await getCursor()
  const runStart = new Date().toISOString()

  const { data: listingRows } = await supabaseAdmin.from('listings').select('id, title, location_group')
  const listingByTitle = new Map((listingRows ?? []).map((l) => [String(l.title).toLowerCase(), l.id]))
  const listingTitle = new Map((listingRows ?? []).map((l) => [l.id, String(l.title)]))
  const listingGroup = new Map((listingRows ?? []).map((l) => [l.id, (l.location_group ?? '').trim() || null]))
  const knownGroups = new Set((listingRows ?? []).map((l) => (l.location_group ?? '').trim().toLowerCase()).filter(Boolean))

  // ── Neue Gastnachrichten (Buchungs-Welt: Airbnb/Booking/… via Smoobu) ──
  const { data: bookingMsgs } = await supabaseAdmin
    .from('messages')
    .select('content, content_de, created_at, booking_id')
    .eq('sender_type', 'guest')
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES)
  const bookingIds = [...new Set((bookingMsgs ?? []).map((m) => m.booking_id).filter(Boolean))] as string[]
  const bookingListing = new Map<string, string>()
  if (bookingIds.length) {
    const { data: bks } = await supabaseAdmin.from('bookings').select('id, listing_id').in('id', bookingIds)
    for (const b of bks ?? []) if (b.listing_id) bookingListing.set(b.id, b.listing_id)
  }

  // ── Neue Direkt-Chat-Nachrichten von Website-Gästen ──
  const { data: directMsgs } = await supabaseAdmin
    .from('messages')
    .select('content, content_de, created_at, sender_id, conversation_id')
    .not('conversation_id', 'is', null)
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_MESSAGES)
  const convIds = [...new Set((directMsgs ?? []).map((m) => m.conversation_id).filter(Boolean))] as string[]
  const convGuest = new Map<string, { guestId: string | null; listingId: string | null }>()
  if (convIds.length) {
    const { data: convs } = await supabaseAdmin
      .from('conversations').select('id, guest_id, bookings(listing_id)').in('id', convIds)
    for (const c of convs ?? []) {
      const b = c.bookings as { listing_id?: string } | { listing_id?: string }[] | null
      const listingId = (Array.isArray(b) ? b[0]?.listing_id : b?.listing_id) ?? null
      convGuest.set(c.id, { guestId: c.guest_id ?? null, listingId })
    }
  }

  type Item = { text: string; listingId: string | null }
  const messages: Item[] = []
  for (const m of bookingMsgs ?? []) {
    const text = (m.content_de || m.content || '').trim()
    if (text.length >= 25) messages.push({ text, listingId: m.booking_id ? bookingListing.get(m.booking_id) ?? null : null })
  }
  for (const m of directMsgs ?? []) {
    const meta = m.conversation_id ? convGuest.get(m.conversation_id) : null
    if (!meta || !m.sender_id || m.sender_id !== meta.guestId) continue // nur GAST-Nachrichten
    const text = (m.content_de || m.content || '').trim()
    if (text.length >= 25) messages.push({ text, listingId: meta.listingId })
  }

  // ── Neue Bewertungen ──
  const { data: reviewRows } = await supabaseAdmin
    .from('reviews')
    .select('review_text, rating, listing_id, source, source_review_id, created_at')
    .gt('created_at', since)
    .not('review_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(MAX_REVIEWS)
  // Property-Dubletten deduplizieren (§124): Booking-Reviews geteilter
  // Properties hängen an MEHREREN Listings — hier nur EINMAL zählen und dem
  // STANDORT zuschreiben statt einer (womöglich falschen) Wohnung.
  const rawReviews = (reviewRows ?? []).filter((r) => String(r.review_text).trim().length >= 25)
  // Property-Zugehörigkeit gegen die GESAMTE Tabelle prüfen (nicht nur das
  // created_at-Fenster!) — re-importierte Kopien einer geteilten Property
  // sähen sonst wie eindeutige Wohnungs-Reviews aus (§126-Nachtcron-Vorfall)
  const seenRid = new Map<string, { listing_ids: Set<string> }>()
  const ridList = [...new Set(rawReviews.map((r) => r.source_review_id).filter(Boolean))] as string[]
  if (ridList.length) {
    const { data: allRows } = await supabaseAdmin
      .from('reviews')
      .select('source, source_review_id, listing_id')
      .in('source_review_id', ridList)
      .limit(2000)
    for (const r of allRows ?? []) {
      if (!r.source_review_id) continue
      const k = `${r.source}|${r.source_review_id}`
      const e = seenRid.get(k) ?? { listing_ids: new Set<string>() }
      if (r.listing_id) e.listing_ids.add(r.listing_id)
      seenRid.set(k, e)
    }
  }
  const emitted = new Set<string>()
  const reviews: { review_text: unknown; rating: unknown; source: string; label: string }[] = []
  for (const r of rawReviews) {
    const k = r.source_review_id ? `${r.source}|${r.source_review_id}` : null
    if (k && emitted.has(k)) continue
    if (k) emitted.add(k)
    const shared = k ? (seenRid.get(k)?.listing_ids.size ?? 0) > 1 : false
    const label = shared
      ? `${(r.listing_id && listingGroup.get(r.listing_id)) || 'Standort'} (mehrere Wohnungen möglich)`
      : (r.listing_id ? listingTitle.get(r.listing_id) ?? 'unbekannt' : 'unbekannt')
    reviews.push({ review_text: r.review_text, rating: r.rating, source: r.source, label })
  }

  if (messages.length === 0 && reviews.length === 0) {
    await setCursor(runStart)
    return { nachrichten: 0, bewertungen: 0, vorschlaege: 0, note: 'Nichts Neues seit dem letzten Lauf.' }
  }

  // ── Bereits erfasste Aufgaben (Dedupe-Kontext für die KI) ──
  const { data: existing } = await supabaseAdmin
    .from('tasks').select('title').in('status', ['vorschlag', 'offen', 'in_arbeit']).limit(200)
  const existingTitles = (existing ?? []).map((t) => String(t.title))

  const user = [
    'WOHNUNGEN: ' + (listingRows ?? []).map((l) => l.title).join(' | '),
    '',
    'BEREITS ERFASST (nicht erneut vorschlagen):',
    existingTitles.length ? existingTitles.map((t) => `- ${t}`).join('\n') : '- (keine)',
    '',
    'GASTNACHRICHTEN:',
    messages.length
      ? messages.map((m) => `[${m.listingId ? listingTitle.get(m.listingId) ?? 'unbekannt' : 'unbekannt'}] "${m.text.slice(0, 600)}"`).join('\n')
      : '(keine)',
    '',
    'BEWERTUNGEN:',
    reviews.length
      ? reviews.map((r) => `[${r.label} · ${r.source} · ${r.rating}/5] "${String(r.review_text).slice(0, 800)}"`).join('\n')
      : '(keine)',
    '',
    'HINWEIS: Bei "[<Standort> (mehrere Wohnungen möglich)]" ist die konkrete',
    'Wohnung NICHT bekannt — gib dann als wohnung den STANDORT-Namen an',
    '(z. B. "Sirzenich" oder "Minden"), NIE eine geratene Wohnung.',
  ].join('\n')

  const system = await getPrompt('task_suggest')
  // Großzügiges Budget: Sonnet nutzt einen Teil als Denkbudget (§45-Lektion),
  // und lange Antworten dürfen nicht mitten im JSON abreißen.
  const raw = await askClaude(system, user, 20000)
  const suggestions = parseSuggestions(raw)

  // ── Vorschläge anlegen (mit DB-seitigem Titel-Dedupe) ──
  const existingLower = new Set(existingTitles.map((t) => t.toLowerCase()))
  let created = 0
  for (const s of suggestions) {
    const title = String(s.titel ?? '').trim().slice(0, 200)
    if (!title || existingLower.has(title.toLowerCase())) continue
    const wohnungRaw = String(s.wohnung ?? '').trim().toLowerCase()
    const listingId = wohnungRaw ? listingByTitle.get(wohnungRaw) ?? null : null
    // Standort-Zuordnung (§124): „Sirzenich"/„Minden" statt geratener Wohnung
    const groupName = !listingId && wohnungRaw && knownGroups.has(wohnungRaw)
      ? (listingRows ?? []).find((l) => (l.location_group ?? '').trim().toLowerCase() === wohnungRaw)?.location_group ?? null
      : null
    const { error } = await supabaseAdmin.from('tasks').insert({
      title,
      description: String(s.beschreibung ?? '').trim().slice(0, 2000),
      source: s.quelle === 'bewertung' ? 'ki_bewertung' : 'ki_nachricht',
      listing_id: listingId,
      location_group: groupName,
      is_general: !listingId && !groupName,
      prio: ['hoch', 'mittel', 'niedrig'].includes(s.prio) ? s.prio : 'mittel',
      status: 'vorschlag',
      visibility: 'admin',
    })
    if (!error) { created++; existingLower.add(title.toLowerCase()) }
  }

  await setCursor(runStart)

  // ── Admins/Gastgeber benachrichtigen ──
  if (created > 0) {
    const { data: admins } = await supabaseAdmin
      .from('profiles').select('id').or('is_admin.eq.true,is_host.eq.true')
    await Promise.all((admins ?? []).map((a) =>
      sendPushToUser(a.id, '🤖 Neue Aufgaben-Vorschläge', `${created} Vorschläge aus Gastnachrichten & Bewertungen`, '/team?tab=aufgaben')
        .catch(() => {})
    ))
  }

  return { nachrichten: messages.length, bewertungen: reviews.length, vorschlaege: created }
}

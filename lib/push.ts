/**
 * Team web push (chat PWA). Sends a notification to every subscribed team
 * device; dead subscriptions (410/404) are pruned automatically. Requires
 * VAPID_PRIVATE_KEY + NEXT_PUBLIC_VAPID_PUBLIC_KEY in the environment.
 */
import webpush from 'web-push'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * 🔔 §254: Alle steuerbaren Benachrichtigungs-Kategorien. Präferenzen liegen
 * in profiles.push_prefs (jsonb) — je Kategorie wird NUR der AUS-Zustand
 * gespeichert (Default = an). Eine neue Kategorie hier ergänzen genügt;
 * keine Migration nötig.
 */
export type PushCategory =
  | 'guestChats'   // 💬 Gäste-Nachrichten
  | 'teamChats'    // 💼 Interne Chats
  | 'bookings'     // 🎉 Neue Buchungen & Stornos
  | 'tasks'        // ✅ Aufgaben & QS (Zuweisungen, Kommentare, Vorschläge, Termine)
  | 'calls'        // ☎️ Anrufe (Bereitschaft)
  | 'buchhaltung'  // 💶 Buchhaltung (Belege) — ohnehin nur Admins
  | 'wallbox'      // ⚡ Wallbox (Ladevorgänge)
  | 'system'       // 🔧 System & Betrieb (TV, Boxen, Türschlösser, Überbuchung, Import)

const LEGACY_COLS: Partial<Record<PushCategory, string>> = {
  guestChats: 'push_guest_chats',
  teamChats: 'push_team_chats',
  bookings: 'push_bookings',
  buchhaltung: 'push_buchhaltung',
}

/** Präferenz-Map je Nutzer für EINE Kategorie: erlaubt der Nutzer den Push? */
async function prefAllows(userIds: string[], category: PushCategory): Promise<Set<string>> {
  const allowed = new Set(userIds)
  if (!userIds.length) return allowed
  try {
    const { data } = await supabaseAdmin
      .from('profiles').select('*').in('id', userIds)
    const legacy = LEGACY_COLS[category]
    for (const p of (data ?? []) as Record<string, unknown>[]) {
      const id = p.id as string
      const prefs = (p.push_prefs as Record<string, unknown> | null) ?? {}
      // push_prefs gewinnt; Fallback auf die Alt-Spalte; Default = an
      const v = category in prefs ? prefs[category] : (legacy ? p[legacy] : undefined)
      if (v === false) allowed.delete(id)
    }
  } catch { /* Spalte fehlt (Migration ausstehend) → nichts filtern */ }
  return allowed
}

let configured = false
function ensureConfigured(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return false
  if (!configured) {
    webpush.setVapidDetails('mailto:mail@trimosa.de', pub, priv)
    configured = true
  }
  return true
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string }

async function sendToSubs(subs: Sub[], title: string, body: string, url: string, tag?: string): Promise<void> {
  // tag: gleiche Mitteilungen stapeln sich je Thread und lassen sich beim
  // Lesen in der App gezielt aus der Mitteilungszentrale räumen (§122)
  const payload = JSON.stringify({ title, body: body.slice(0, 180), url, tag: tag ?? url })
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      )
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', s.id)
      } else {
        console.error('[push] send failed:', status, s.endpoint.slice(0, 60))
      }
    }
  }))
}

/** opts.guestChat: Push stammt aus der GÄSTE-Kommunikation — DIENSTLEISTER
 *  (is_provider, kein Gäste-Chat-Zugang) bekommen ihn NIE; Nutzer mit
 *  push_guest_chats=false (Pascal-Präferenz §97.5) werden übersprungen. */
export async function sendPushToTeam(title: string, body: string, url = '/team', opts: { guestChat?: boolean; buchhaltung?: boolean; category?: PushCategory } = {}): Promise<void> {
  if (!ensureConfigured()) return
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, user_id')
  if (!subs?.length) return
  let filtered = subs as (Sub & { user_id: string | null })[]
  // §254: generisches Kategorie-Gate (Präferenz je Nutzer) — für die einfachen
  // Team-Broadcasts (System, Aufgaben …). guestChat/buchhaltung behalten ihre
  // Zusatz-Rollenlogik unten.
  if (opts.category) {
    const ids = filtered.map((s) => s.user_id).filter((x): x is string => !!x)
    const ok = await prefAllows(ids, opts.category)
    filtered = filtered.filter((s) => !s.user_id || ok.has(s.user_id))
  }
  if (opts.guestChat) {
    // Rollen-Gate: Dienstleister sehen keine Gäste-Chats → kategorisch raus
    try {
      const { data: prov } = await supabaseAdmin.from('profiles').select('id').eq('is_provider', true)
      const provIds = new Set((prov ?? []).map((p) => p.id))
      if (provIds.size) filtered = filtered.filter((s) => !s.user_id || !provIds.has(s.user_id))
    } catch { /* fail-soft */ }
    // Präferenz-Gate (§254): stummgeschaltete Gäste-Chats
    const ids = filtered.map((s) => s.user_id).filter((x): x is string => !!x)
    const ok = await prefAllows(ids, 'guestChats')
    filtered = filtered.filter((s) => !s.user_id || ok.has(s.user_id))
  }
  if (opts.buchhaltung) {
    // Rollen-Gate: AUSSCHLIESSLICH Admins (§242)
    try {
      const { data: admins } = await supabaseAdmin.from('profiles').select('id').eq('is_admin', true)
      const adminIds = new Set((admins ?? []).map((p) => p.id))
      filtered = filtered.filter((s) => s.user_id && adminIds.has(s.user_id))
    } catch { return /* im Zweifel KEIN Push an Nicht-Admins */ }
    // Präferenz-Gate
    const ids = filtered.map((s) => s.user_id).filter((x): x is string => !!x)
    const ok = await prefAllows(ids, 'buchhaltung')
    filtered = filtered.filter((s) => !s.user_id || ok.has(s.user_id))
  }
  if (!filtered.length) return
  await sendToSubs(filtered, title, body, url)
}

/** Push to ONE user's devices (e.g. task assignment to a provider).
 *  category (§254): respektiert die Push-Präferenz des Empfängers. */
export async function sendPushToUser(userId: string, title: string, body: string, url = '/team?tab=aufgaben', tag?: string, category?: PushCategory): Promise<void> {
  if (!ensureConfigured()) return
  if (category) {
    const ok = await prefAllows([userId], category)
    if (!ok.has(userId)) return
  }
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (!subs?.length) return
  await sendToSubs(subs, title, body, url, tag)
}

/**
 * 🎉 Neue Buchung/Anfrage (Pascal §99.1): rollenabhängiger Push aus der
 * eigenen App — Admins/Gastgeber MIT Buchungsbetrag, Mitarbeiter (Staff)
 * OHNE; Dienstleister nie. Tap öffnet direkt den Gast-Thread in der Inbox
 * (/team?conv=<bookingId>). Präferenz profiles.push_bookings (⚙️-Tab);
 * fehlt die Spalte noch (Migration ausstehend), wird ungefiltert gesendet.
 */
export async function sendNewBookingPush(bookingId: string, kind: 'new' | 'cancelled' = 'new'): Promise<void> {
  if (!ensureConfigured()) return
  try {
    const { data: b } = await supabaseAdmin
      .from('bookings')
      .select('id, listing_id, guest_id, guest_name, check_in, check_out, total_price, channel, source, booking_type, status')
      .eq('id', bookingId)
      .maybeSingle()
    if (!b) return
    const [{ data: listing }, { data: subs }, { data: team }] = await Promise.all([
      supabaseAdmin.from('listings').select('title').eq('id', b.listing_id).maybeSingle(),
      supabaseAdmin.from('push_subscriptions').select('id, endpoint, p256dh, auth, user_id'),
      supabaseAdmin.from('profiles').select('*').or('is_admin.eq.true,is_host.eq.true,is_staff.eq.true'),
    ])
    if (!subs?.length) return

    let guest = (b.guest_name ?? '').trim()
    if (!guest && b.guest_id) {
      const { data: gp } = await supabaseAdmin.from('profiles').select('display_name').eq('id', b.guest_id).maybeSingle()
      guest = (gp?.display_name ?? '').trim()
    }
    const fmtD = (iso: string) => { const [, m, d] = String(iso).split('-'); return `${Number(d)}.${Number(m)}.` }
    const channel = (b.channel as string | null) ?? (b.source === 'trimosa' ? 'Website' : 'Smoobu')
    // „Anfrage" nur für Website-Buchungen — externe sind immer fix (§139)
    const isRequest = b.source === 'trimosa' && (b.booking_type === 'request' || b.status === 'pending')
    const title = kind === 'cancelled'
      ? `❌ Stornierung · ${channel}`
      : isRequest ? `🔔 Neue Anfrage · ${channel}` : `🎉 Neue Buchung · ${channel}`
    const base = `${listing?.title ?? 'Wohnung'} · ${guest || 'Gast'} · ${fmtD(b.check_in)}–${fmtD(b.check_out)}`
    const amount = Number(b.total_price) > 0
      ? ` · ${Number(b.total_price).toLocaleString('de-DE', { maximumFractionDigits: 0 })} €`
      : ''
    const url = '/team?conv=' + b.id

    const info = new Map((team ?? []).map((p) => [p.id as string, p as Record<string, unknown>]))
    const chefSubs: Sub[] = []
    const staffSubs: Sub[] = []
    for (const s of subs as (Sub & { user_id: string | null })[]) {
      const p = s.user_id ? info.get(s.user_id) : undefined
      if (!p) continue
      // §254: push_prefs.bookings gewinnt, Fallback push_bookings
      const prefs = (p.push_prefs as Record<string, unknown> | null) ?? {}
      const wantsBooking = 'bookings' in prefs ? prefs.bookings !== false : p.push_bookings !== false
      if (!wantsBooking) continue
      if (p.is_admin || p.is_host) chefSubs.push(s)
      else if (p.is_staff) staffSubs.push(s)
    }
    await Promise.all([
      chefSubs.length ? sendToSubs(chefSubs, title, base + amount, url) : Promise.resolve(),
      staffSubs.length ? sendToSubs(staffSubs, title, base, url) : Promise.resolve(),
    ])
  } catch (e) {
    console.error('[push] booking push failed:', e)
  }
}

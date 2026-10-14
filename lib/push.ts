/**
 * Team web push (chat PWA). Sends a notification to every subscribed team
 * device; dead subscriptions (410/404) are pruned automatically. Requires
 * VAPID_PRIVATE_KEY + NEXT_PUBLIC_VAPID_PUBLIC_KEY in the environment.
 *
 * 🌙 Ruhezeiten (Pascal, Chefsache 7.10.2026): nicht dringende Kategorien
 * landen in der Ruhezeit des Empfängers (Standard 22–7 Uhr) in der
 * Nacht-Warteschlange statt auf dem Gerät; /api/push/morgen schickt danach
 * EINE Sammel-Mitteilung. Regeln + reine Funktionen: lib/push-ruhe.ts.
 *
 * ✍️ Schema für alle Push-Texte: Titel „<Emoji> <was> · <wo/wer>" (≤ ~50
 * Zeichen), Text „<Kernfakten>. <nächster Schritt>" (≤ ~120 Zeichen) — per
 * Du, ohne Großbuchstaben-Rufe und ohne Technik-Begriffe.
 */
import webpush from 'web-push'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  istDringend, berlinStunde, inRuhezeit, ruheAusPrefs, nachtLesen, nachtEinreihen, sammelMitteilung,
  NACHT_PREFIX, MORGEN_URL, type NachtEintrag,
} from '@/lib/push-ruhe'

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
  | 'reinigung'    // 🧹 Reinigungs-Fertigmeldungen (v4 — eigener Schalter, Patrick §259)
  | 'calls'        // ☎️ Anrufe (Bereitschaft)
  | 'buchhaltung'  // 💶 Buchhaltung (Belege) — ohnehin nur Admins
  | 'wallbox'      // ⚡ Wallbox (Ladevorgänge)
  | 'material'     // 🛒 Material & Bestellungen (Bedarf gemeldet, Bestellung fällig)
  | 'system'       // 🔧 System & Betrieb (Türschlösser, Überbuchung, Import)
  | 'tv'           // 📺 TV-Boxen & TV-Server (Ausfälle/Entwarnung) — eigener Schalter (Inhaber 9.9., §301)

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

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; user_id?: string | null }

/** Zustellung an die Geräte; tote Subscriptions (404/410) werden entfernt */
async function zustellen(subs: Sub[], payload: string): Promise<void> {
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

/**
 * 🌙 Nacht-Warteschlange: Eintrag an app_settings push_nacht:<userId> anhängen.
 * Konfliktfrei ohne Migration über den Versionszähler v (Update nur, wenn v
 * noch stimmt — sonst neu lesen). false = nicht gespeichert → Aufrufer sendet
 * lieber sofort, als die Mitteilung zu verlieren.
 */
async function nachtAnhaengen(userId: string, eintrag: NachtEintrag): Promise<boolean> {
  const key = NACHT_PREFIX + userId
  for (let versuch = 0; versuch < 6; versuch++) {
    // Wiederholung mit kurzer Zufallspause — gleichzeitige Schreiber laufen sonst im Gleichschritt
    if (versuch) await new Promise((r) => setTimeout(r, 20 + Math.random() * 80 * versuch))
    try {
      const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('key', key).maybeSingle()
      if (error) { console.error('[push-ruhe] Warteschlange nicht lesbar:', error.message); return false }
      const alt = nachtLesen(data?.value)
      const neu = nachtEinreihen(alt, eintrag)
      if (!data) {
        // noch keine Warteschlange — parallel angelegt? Dann scheitert insert am Schlüssel → neu lesen
        const { error: insErr } = await supabaseAdmin.from('app_settings').insert({ key, value: neu })
        if (!insErr) return true
        continue
      }
      const { data: upd, error: updErr } = await supabaseAdmin.from('app_settings')
        .update({ value: neu, updated_at: new Date().toISOString() })
        .eq('key', key).eq('value->>v', String(alt.v))
        .select('key')
      if (updErr) { console.error('[push-ruhe] Warteschlange nicht gespeichert:', updErr.message); return false }
      if (upd?.length) return true
      // jemand war schneller (oder die Morgen-Sammlung hat gerade geleert) → neu lesen
    } catch (e) {
      console.error('[push-ruhe] Warteschlange:', e)
      return false
    }
  }
  return false
}

/**
 * 🌙 Wer bekommt diese Mitteilung jetzt NICHT aufs Gerät? Nur nicht dringende
 * Kategorien, nur Empfänger in ihrer Ruhezeit — und nur, wenn die
 * Warteschlange den Eintrag wirklich gespeichert hat. Fail-open: Fehler beim
 * Lesen der Einstellungen → sofort senden (wie vor den Ruhezeiten).
 */
async function nachtZurueckhalten(userIds: string[], title: string, body: string, url: string, category?: PushCategory): Promise<Set<string>> {
  const zurueck = new Set<string>()
  if (istDringend(category) || !userIds.length) return zurueck
  let ruhend: string[] = []
  try {
    const { data, error } = await supabaseAdmin.from('profiles').select('id, push_prefs').in('id', userIds)
    if (error) { console.error('[push-ruhe] Einstellungen nicht lesbar — sende sofort:', error.message); return zurueck }
    const stunde = berlinStunde()
    ruhend = ((data ?? []) as { id: string; push_prefs: unknown }[])
      .filter((p) => inRuhezeit(ruheAusPrefs(p.push_prefs), stunde))
      .map((p) => p.id)
  } catch { return zurueck }
  if (!ruhend.length) return zurueck
  const eintrag: NachtEintrag = { titel: title, text: body, url, kategorie: category ?? null, zeit: new Date().toISOString() }
  await Promise.all(ruhend.map(async (id) => { if (await nachtAnhaengen(id, eintrag)) zurueck.add(id) }))
  return zurueck
}

async function sendToSubs(subs: Sub[], title: string, body: string, url: string, tag?: string, category?: PushCategory): Promise<void> {
  const text = body.slice(0, 180)
  const userIds = [...new Set(subs.map((s) => s.user_id).filter((x): x is string => !!x))]
  // 🌙 Ruhezeit: zurückgehaltene Empfänger bekommen die Mitteilung morgens in
  // der Sammel-Mitteilung; Geräte ohne user_id kennen keine Ruhezeit → sofort
  const zurueck = await nachtZurueckhalten(userIds, title, text, url, category)
  const sofort = zurueck.size ? subs.filter((s) => !s.user_id || !zurueck.has(s.user_id)) : subs
  // tag: gleiche Mitteilungen stapeln sich je Thread und lassen sich beim
  // Lesen in der App gezielt aus der Mitteilungszentrale räumen (§122)
  if (sofort.length) await zustellen(sofort, JSON.stringify({ title, body: text, url, tag: tag ?? url }))
  /* §265 Push-Historie: je EMPFÄNGER eine Zeile (nicht je Gerät) — die
   * Team-App zeigt daraus den anklickbaren Verlauf. Fail-soft: fehlt die
   * Migration, geht der Push trotzdem raus. Aufräumen macht der 3:40-Cron.
   * 🌙 Auch zurückgehaltene Mitteilungen stehen SOFORT im Verlauf. */
  try {
    if (userIds.length) {
      // supabase-js WIRFT bei DB-Fehlern nicht — error explizit ansehen,
      // damit „Migration fehlt" wenigstens einmal im Log auftaucht.
      const { error } = await supabaseAdmin.from('push_log').insert(
        userIds.map((user_id) => ({ user_id, title, body: body.slice(0, 180), url, category: category ?? null })),
      )
      if (error) console.error('[push-log] insert:', error.message)
    }
  } catch { /* Netz-Rejection — Push ging trotzdem raus */ }
}

/** opts.guestChat: Push stammt aus der GÄSTE-Kommunikation — DIENSTLEISTER
 *  (is_provider, kein Gäste-Chat-Zugang) bekommen ihn NIE; Nutzer mit
 *  push_guest_chats=false (Pascal-Präferenz §97.5) werden übersprungen. */
export async function sendPushToTeam(title: string, body: string, url = '/team', opts: { guestChat?: boolean; buchhaltung?: boolean; category?: PushCategory } = {}): Promise<number> {
  // Rückgabe = Anzahl angesprochener Geräte (0 = niemand erreicht). Ausfälle werden geloggt statt still zu enden.
  // 🌙 In der Ruhezeit zurückgehaltene Geräte zählen mit (die Mitteilung kommt morgens gesammelt an).
  if (!ensureConfigured()) { console.error('[push] VAPID-Schlüssel fehlen (Vercel-Env) — Push nicht gesendet:', title); return 0 }
  const { data: subs, error: subsErr } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, user_id')
  if (subsErr) { console.error('[push] Geräte nicht ladbar — Push nicht gesendet:', title, subsErr.message); return 0 }
  if (!subs?.length) return 0
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
    } catch { return 0 /* im Zweifel KEIN Push an Nicht-Admins */ }
    // Präferenz-Gate
    const ids = filtered.map((s) => s.user_id).filter((x): x is string => !!x)
    const ok = await prefAllows(ids, 'buchhaltung')
    filtered = filtered.filter((s) => !s.user_id || ok.has(s.user_id))
  }
  if (!filtered.length) return 0
  const logCat = opts.category ?? (opts.guestChat ? 'guestChats' : opts.buchhaltung ? 'buchhaltung' : undefined)
  await sendToSubs(filtered, title, body, url, undefined, logCat)
  return filtered.length
}

/** Push to ONE user's devices (e.g. task assignment to a provider).
 *  category (§254): respektiert die Push-Präferenz des Empfängers. */
export async function sendPushToUser(userId: string, title: string, body: string, url = '/team?tab=aufgaben', tag?: string, category?: PushCategory): Promise<number> {
  // §265: Rückgabe = Anzahl bedienter Geräte (0 = Empfänger unerreichbar —
  // keine Subscription oder Kategorie stummgeschaltet). Aufrufer wie der
  // Batterie-Wächter fallen dann auf einen Team-Broadcast zurück.
  // 🌙 In der Ruhezeit zurückgehaltene Geräte zählen als erreicht — sonst
  // lösten Rückfall-Logiken nachts unnötige Team-Pushes aus.
  if (!ensureConfigured()) return 0
  if (category) {
    const ok = await prefAllows([userId], category)
    if (!ok.has(userId)) return 0
  }
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (!subs?.length) return 0
  await sendToSubs((subs as Sub[]).map((s) => ({ ...s, user_id: userId })), title, body, url, tag, category)
  return subs.length
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
    // §274: Website-Buchungen tragen intern channel 'direct' — im Push soll
    // der Kanal sprechend heißen (Dominik: „Portale benennen")
    const rawChannel = (b.channel as string | null) ?? (b.source === 'trimosa' ? 'Website' : 'Smoobu')
    const channel = b.source === 'trimosa' || /^(direct|trimosa)$/i.test(rawChannel) ? 'Website (trimosa.de)' : rawChannel
    // „Anfrage" nur für Website-Buchungen — externe sind immer fix (§139)
    const isRequest = b.source === 'trimosa' && (b.booking_type === 'request' || b.status === 'pending')
    // Schema (Pascal 7.10.): Titel = was · wo (Wohnung), Text = wer · wann · Kanal (Betrag nur für Chefs)
    const wohnung = listing?.title ?? 'Wohnung'
    const title = kind === 'cancelled'
      ? `❌ Stornierung · ${wohnung}`
      : isRequest ? `🔔 Neue Anfrage · ${wohnung}` : `🎉 Neue Buchung · ${wohnung}`
    const base = `${guest || 'Gast'} · ${fmtD(b.check_in)}–${fmtD(b.check_out)} · ${channel}`
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
      chefSubs.length ? sendToSubs(chefSubs, title, base + amount, url, undefined, 'bookings') : Promise.resolve(),
      staffSubs.length ? sendToSubs(staffSubs, title, base, url, undefined, 'bookings') : Promise.resolve(),
    ])
  } catch (e) {
    console.error('[push] booking push failed:', e)
  }
}

/**
 * 🌅 Morgen-Sammlung (Cron /api/push/morgen, stündlich zu Minute 3): je Nutzer
 * mit Nacht-Warteschlange, dessen Ruhezeit gerade NICHT läuft, EINE
 * Sammel-Mitteilung („🌅 Über Nacht: N Mitteilungen") — danach ist die
 * Warteschlange leer. Idempotent: die Warteschlange wird per Löschen mit
 * Rückgabe übernommen; läuft der Cron doppelt, bekommt nur EIN Lauf die
 * Einträge. Kein push_log-Eintrag — die Einzel-Mitteilungen stehen dort schon.
 */
export async function sendeMorgenSammlung(jetzt: Date = new Date()): Promise<{ wartend: number; nochRuhe: number; gesendet: number; geraete: number; ohneGeraet: number }> {
  const bericht = { wartend: 0, nochRuhe: 0, gesendet: 0, geraete: 0, ohneGeraet: 0 }
  // ohne VAPID nichts übernehmen — die Warteschlangen bleiben bis zum nächsten Lauf liegen
  if (!ensureConfigured()) throw new Error('VAPID-Schlüssel fehlen (Vercel-Env) — Sammel-Mitteilungen nicht gesendet')
  const { data: zeilen, error } = await supabaseAdmin.from('app_settings').select('key').like('key', `${NACHT_PREFIX}%`)
  if (error) throw new Error(`Warteschlangen nicht lesbar: ${error.message}`)
  const ids = (zeilen ?? []).map((z) => String(z.key).slice(NACHT_PREFIX.length)).filter(Boolean)
  bericht.wartend = ids.length
  if (!ids.length) return bericht
  const { data: profs } = await supabaseAdmin.from('profiles').select('id, push_prefs').in('id', ids)
  const prefsVon = new Map(((profs ?? []) as { id: string; push_prefs: unknown }[]).map((p) => [p.id, p.push_prefs]))
  const stunde = berlinStunde(jetzt)
  for (const id of ids) {
    if (inRuhezeit(ruheAusPrefs(prefsVon.get(id)), stunde)) { bericht.nochRuhe++; continue }
    // Übernehmen = Löschen mit Rückgabe: nur wer die Zeile wirklich gelöscht hat, sendet
    const { data: weg, error: delErr } = await supabaseAdmin.from('app_settings').delete().eq('key', NACHT_PREFIX + id).select('value')
    if (delErr) { console.error('[push-morgen] Warteschlange nicht übernommen:', id.slice(0, 8), delErr.message); continue }
    if (!weg?.length) continue
    const m = sammelMitteilung(nachtLesen(weg[0].value))
    if (!m) continue
    const { data: subs } = await supabaseAdmin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', id)
    if (!subs?.length) { bericht.ohneGeraet++; continue }
    await zustellen(subs as Sub[], JSON.stringify({ title: m.title, body: m.body, url: MORGEN_URL, tag: 'push-morgen' }))
    bericht.gesendet++
    bericht.geraete += subs.length
  }
  return bericht
}

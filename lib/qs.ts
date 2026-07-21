/**
 * 🧾 Qualitätssicherung (HANDOFF §100): halbjährliche Wohnungs-Checks.
 * - QS_TEMPLATE: die Protokoll-Checkliste (Sektionen → Punkte). Punkte vom
 *   Typ 'anzahl' fragen zusätzlich eine Stückzahl ab (Besteck, Gläser …).
 * - ensureQsChecks(): tägliche Cron-Logik — plant je aktiver Wohnung den
 *   nächsten Termin (Intervall ~halbjährlich, konfigurierbar) auf einen
 *   FREIEN Tag (Belegungs-Check gegen bookings) und pusht die zuständige
 *   Person. Ohne konfigurierte Person (app_settings 'qs_settings') wird
 *   nichts angelegt.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendPushToUser, sendPushToTeam } from '@/lib/push'

export interface QsItem {
  id: string
  label: string
  /** 'zustand' = OK/Mangel/n. geprüft · 'anzahl' = zusätzlich Stückzahl */
  type: 'zustand' | 'anzahl'
  hint?: string
}
export interface QsSection { id: string; title: string; emoji: string; items: QsItem[] }
export interface QsItemValue { s?: 'ok' | 'mangel' | 'na'; note?: string; count?: number }
/** template = Snapshot der beim ABSCHLUSS gültigen Checkliste — alte
 *  Protokolle bleiben damit auch nach Vorlagen-Änderungen korrekt lesbar. */
export interface QsReport { items?: Record<string, QsItemValue>; note?: string; template?: QsSection[] }

export const QS_TEMPLATE: QsSection[] = [
  {
    id: 'textilien', title: 'Textilien & Betten', emoji: '🛏️',
    items: [
      { id: 'bettwaesche', label: 'Bettwäsche', type: 'zustand', hint: 'Vergilbt/fleckig → waschen oder austauschen' },
      { id: 'kissenschoner', label: 'Kissen- & Matratzenschoner', type: 'zustand', hint: 'Vergilbt → waschen' },
      { id: 'decken_kissen', label: 'Decken & Kissen', type: 'zustand', hint: 'Geruch, Klumpen, Zustand' },
      { id: 'handtuecher', label: 'Handtücher', type: 'anzahl', hint: 'Zustand + Anzahl vollständig?' },
      { id: 'matratzen', label: 'Matratzen', type: 'zustand', hint: 'Flecken, Kuhlen, einmal wenden' },
    ],
  },
  {
    id: 'kueche', title: 'Küche & Inventar', emoji: '🍽️',
    items: [
      { id: 'besteck', label: 'Besteck (Sets)', type: 'anzahl', hint: 'Messer/Gabel/Löffel je Set zählen' },
      { id: 'glaeser', label: 'Gläser', type: 'anzahl' },
      { id: 'geschirr', label: 'Teller & Tassen', type: 'anzahl' },
      { id: 'toepfe', label: 'Töpfe & Pfannen', type: 'zustand', hint: 'Beschichtung, Deckel vorhanden' },
      { id: 'kuechengeraete_innen', label: 'Backofen / Kühlschrank / Spülmaschine innen', type: 'zustand', hint: 'Grundreinigung nötig?' },
      { id: 'grundausstattung', label: 'Grundausstattung (Gewürze, Filter, Spülmittel …)', type: 'zustand' },
    ],
  },
  {
    id: 'raeume', title: 'Räume & Möbel', emoji: '🚪',
    items: [
      { id: 'waende_boeden', label: 'Wände & Böden', type: 'zustand', hint: 'Flecken, Kratzer, Abplatzer' },
      { id: 'moebel', label: 'Möbel & Polster', type: 'zustand', hint: 'Wackelt etwas? Flecken auf Sofa/Stühlen?' },
      { id: 'fenster_tueren', label: 'Fenster & Türen', type: 'zustand', hint: 'Schließen sauber, Griffe fest' },
      { id: 'lampen', label: 'Lampen & Leuchtmittel', type: 'zustand', hint: 'Alle Birnen funktionieren?' },
      { id: 'deko', label: 'Deko & Vorhänge', type: 'zustand' },
    ],
  },
  {
    id: 'bad', title: 'Bad', emoji: '🚿',
    items: [
      { id: 'silikonfugen', label: 'Silikonfugen', type: 'zustand', hint: 'Schimmel/Verfärbung → erneuern' },
      { id: 'armaturen', label: 'Armaturen & Duschkopf', type: 'zustand', hint: 'Verkalkt → entkalken' },
      { id: 'abfluesse', label: 'Abflüsse', type: 'zustand', hint: 'Läuft das Wasser zügig ab?' },
      { id: 'foen', label: 'Föhn & Bad-Ausstattung', type: 'zustand' },
    ],
  },
  {
    id: 'elektro', title: 'Elektrogeräte (Sichtprüfung)', emoji: '🔌',
    items: [
      { id: 'kabel_stecker', label: 'Kabel & Stecker aller Geräte', type: 'zustand', hint: 'Keine Brüche, Quetschungen, Schmorstellen' },
      { id: 'kleingeraete', label: 'Wasserkocher / Toaster / Kaffeemaschine', type: 'zustand', hint: 'Einschalten + Sichtprüfung' },
      { id: 'grossgeraete', label: 'Herd / Backofen / Waschmaschine', type: 'zustand', hint: 'Kurz einschalten, Auffälligkeiten?' },
      { id: 'tv_router', label: 'TV & WLAN-Router', type: 'zustand', hint: 'TV startet, WLAN verbindet' },
      { id: 'steckdosen', label: 'Steckdosen & Schalter', type: 'zustand', hint: 'Fest in der Wand, keine Verfärbung' },
    ],
  },
  {
    id: 'sicherheit', title: 'Sicherheit', emoji: '🚨',
    items: [
      { id: 'rauchmelder', label: 'Rauchmelder', type: 'zustand', hint: 'Testknopf drücken — Signal muss ertönen' },
      { id: 'schluessel_codes', label: 'Schlüssel & Türcodes', type: 'zustand', hint: 'Alle Schlüssel da, Schloss-Batterien ok' },
      { id: 'erste_hilfe', label: 'Erste-Hilfe / Feuerlöschdecke (falls vorhanden)', type: 'zustand' },
      { id: 'balkon_aussen', label: 'Balkon / Terrasse / Außenbereich', type: 'zustand', hint: 'Geländer fest, Möbel intakt, Beleuchtung' },
    ],
  },
]

export function qsItemCount(): number {
  return QS_TEMPLATE.reduce((s, sec) => s + sec.items.length, 0)
}

/* ── Editierbare Vorlagen mit Vererbung (Wohnung > Standort > Standard) ──
   Ablage in app_settings (kein Schema-Change):
   'qs_template' = Standard-Override · 'qs_template:group:<Name>' je Standort ·
   'qs_template:listing:<uuid>' je Wohnung. Ohne Overrides gilt QS_TEMPLATE. */

export interface QsTemplateStore {
  base: QsSection[]
  groups: Record<string, QsSection[]>
  listings: Record<string, QsSection[]>
}

/** Server-Validierung/Bereinigung einer Vorlage aus dem Editor. */
export function cleanTemplate(raw: unknown): QsSection[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 12) return null
  const usedIds = new Set<string>()
  const genId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const sections: QsSection[] = []
  for (const s of raw) {
    if (!s || typeof s !== 'object') return null
    const sec = s as Partial<QsSection>
    const items: QsItem[] = []
    if (!Array.isArray(sec.items) || sec.items.length === 0 || sec.items.length > 20) return null
    for (const i of sec.items) {
      const it = i as Partial<QsItem>
      const label = String(it.label ?? '').trim().slice(0, 120)
      if (!label) continue
      let id = String(it.id ?? '').trim().slice(0, 60)
      if (!id || usedIds.has(id)) id = genId()
      usedIds.add(id)
      items.push({
        id, label,
        type: it.type === 'anzahl' ? 'anzahl' : 'zustand',
        ...(String(it.hint ?? '').trim() ? { hint: String(it.hint).trim().slice(0, 160) } : {}),
      })
    }
    if (!items.length) continue
    let sid = String(sec.id ?? '').trim().slice(0, 60)
    if (!sid || usedIds.has(sid)) sid = genId()
    usedIds.add(sid)
    sections.push({
      id: sid,
      title: String(sec.title ?? '').trim().slice(0, 60) || 'Bereich',
      emoji: String(sec.emoji ?? '').trim().slice(0, 4) || '📋',
      items,
    })
  }
  return sections.length ? sections : null
}

const gq = globalThis as typeof globalThis & { __qsTplCache?: { at: number; value: QsTemplateStore } }

export async function getQsTemplateStore(): Promise<QsTemplateStore> {
  const hit = gq.__qsTplCache
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value
  const store: QsTemplateStore = { base: QS_TEMPLATE, groups: {}, listings: {} }
  try {
    const { data } = await supabaseAdmin
      .from('app_settings').select('key, value').like('key', 'qs_template%')
    for (const row of data ?? []) {
      const tpl = cleanTemplate(row.value)
      if (!tpl) continue
      if (row.key === 'qs_template') store.base = tpl
      else if (row.key.startsWith('qs_template:group:')) store.groups[row.key.slice('qs_template:group:'.length)] = tpl
      else if (row.key.startsWith('qs_template:listing:')) store.listings[row.key.slice('qs_template:listing:'.length)] = tpl
    }
  } catch { /* Defaults */ }
  gq.__qsTplCache = { at: Date.now(), value: store }
  return store
}

export function invalidateQsTemplateCache() { gq.__qsTplCache = undefined }

/** Aufgelöste Checkliste für eine Wohnung: eigene > Standort > Standard. */
export function resolveQsTemplate(store: QsTemplateStore, listingId: string, locationGroup?: string | null): QsSection[] {
  return store.listings[listingId]
    ?? (locationGroup ? store.groups[locationGroup.trim()] : undefined)
    ?? store.base
}

/* ── Terminplanung ── */

export interface QsSettings { assigneeId: string | null; intervalDays: number; leadDays: number }
export const QS_SETTINGS_DEFAULTS: QsSettings = { assigneeId: null, intervalDays: 182, leadDays: 21 }

export async function getQsSettings(): Promise<QsSettings> {
  try {
    const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'qs_settings').maybeSingle()
    const v = (data?.value ?? {}) as Partial<QsSettings>
    return { ...QS_SETTINGS_DEFAULTS, ...v }
  } catch {
    return QS_SETTINGS_DEFAULTS
  }
}

function isoOffset(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10)
}

type StayRow = { check_in: string; check_out: string }

async function loadStays(listingId: string, fromIso: string, toIso: string): Promise<StayRow[]> {
  const { data } = await supabaseAdmin
    .from('bookings')
    .select('check_in, check_out, status, payment_status, source')
    .eq('listing_id', listingId)
    .eq('status', 'confirmed')
    .lte('check_in', toIso)
    .gte('check_out', fromIso)
    .limit(200)
  return (data ?? []).filter((b) => b.source !== 'trimosa' || b.payment_status === 'paid')
}

/** Ist die Wohnung an diesem Tag frei (keine Belegung, keine An-/Abreise)? */
export async function isDayFree(listingId: string, iso: string): Promise<boolean> {
  const stays = await loadStays(listingId, iso, iso)
  return !stays.some((s) => (s.check_in <= iso && s.check_out > iso) || s.check_in === iso || s.check_out === iso)
}

/**
 * Erster komplett freier Tag in [fromIso, maxIso]: keine laufende Belegung
 * und auch kein An-/Abreisetag (die gehören der Reinigung). null = nichts frei.
 */
export async function findFreeDayUntil(listingId: string, fromIso: string, maxIso: string): Promise<string | null> {
  const stays = await loadStays(listingId, fromIso, maxIso)
  const d = new Date(fromIso + 'T00:00:00Z')
  for (let i = 0; i <= 120; i++) {
    const iso = d.toISOString().slice(0, 10)
    if (iso > maxIso) return null
    const blocked = stays.some((s) => (s.check_in <= iso && s.check_out > iso) || s.check_in === iso || s.check_out === iso)
    if (!blocked) return iso
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return null
}

/** Wie findFreeDayUntil (+90 Tage), Fallback fromIso bei Dauerbelegung. */
export async function findFreeDay(listingId: string, fromIso: string): Promise<string> {
  const horizon = new Date(new Date(fromIso + 'T00:00:00Z').getTime() + 90 * 86400_000).toISOString().slice(0, 10)
  return (await findFreeDayUntil(listingId, fromIso, horizon)) ?? fromIso
}

/* Verschiebe-Grenzen (Inhaber-Vorgabe „nicht zu weit verschiebbar"):
   - Auto-Ausweichen & Nicht-Admins: max. 6 Wochen ab heute
   - harte Deckelung je Termin: 10 Wochen ab Anlage — danach kein
     Auto-Schieben mehr, stattdessen Team-Alarm */
export const QS_MAX_SHIFT_DAYS = 42
export const QS_DEADLINE_DAYS = 70

/**
 * Cron: Termine, deren Tag NACHTRÄGLICH belegt wurde (neue Buchung), auf den
 * nächsten freien Tag ausweichen — bevorzugt auch nach VORN. Kein freier Tag
 * innerhalb der Grenzen → Termin bleibt stehen; kurz vor knapp (≤ 1 Tag)
 * geht ein Team-Alarm raus, damit manuell gelegt wird (z. B. nach Reinigung
 * an einem Abreisetag).
 */
export async function rescheduleConflictingChecks(): Promise<{ moved: number; alerts: number }> {
  const { data: planned } = await supabaseAdmin
    .from('qs_checks')
    .select('id, listing_id, assignee_id, due_date, created_at')
    .eq('status', 'geplant')
  const today = isoOffset(0)
  let moved = 0
  let alerts = 0
  for (const c of planned ?? []) {
    if (c.due_date < today) continue // überfällig — rot im UI, nicht anfassen
    if (await isDayFree(c.listing_id, c.due_date)) continue

    const deadline = new Date(new Date(c.created_at).getTime() + QS_DEADLINE_DAYS * 86400_000).toISOString().slice(0, 10)
    const horizon = isoOffset(QS_MAX_SHIFT_DAYS)
    const limit = deadline < horizon ? deadline : horizon
    const next = await findFreeDayUntil(c.listing_id, isoOffset(1), limit)
    const { data: listing } = await supabaseAdmin.from('listings').select('title').eq('id', c.listing_id).maybeSingle()
    const title = listing?.title ?? 'Wohnung'

    if (next) {
      const { error } = await supabaseAdmin
        .from('qs_checks')
        .update({ due_date: next, updated_at: new Date().toISOString() })
        .eq('id', c.id)
      if (!error) {
        moved++
        if (c.assignee_id) {
          await sendPushToUser(
            c.assignee_id,
            '🧾 QS-Termin automatisch verschoben',
            `${title}: Am bisherigen Termin ist jetzt eine Buchung. Neu: ${fmtDe(next)}`,
            '/team?tab=aufgaben'
          ).catch(() => {})
        }
      }
    } else if (c.due_date <= isoOffset(1)) {
      alerts++
      await sendPushToTeam(
        '⚠️ QS-Termin braucht Hilfe',
        `${title}: kein freier Tag bis ${fmtDe(limit)} — bitte manuell legen (z. B. nach der Reinigung an einem Abreisetag).`,
        '/team?tab=aufgaben'
      ).catch(() => {})
    }
  }
  return { moved, alerts }
}

function fmtDe(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${Number(d)}.${Number(m)}.${y}`
}

/**
 * Cron-Kern: je aktiver Wohnung sicherstellen, dass der nächste QS-Termin
 * geplant ist. Angelegt wird mit leadDays Vorlauf vor dem Soll-Datum
 * (letzter erledigter Check + intervalDays; nie geprüft → bald).
 */
export async function ensureQsChecks(): Promise<{ created: number; skipped: number; note?: string }> {
  const settings = await getQsSettings()
  if (!settings.assigneeId) return { created: 0, skipped: 0, note: 'Keine zuständige Person konfiguriert (Admin → Qualitätssicherung).' }

  const { data: listings } = await supabaseAdmin
    .from('listings').select('id, title').eq('is_active', true)
  const { data: existing } = await supabaseAdmin
    .from('qs_checks').select('listing_id, status, completed_at, due_date')

  const today = isoOffset(0)
  let created = 0
  let skipped = 0

  for (const l of listings ?? []) {
    const mine = (existing ?? []).filter((c) => c.listing_id === l.id)
    if (mine.some((c) => c.status === 'geplant')) { skipped++; continue }

    const lastDone = mine
      .filter((c) => c.status === 'erledigt' && c.completed_at)
      .map((c) => String(c.completed_at).slice(0, 10))
      .sort()
      .pop()
    // Soll-Datum: letzter Check + Intervall; nie geprüft → in einer Woche
    const target = lastDone
      ? new Date(new Date(lastDone + 'T00:00:00Z').getTime() + settings.intervalDays * 86400_000).toISOString().slice(0, 10)
      : isoOffset(7)
    // Erst mit Vorlauf anlegen — sonst steht der Termin ein halbes Jahr herum
    if (target > isoOffset(settings.leadDays)) { skipped++; continue }

    const from = target < today ? isoOffset(3) : target
    const due = await findFreeDay(l.id, from)
    const { error } = await supabaseAdmin.from('qs_checks').insert({
      listing_id: l.id, assignee_id: settings.assigneeId, due_date: due, status: 'geplant',
    })
    if (!error) {
      created++
      await sendPushToUser(
        settings.assigneeId,
        '🧾 Qualitätscheck geplant',
        `${l.title} · ${fmtDe(due)} — Termin bei Bedarf verschiebbar.`,
        '/team?tab=aufgaben'
      ).catch(() => {})
    }
  }
  return { created, skipped }
}

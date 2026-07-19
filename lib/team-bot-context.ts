/**
 * 🤖 Live-Datenkontext für den @c-Team-Bot (Inhaber-Wunsch 19.07.):
 * Wohnungs-Stammdaten, Belegung (±45 Tage), offene Aufgaben, QS-Termine und
 * das destillierte Wohnungs-Wissen — damit der Bot echte Betriebsfragen
 * beantworten kann. includeGuestNames=false für Gruppen mit Dienstleistern
 * (gleiche Datensparsamkeit wie der Team-Kalender). 5-Min-Cache je Variante.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { APP_HANDBOOK } from '@/lib/app-handbook'

const g = globalThis as typeof globalThis & {
  __botCtxCache?: Record<string, { at: number; value: string }>
}

function fmtD(iso: string): string {
  const [, m, d] = String(iso).split('-')
  return `${Number(d)}.${Number(m)}.`
}

export async function buildBotContext(includeGuestNames: boolean): Promise<string> {
  const key = includeGuestNames ? 'full' : 'noguests'
  const cache = (g.__botCtxCache ??= {})
  const hit = cache[key]
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value

  const today = new Date().toISOString().slice(0, 10)
  const start = new Date(Date.now() - 1 * 86400_000).toISOString().slice(0, 10)
  const end = new Date(Date.now() + 45 * 86400_000).toISOString().slice(0, 10)
  const parts: string[] = [`HEUTE: ${today}`]

  try {
    const { data: listings } = await supabaseAdmin
      .from('listings')
      .select('id, title, city, max_guests, check_in_time, check_out_time, location_group')
      .eq('is_active', true)
      .order('title')
    const titleOf = new Map((listings ?? []).map((l) => [l.id, l.title as string]))

    parts.push('WOHNUNGEN:\n' + (listings ?? []).map((l) =>
      `- ${l.title} (${l.city ?? '—'}${l.location_group ? `, Standort ${l.location_group}` : ''}) · max. ${l.max_guests ?? '?'} Gäste · Check-in ab ${l.check_in_time ?? '?'} / Check-out bis ${l.check_out_time ?? '?'}`
    ).join('\n'))

    try {
      const { data: stays } = await supabaseAdmin
        .from('bookings')
        .select('listing_id, check_in, check_out, guest_name, channel, source, status, payment_status')
        .eq('status', 'confirmed')
        .lte('check_in', end)
        .gte('check_out', start)
        .order('check_in')
        .limit(300)
      const byListing = new Map<string, string[]>()
      for (const b of stays ?? []) {
        if (b.source === 'trimosa' && b.payment_status !== 'paid') continue
        const label = includeGuestNames
          ? `${fmtD(b.check_in)}→${fmtD(b.check_out)} ${b.guest_name ?? 'Gast'}${b.channel ? ` (${b.channel})` : ''}`
          : `${fmtD(b.check_in)}→${fmtD(b.check_out)} belegt`
        const arr = byListing.get(b.listing_id) ?? []
        arr.push(label)
        byListing.set(b.listing_id, arr)
      }
      parts.push(`BELEGUNG (bestätigte Aufenthalte, gestern bis +45 Tage — Lücken dazwischen sind frei):\n`
        + (listings ?? []).map((l) => `${l.title}: ${(byListing.get(l.id) ?? ['keine Buchungen im Zeitraum']).join(' · ')}`).join('\n'))
    } catch { /* Belegung optional */ }

    try {
      const { data: tasks } = await supabaseAdmin
        .from('tasks')
        .select('title, prio, status, listing_id, location_group, due_date')
        .in('status', ['offen', 'in_arbeit'])
        .limit(40)
      if (tasks?.length) {
        parts.push('OFFENE AUFGABEN:\n' + tasks.map((t) =>
          `- ${t.title} (${t.listing_id ? titleOf.get(t.listing_id) ?? 'Wohnung' : t.location_group ?? 'Allgemein'}, ${t.prio}${t.due_date ? `, bis ${fmtD(t.due_date)}` : ''})`
        ).join('\n'))
      }
    } catch { /* Aufgaben optional */ }

    try {
      const { data: qs } = await supabaseAdmin
        .from('qs_checks').select('listing_id, due_date').eq('status', 'geplant').limit(20)
      if (qs?.length) {
        parts.push('GEPLANTE QS-TERMINE (Qualitätscheck, Vanessa):\n'
          + qs.map((c) => `- ${titleOf.get(c.listing_id) ?? 'Wohnung'}: ${fmtD(c.due_date)}`).join('\n'))
      }
    } catch { /* QS optional */ }

    try {
      const { data: knowledge } = await supabaseAdmin
        .from('chat_knowledge').select('scope, listing_id, content')
      if (knowledge?.length) {
        parts.push('WOHNUNGS-WISSEN (destilliert aus echten Gast-Antworten — WLAN, Check-in-Abläufe, Parken usw.):\n'
          + knowledge.map((k) => `### ${k.scope === 'global' ? 'Allgemein' : titleOf.get(k.listing_id) ?? 'Wohnung'}\n${(k.content ?? '').slice(0, 3000)}`).join('\n\n'))
      }
    } catch { /* Wissensbasis optional */ }
  } catch (e) {
    console.error('[team-bot] context failed:', e)
  }

  // Statisches Funktions-Handbuch — beantwortet „kann die App schon X?"
  parts.push(APP_HANDBOOK)

  const value = parts.join('\n\n')
  cache[key] = { at: Date.now(), value }
  return value
}

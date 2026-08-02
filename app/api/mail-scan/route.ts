import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runMailScan, peekMail, getGraphMailState, saveGraphMailState, graphConfigured } from '@/lib/graph-mail'

/**
 * 📥 Graph-Mail-Scan (§237) — der Postfach-Poller:
 *  GET  → Vercel-Cron alle 10 Min (Bearer CRON_SECRET); läuft nur, wenn
 *         der Schalter an ist (erst Setup + Kalibrierung).
 *  POST → Admin: { action: 'status' | 'peek' | 'scan' | 'enable' | 'mailboxes' }
 *         peek      = { hours } Mails NUR auflisten (Kalibrierung)
 *         scan      = { hours } einmalig scannen + verarbeiten
 *         enable    = { on: true|false }
 *         mailboxes = { list: ['fewo@trimosa.de', …] }
 */
export const maxDuration = 300
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  try {
    const state = await getGraphMailState()
    if (!state.enabled) return NextResponse.json({ skipped: 'Mail-Scan ist aus (erst Setup + action enable).' })
    const report = await runMailScan()
    // §243ad: Vorab-Analyse für Bestands-Belege ohne KI-Cache (max. 2 je
    // Lauf) — Kategorie/Steuer/Zahlungs-Match sind fertig, BEVOR der
    // Inhaber die /buchhaltung öffnet
    let vorab: { analysiert: number; offenOhneCache: number } | null = null
    try {
      const { vorabAnalyse } = await import('@/lib/beleg-ki')
      vorab = await vorabAnalyse(2)
    } catch { /* fail-soft */ }
    return NextResponse.json({ ...report, ...(vorab ? { vorabAnalyse: vorab } : {}) })
  } catch (err) {
    console.error('[mail-scan] cron:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  try {
    const b = await request.json().catch(() => ({}))
    if (b.action === 'status') {
      const state = await getGraphMailState()
      return NextResponse.json({ konfiguriert: graphConfigured(), ...state, processed: state.processed.length }, NO_STORE)
    }
    if (b.action === 'peek') {
      return NextResponse.json({ mails: await peekMail(typeof b.hours === 'number' ? b.hours : 24) }, NO_STORE)
    }
    if (b.action === 'scan') {
      // §241 Historien-Scan: { belegeOnly:true, from:'2026-01-01', to:'2026-02-01' }
      // — nur der Beleg-Fischer läuft, Cursor/processed bleiben unberührt
      const iso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : null
      return NextResponse.json(await runMailScan({
        ...(typeof b.hours === 'number' ? { hours: b.hours } : {}),
        ...(b.force === true ? { force: true } : {}),
        ...(b.belegeOnly === true ? { belegeOnly: true } : {}),
        ...(iso(b.from) ? { sinceIso: iso(b.from)! } : {}),
        ...(iso(b.to) ? { untilIso: iso(b.to)! } : {}),
      }), NO_STORE)
    }
    if (b.action === 'enable') {
      const state = await getGraphMailState()
      await saveGraphMailState({ ...state, enabled: b.on === true })
      return NextResponse.json({ enabled: b.on === true }, NO_STORE)
    }
    if (b.action === 'mailboxes') {
      const list = Array.isArray(b.list)
        ? b.list.map(String).map((s: string) => s.trim().toLowerCase()).filter((s: string) => /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(s)).slice(0, 10)
        : null
      if (!list) return NextResponse.json({ error: 'list fehlt (Array von Mail-Adressen).' }, { status: 400 })
      const state = await getGraphMailState()
      await saveGraphMailState({ ...state, mailboxes: list })
      return NextResponse.json({ mailboxes: list }, NO_STORE)
    }
    // §240-Diagnose: Gast-Nachrichten der Mail-Pipeline auflisten (haben
    // KEINE smoobu_message_id — echte Smoobu-Sync-Nachrichten schon)
    if (b.action === 'msg-audit') {
      const hours = typeof b.hours === 'number' ? Math.min(b.hours, 24 * 14) : 24
      const cutoff = new Date(Date.now() - hours * 3600_000).toISOString()
      const { data: msgs } = await supabaseAdmin
        .from('messages')
        .select('id, booking_id, content, content_de, lang, created_at')
        .eq('sender_type', 'guest').is('smoobu_message_id', null)
        .not('booking_id', 'is', null)
        .gte('created_at', cutoff).order('created_at', { ascending: false }).limit(50)
      const ids = [...new Set((msgs ?? []).map((m) => String(m.booking_id)))]
      const { data: bks } = ids.length
        ? await supabaseAdmin.from('bookings')
            .select('id, guest_name, check_in, check_out, status, channel, smoobu_reservation_id, listings(title)')
            .in('id', ids)
        : { data: [] }
      const bMap = new Map((bks ?? []).map((x) => [String(x.id), x]))
      return NextResponse.json({
        nachrichten: (msgs ?? []).map((m) => {
          const bk = bMap.get(String(m.booking_id)) as Record<string, unknown> | undefined
          const lst = bk?.listings as { title?: string } | { title?: string }[] | null | undefined
          return {
            messageId: m.id, erstellt: m.created_at, lang: m.lang,
            text: String(m.content ?? '').slice(0, 160),
            buchung: bk ? {
              id: bk.id, gast: bk.guest_name, status: bk.status, kanal: bk.channel,
              wohnung: (Array.isArray(lst) ? lst[0] : lst)?.title ?? null,
              zeitraum: `${bk.check_in} – ${bk.check_out}`,
              smoobuId: bk.smoobu_reservation_id,
            } : null,
          }
        }),
      }, NO_STORE)
    }
    if (b.action === 'msg-delete') {
      if (b.confirm !== 'DELETE') return NextResponse.json({ error: "Sicherung: { confirm: 'DELETE' } nötig." }, { status: 400 })
      // Sicherheit: NUR Mail-Pipeline-Zeilen (ohne smoobu_message_id) löschbar
      const { data: row } = await supabaseAdmin
        .from('messages').select('id, sender_type, smoobu_message_id')
        .eq('id', String(b.messageId ?? '')).maybeSingle()
      if (!row) return NextResponse.json({ error: 'Nachricht nicht gefunden.' }, { status: 404 })
      if (row.sender_type !== 'guest' || row.smoobu_message_id != null) {
        return NextResponse.json({ error: 'Nur Gast-Nachrichten der Mail-Pipeline (ohne Smoobu-ID) löschbar.' }, { status: 400 })
      }
      await supabaseAdmin.from('messages').delete().eq('id', row.id)
      return NextResponse.json({ ok: true, geloescht: row.id }, NO_STORE)
    }
    return NextResponse.json({ error: 'Unbekannte action.' }, { status: 400 })
  } catch (err) {
    console.error('[mail-scan] manual:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

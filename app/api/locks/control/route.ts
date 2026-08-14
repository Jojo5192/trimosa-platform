import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendPushToUser } from '@/lib/push'
import {
  getLocksOverview, getStaffCodes, getLockOpenLog, logLockOpen, openLock,
  type LockRef,
} from '@/lib/locks'

export const dynamic = 'force-dynamic'
// §265: GET lädt Health über 3 Provider-APIs (auf 8 s gedeckelt) — Luft lassen
export const maxDuration = 60
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }

/**
 * 🔑 Türschloss-Steuerung für die Team-App (§253).
 *
 * ÖFFNEN dürfen NUR Admins/Gastgeber + Mitarbeiter (Staff) — Dienstleister
 * (Provider) NICHT (die haben ihre eigenen Personen-Codes). Jede Öffnung
 * wird protokolliert UND als Info-Push an die anderen Chefs/Vanessa gemeldet
 * (Transparenz — niemand öffnet unbemerkt).
 *
 * GET  → Übersicht: Wohnungen + Schlösser + aktueller Gäste-Code + eigener
 *        Personen-Code + Öffnungs-Protokoll.  (?probe=1 = Sichtbarkeits-Check)
 * POST { listingId, lockId } → Schloss aufschließen.
 */

type Role = 'admin' | 'host' | 'staff' | 'provider' | null

async function auth(): Promise<{ userId: string; name: string; role: Role } | null> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin
    .from('profiles').select('display_name, is_admin, is_host, is_staff, is_provider')
    .eq('id', user.id).maybeSingle()
  if (!me) return null
  const role: Role = me.is_admin ? 'admin' : me.is_host ? 'host' : me.is_staff ? 'staff' : me.is_provider ? 'provider' : null
  const name = ((me.display_name ?? '').trim().split(/\s+/)[0]) || 'Team'
  return { userId: user.id, name, role }
}

/** Öffnen ist Admins/Hosts/Staff vorbehalten (nicht Provider). */
function mayOpen(role: Role): boolean {
  return role === 'admin' || role === 'host' || role === 'staff'
}

export async function GET(req: NextRequest) {
  const a = await auth()
  if (!a || !mayOpen(a.role)) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  if (req.nextUrl.searchParams.get('probe') === '1') return NextResponse.json({ ok: true }, NO_STORE)

  const [overview, staffCodes, log] = await Promise.all([
    // §265: Health (Akku/Online) nur hier für die Anzeige — der Öffnen-POST
    // validiert bewusst OHNE (blockiert nie auf den Provider-APIs)
    getLocksOverview({ withHealth: true }), getStaffCodes(), getLockOpenLog(),
  ])
  const myCode = staffCodes[a.userId] ?? null
  return NextResponse.json({
    wohnungen: overview,
    meinCode: myCode ? { code: myCode.code, listingIds: myCode.listingIds } : null,
    protokoll: log.slice(0, 40),
    canOpen: true,
  }, NO_STORE)
}

export async function POST(req: NextRequest) {
  const a = await auth()
  if (!a || !mayOpen(a.role)) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  let body: { listingId?: string; lockId?: string } = {}
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Ungültiger Body.' }, { status: 400 }) }
  const { listingId, lockId } = body
  if (!listingId || !lockId) return NextResponse.json({ error: 'listingId und lockId nötig.' }, { status: 400 })

  // Schloss gegen die echte Wohnungs-Konfiguration prüfen (kein Fremd-Öffnen)
  const overview = await getLocksOverview()
  const wohnung = overview.find((w) => w.listingId === listingId)
  const lock: LockRef | undefined = wohnung?.locks.find((l) => l.id === lockId)
  if (!wohnung || !lock) return NextResponse.json({ error: 'Schloss nicht gefunden.' }, { status: 404 })

  let ok = true
  let errMsg = ''
  try {
    await openLock(lock)
  } catch (e) {
    ok = false
    errMsg = String(e).slice(0, 200)
  }

  // Protokollieren (immer — auch Fehlversuche, fürs Audit)
  await logLockOpen({
    at: new Date().toISOString(), byId: a.userId, byName: a.name,
    listingId, title: wohnung.title, lockLabel: lock.label, ok,
  }).catch(() => {})

  // Transparenz-Push an die ANDEREN Öffnungs-Berechtigten (nicht den Öffner)
  if (ok) {
    try {
      const { data: team } = await supabaseAdmin
        .from('profiles').select('id')
        .or('is_admin.eq.true,is_host.eq.true,is_staff.eq.true')
      for (const p of team ?? []) {
        if (p.id === a.userId) continue
        await sendPushToUser(p.id, '🔓 Tür geöffnet', `${a.name} hat ${lock.label} (${wohnung.title}) aus der Ferne aufgeschlossen.`, '/team?tab=einstellungen', undefined, 'system')
          .catch(() => {})
      }
    } catch { /* fail-soft */ }
  }

  if (!ok) return NextResponse.json({ error: `Öffnen fehlgeschlagen: ${errMsg}` }, { status: 502 })
  return NextResponse.json({ ok: true }, NO_STORE)
}

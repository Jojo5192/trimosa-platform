import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendPushToTeam } from '@/lib/push'

/**
 * Team push subscriptions (chat PWA):
 *   GET    → VAPID public key (for pushManager.subscribe)
 *   POST   { subscription } → register this device
 *   DELETE { endpoint }     → unregister
 */
async function requireTeam() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // is_provider MIT: Dienstleister brauchen Push für interne Gruppen +
  // Aufgaben-Zuweisungen (§98) — vorher fehlte das Flag hier → „Nicht
  // berechtigt" beim Geräte-Aktivieren (Julia)
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff, is_provider').eq('id', user.id).maybeSingle()
  return (me?.is_admin || me?.is_host || me?.is_staff || me?.is_provider) ? user : null
}

export async function GET(request: Request) {
  const user = await requireTeam()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!key) return NextResponse.json({ error: 'Push ist noch nicht konfiguriert (VAPID-Keys fehlen).' }, { status: 501 })

  // Test trigger: /api/push?test=1 (logged-in team member in the browser)
  // sends a demo notification to EVERY subscribed team device.
  const url = new URL(request.url)
  if (url.searchParams.get('test') === '1') {
    const { count } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id', { count: 'exact', head: true })
    await sendPushToTeam('🔔 Test von TRIMOSA', 'Push-Benachrichtigungen funktionieren! 🎉 Genau so sehen Gast-Nachrichten aus.', '/team')
    return NextResponse.json({ ok: true, geraete: count ?? 0, hinweis: 'Test-Push an alle registrierten Team-Geräte gesendet.' })
  }

  // §223 Diagnose: /api/push?diag=1 — zeigt je registriertem Gerät, ob es
  // einem Team-Profil zugeordnet ist. Buchungs-Pushes gehen NUR an Geräte mit
  // user_id + Team-Rolle; Chat-Pushes an alle. Genau daran scheitert es, wenn
  // Chat-Pushes ankommen, Buchungs-Pushes aber nicht.
  if (url.searchParams.get('diag') === '1') {
    const { data: subs } = await supabaseAdmin
      .from('push_subscriptions').select('id, user_id, endpoint, created_at')
    const ids = [...new Set((subs ?? []).map((s) => s.user_id).filter(Boolean))] as string[]
    const { data: profs } = ids.length
      ? await supabaseAdmin.from('profiles').select('*').in('id', ids)
      : { data: [] }
    const byId = new Map((profs ?? []).map((p) => [p.id as string, p as Record<string, unknown>]))
    return NextResponse.json({
      geraete: (subs ?? []).map((s) => {
        const p = s.user_id ? byId.get(s.user_id) : null
        const rolle = p ? [p.is_admin && 'Admin', p.is_host && 'Gastgeber', p.is_staff && 'Mitarbeiter', p.is_provider && 'Dienstleister'].filter(Boolean).join('+') : null
        return {
          name: (p?.display_name as string) ?? (s.user_id ? '(Profil fehlt)' : '(keine user_id)'),
          rolle: rolle || '(keine Team-Rolle)',
          bekommtBuchungsPush: !!p && !!(p.is_admin || p.is_host || p.is_staff) && p.push_bookings !== false,
          pushBookings: p ? (p.push_bookings ?? true) : null,
          dienst: (s.endpoint as string ?? '').includes('web.push.apple.com') ? 'Apple' : 'andere',
          seit: (s.created_at as string ?? '').slice(0, 10),
        }
      }),
    })
  }

  return NextResponse.json({ publicKey: key })
}

export async function POST(request: Request) {
  const user = await requireTeam()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { subscription } = await request.json()
  const endpoint = subscription?.endpoint
  const p256dh = subscription?.keys?.p256dh
  const auth = subscription?.keys?.auth
  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return NextResponse.json({ error: 'Ungültige Subscription.' }, { status: 400 })
  }
  const { error } = await supabaseAdmin.from('push_subscriptions').upsert(
    { user_id: user.id, endpoint, p256dh, auth },
    { onConflict: 'endpoint' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const user = await requireTeam()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { endpoint } = await request.json()
  if (typeof endpoint !== 'string') return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}

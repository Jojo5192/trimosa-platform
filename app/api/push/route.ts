import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

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
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
  return (me?.is_admin || me?.is_host || me?.is_staff) ? user : null
}

export async function GET() {
  const user = await requireTeam()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!key) return NextResponse.json({ error: 'Push ist noch nicht konfiguriert (VAPID-Keys fehlen).' }, { status: 501 })
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

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * §265 Push-Historie: der zeitliche Verlauf der EIGENEN Push-Mitteilungen
 * (Pascal: „Historie, in der wir die Push Notifications abgebildet sehen …
 * anklicken und dann springe ich zu dem Punkt"). Geschrieben wird die
 * Historie zentral in lib/push.ts sendToSubs; aufgeräumt (30 Tage) im
 * täglichen 3:40-Locks-Cron.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff, is_provider').eq('id', user.id).maybeSingle()
  if (!(me?.is_admin || me?.is_host || me?.is_staff || me?.is_provider)) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('push_log')
      .select('id, created_at, title, body, url, category')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    return NextResponse.json({ entries: data ?? [] })
  } catch (e) {
    // Migration 20260814_push_log.sql fehlt noch → leere Historie statt Fehler
    console.error('[push-log]', e)
    return NextResponse.json({ entries: [], hinweis: 'Historie noch nicht eingerichtet (Migration ausstehend).' })
  }
}

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'
import { translateOutgoing } from '@/lib/translate'

/**
 * POST /api/ai/translate { text, targetLang } — translates a German team
 * reply into the guest's language for the send preview (team only).
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })

  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host && !me?.is_staff) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  }

  const allowed = await checkRateLimit(`ai-translate:${user.id}`, 60, 3600)
  if (!allowed) return NextResponse.json({ error: 'Zu viele Anfragen — bitte kurz warten.' }, { status: 429 })

  const { text, targetLang } = await request.json()
  if (typeof text !== 'string' || !text.trim() || typeof targetLang !== 'string' || !/^[a-z]{2}$/.test(targetLang)) {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }

  const translation = await translateOutgoing(text.trim(), targetLang)
  if (!translation) return NextResponse.json({ error: 'Übersetzung fehlgeschlagen.' }, { status: 502 })
  return NextResponse.json({ translation })
}

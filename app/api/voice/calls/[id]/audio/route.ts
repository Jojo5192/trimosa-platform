import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * ☎️🎧 §227c: Anruf-Audio zum Abhören — Proxy auf die ElevenLabs-
 * Conversations-API (Audio bleibt dort gespeichert, Aufbewahrung
 * unbegrenzt; wir streamen mit xi-api-key durch, der Key verlässt nie
 * den Server). Team-only.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host && !me?.is_staff) {
    return NextResponse.json({ error: 'Nicht berechtigt' }, { status: 403 })
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ELEVENLABS_API_KEY fehlt' }, { status: 503 })

  const { id } = await params
  const { data: call } = await supabaseAdmin
    .from('voice_calls').select('conversation_id').eq('id', id).maybeSingle()
  if (!call?.conversation_id) {
    return NextResponse.json({ error: 'Anruf nicht gefunden' }, { status: 404 })
  }

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(call.conversation_id)}/audio`,
    { headers: { 'xi-api-key': apiKey }, cache: 'no-store' },
  )
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `Kein Audio verfügbar (HTTP ${upstream.status})` },
      { status: upstream.status === 404 ? 404 : 502 },
    )
  }
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}

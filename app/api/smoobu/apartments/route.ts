import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const SMOOBU_BASE = 'https://login.smoobu.com/api'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })

  // API Key immer aus der profiles-Tabelle lesen
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('smoobu_api_key, smoobu_channel_id')
    .eq('id', user.id)
    .maybeSingle()

  const apiKey = profile?.smoobu_api_key
  if (!apiKey) {
    return NextResponse.json({ error: 'Kein Smoobu API Key hinterlegt', connected: false }, { status: 400 })
  }

  const res = await fetch(`${SMOOBU_BASE}/apartments`, {
    headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
    next: { revalidate: 300 },
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Smoobu API Fehler', status: res.status }, { status: res.status })
  }

  const data = await res.json()
  // Include connection info so callers can detect status without a separate request
  return NextResponse.json({
    ...data,
    apiKey,
    channelId: profile?.smoobu_channel_id ?? null,
    connected: true,
  })
}

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const SMOOBU_BASE = 'https://login.smoobu.com/api'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })

  // Use env key first, fall back to per-user metadata for backwards compatibility
  const apiKey = process.env.SMOOBU_API_KEY ?? user.user_metadata?.smoobu_api_key
  if (!apiKey) {
    return NextResponse.json({ error: 'Kein Smoobu API Key konfiguriert' }, { status: 400 })
  }

  const res = await fetch(`${SMOOBU_BASE}/apartments`, {
    headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
    next: { revalidate: 300 },
  })

  if (!res.ok) {
    return NextResponse.json(
      { error: 'Smoobu API Fehler', status: res.status },
      { status: res.status }
    )
  }

  const data = await res.json()
  return NextResponse.json(data)
}

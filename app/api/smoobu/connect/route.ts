import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateSmoobuApiKey, discoverChannelId } from '@/lib/smoobu'

/**
 * POST /api/smoobu/connect
 * Validates a Smoobu API key, discovers channel ID, and saves both to the host's profile.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { apiKey } = await request.json()
  if (!apiKey?.trim()) return NextResponse.json({ error: 'API Key fehlt' }, { status: 400 })

  // Validate key + get apartments
  const { valid, apartments } = await validateSmoobuApiKey(apiKey.trim())
  if (!valid) {
    return NextResponse.json({
      error: 'Ungültiger API Key. Bitte überprüfe den Key in Smoobu unter Einstellungen → API.',
    }, { status: 400 })
  }

  // Auto-discover the account-specific channel ID
  const channelId = await discoverChannelId(apiKey.trim())

  // Save to profiles table
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      smoobu_api_key: apiKey.trim(),
      ...(channelId ? { smoobu_channel_id: channelId } : {}),
    })
    .eq('id', user.id)

  if (error) {
    console.error('[SmoobuConnect] save error:', error)
    return NextResponse.json({ error: 'Speichern fehlgeschlagen' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    apartments,
    channelId,
    message: channelId
      ? `Verbunden! ${apartments.length} Unterkunft(en) gefunden. Channel-ID ${channelId} automatisch erkannt.`
      : `Verbunden! ${apartments.length} Unterkunft(en) gefunden. Bitte führe einen Sync durch, um die Channel-ID zu ermitteln.`,
  })
}

/**
 * DELETE /api/smoobu/connect
 * Removes Smoobu credentials from the host's profile.
 */
export async function DELETE() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  await supabaseAdmin
    .from('profiles')
    .update({ smoobu_api_key: null, smoobu_channel_id: null })
    .eq('id', user.id)

  return NextResponse.json({ ok: true })
}

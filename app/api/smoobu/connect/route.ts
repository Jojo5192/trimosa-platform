import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateSmoobuApiKey, discoverAvailableChannels } from '@/lib/smoobu'

/**
 * POST /api/smoobu/connect
 * Step 1: Validates API key and returns apartments + available channels for selection.
 * Step 2: If channelId is also provided, saves everything to the profile.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { apiKey, channelId } = await request.json()
  if (!apiKey?.trim()) return NextResponse.json({ error: 'API Key fehlt' }, { status: 400 })

  // Validate key + get apartments
  const { valid, apartments } = await validateSmoobuApiKey(apiKey.trim())
  if (!valid) {
    return NextResponse.json({
      error: 'Ungültiger API Key. Bitte überprüfe den Key in Smoobu unter Einstellungen → API.',
    }, { status: 400 })
  }

  // Fetch distinct channels from recent reservations (account-specific instance IDs)
  const channels = await discoverAvailableChannels(apiKey.trim())

  // Step 2: if channelId is provided, save everything
  if (channelId) {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ smoobu_api_key: apiKey.trim(), smoobu_channel_id: channelId })
      .eq('id', user.id)
    if (error) return NextResponse.json({ error: 'Speichern fehlgeschlagen' }, { status: 500 })
    return NextResponse.json({ ok: true, saved: true, apartments, channels })
  }

  // Step 1: return data for the host to choose a channel
  return NextResponse.json({ ok: true, saved: false, apartments, channels })
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

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

/**
 * ☎️✅ §247: „So wurde es gelöst" an einem Telefonat erfassen.
 *
 * PATCH { solution } — Team-only. Der Text hängt am Anruf (voice_calls)
 * und wird vom nächtlichen Lernlauf (lib/voice-learn, 4:40) in die
 * Telefon-Wissensbasis destilliert — auch wenn das Transkript längst
 * gelernt wurde (Auswahl dort über solution_at, nicht learned_at).
 * Leerer Text löscht die Lösung wieder.
 */
export async function PATCH(
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

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const solution = String(body?.solution ?? '').trim().slice(0, 2000)

  const { error } = await supabaseAdmin
    .from('voice_calls')
    .update({
      solution: solution || null,
      solution_by: solution ? user.id : null,
      solution_at: solution ? new Date().toISOString() : null,
    })
    .eq('id', id)

  if (error) {
    // Deploy-sicher: ohne Migration existieren die Spalten noch nicht
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, solution: solution || null })
}

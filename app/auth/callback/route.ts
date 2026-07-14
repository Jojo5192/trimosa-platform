import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Auth callback — Supabase redirects here after OAuth sign-in (Google/Apple)
 * and after e-mail links (password recovery). Exchanges the code for a
 * session, then redirects to `next`.
 *
 * Security: the role is NEVER taken from the query string (single-host —
 * public sign-ups are always guests; host/admin rights live in profiles and
 * are granted via /dashboard/admin only).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const rawNext = searchParams.get('next') ?? '/'
  // Only allow same-site relative paths as redirect target
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/'

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('[Auth Callback] exchangeCodeForSession error:', error.message)
      return NextResponse.redirect(`${origin}/login?error=oauth`)
    }

    const user = data.user
    if (user) {
      // First-time OAuth users have no role yet — force 'guest' (self-chosen
      // roles via query params were removed deliberately).
      if (!user.user_metadata?.role) {
        await supabase.auth.updateUser({ data: { role: 'guest', account_type: 'person' } })
      }

      // Ensure a profiles row exists (email/password sign-up creates it via
      // /api/auth/register — OAuth sign-ins arrive here without one).
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle()

      if (!profile) {
        const meta = user.user_metadata ?? {}
        const displayName: string =
          (meta.full_name as string)?.trim() ||
          (meta.name as string)?.trim() ||
          user.email?.split('@')[0] ||
          'Gast'
        const { error: profileError } = await supabaseAdmin.from('profiles').insert({
          id: user.id,
          display_name: displayName,
          account_type: 'person',
        })
        if (profileError) {
          console.error('[Auth Callback] profile creation failed:', profileError.message)
        }
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}`)
}

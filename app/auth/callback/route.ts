import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

/**
 * OAuth callback handler — Supabase redirects here after Google / Apple sign-in.
 * Configure in Supabase Dashboard → Auth → URL Configuration:
 *   Site URL:      https://trimosa-app.vercel.app
 *   Redirect URL:  https://trimosa-app.vercel.app/auth/callback
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'
  // Role passed from register page via redirectTo query param
  const role = searchParams.get('role') // 'guest' | 'host' | null

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('[OAuth Callback] exchangeCodeForSession error:', error.message)
      return NextResponse.redirect(`${origin}/login?error=oauth`)
    }

    // If role was passed (from register page), update user metadata
    if (role && data.user) {
      const existingRole = data.user.user_metadata?.role
      // Only set role if not already set (don't overwrite existing role on re-login)
      if (!existingRole) {
        await supabase.auth.updateUser({ data: { role } })
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}`)
}

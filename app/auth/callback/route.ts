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
  // Params passed from register page via redirectTo query param
  const role = searchParams.get('role')               // 'guest' | 'host' | null
  const accountType = searchParams.get('accountType') // 'person' | 'business' | null

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('[OAuth Callback] exchangeCodeForSession error:', error.message)
      return NextResponse.redirect(`${origin}/login?error=oauth`)
    }

    // Only set metadata if not already set (don't overwrite on re-login)
    if (data.user && !data.user.user_metadata?.role) {
      const update: Record<string, string> = {}
      if (role) update.role = role
      if (accountType) update.account_type = accountType
      if (Object.keys(update).length > 0) {
        await supabase.auth.updateUser({ data: update })
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}`)
}

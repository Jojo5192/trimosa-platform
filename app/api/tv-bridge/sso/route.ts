import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

/**
 * 📺 SSO-Absprung in den TV-Admin (tv.trimosa.de).
 *
 * Nur für eingeloggte Admins/Gastgeber. Erzeugt einen 60-Sekunden gültigen,
 * HMAC-signierten Token (mit demselben TV_BRIDGE_SECRET) und leitet zum
 * TV-Admin weiter — dort setzt /admin/sso die Session, kein zweites Passwort.
 * Muss byte-genau zur Python-Verifikation in admin.py:sso_login passen:
 *   sig = HMAC_SHA256("sso:<ts>", secret)  (hex)
 */
export async function GET() {
  const secret = process.env.TV_BRIDGE_SECRET
  if (!secret) {
    return NextResponse.redirect('https://tv.trimosa.de/admin/login', { status: 302 })
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login?next=/team', 'https://trimosa.de'), { status: 302 })
  }
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host) {
    return NextResponse.redirect('https://tv.trimosa.de/admin/login', { status: 302 })
  }

  const ts = Math.floor(Date.now() / 1000)
  const sig = crypto.createHmac('sha256', secret).update(`sso:${ts}`).digest('hex')
  const url = `https://tv.trimosa.de/admin/sso?ts=${ts}&sig=${sig}`
  return NextResponse.redirect(url, { status: 302 })
}

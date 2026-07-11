import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

async function requireAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 }) }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.is_admin) {
    return { error: NextResponse.json({ error: 'Nur Admins haben Zugriff.' }, { status: 403 }) }
  }
  return { user }
}

/** GET /api/admin/users — list current admins */
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const { data: admins } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, is_admin')
    .eq('is_admin', true)

  const withEmails = await Promise.all(
    (admins ?? []).map(async (a) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(a.id)
      return { id: a.id, display_name: a.display_name, email: data.user?.email ?? '' }
    })
  )

  return NextResponse.json({ admins: withEmails })
}

/** PATCH /api/admin/users — body: { email, is_admin } — grant/revoke admin by email */
export async function PATCH(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const { email, is_admin } = await req.json()
  if (!email || typeof is_admin !== 'boolean') {
    return NextResponse.json({ error: 'email und is_admin (boolean) sind erforderlich.' }, { status: 400 })
  }

  const { data: target } = await supabaseAdmin
    .schema('auth')
    .from('users')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()

  if (!target) {
    return NextResponse.json({ error: 'Kein Nutzer mit dieser E-Mail-Adresse registriert.' }, { status: 404 })
  }

  // Guard: never let the last admin remove themselves (or be removed) — that
  // would permanently lock everyone out of /api/settings and this page,
  // recoverable only via direct SQL access.
  if (!is_admin) {
    const { count } = await supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_admin', true)
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: 'Der letzte Admin kann nicht entfernt werden.' }, { status: 400 })
    }
  }

  const { error: updateError } = await supabaseAdmin
    .from('profiles')
    .update({ is_admin })
    .eq('id', target.id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

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

async function listByFlag(flag: 'is_admin' | 'is_host') {
  const { data: rows } = await supabaseAdmin
    .from('profiles')
    .select(`id, display_name, ${flag}`)
    .eq(flag, true)

  return Promise.all(
    (rows ?? []).map(async (r) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(r.id)
      return { id: r.id, display_name: r.display_name, email: data.user?.email ?? '' }
    })
  )
}

/** GET /api/admin/users — list current admins and hosts */
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const [admins, hosts] = await Promise.all([listByFlag('is_admin'), listByFlag('is_host')])
  return NextResponse.json({ admins, hosts })
}

/**
 * PATCH /api/admin/users
 * Body: { email, is_admin }  → grant/revoke admin
 *   or  { email, is_host }   → grant/revoke host (Gastgeber)
 */
export async function PATCH(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const body = await req.json()
  const email: string | undefined = body.email
  const hasAdmin = typeof body.is_admin === 'boolean'
  const hasHost = typeof body.is_host === 'boolean'

  if (!email || (!hasAdmin && !hasHost)) {
    return NextResponse.json({ error: 'email und is_admin oder is_host (boolean) sind erforderlich.' }, { status: 400 })
  }

  // auth.users isn't queryable via PostgREST — resolve the id through a
  // SECURITY DEFINER RPC (see 20260712_user_id_by_email.sql).
  const { data: targetId } = await supabaseAdmin
    .rpc('get_user_id_by_email', { p_email: email.trim().toLowerCase() })

  if (!targetId) {
    return NextResponse.json({ error: 'Kein Nutzer mit dieser E-Mail-Adresse registriert.' }, { status: 404 })
  }
  const target = { id: targetId as string }

  // ── Admin flag ──────────────────────────────────────────────
  if (hasAdmin) {
    // Guard: never let the last admin be removed — that would permanently
    // lock everyone out of /api/settings and this page, recoverable only
    // via direct SQL access.
    if (!body.is_admin) {
      const { count } = await supabaseAdmin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('is_admin', true)
      if ((count ?? 0) <= 1) {
        return NextResponse.json({ error: 'Der letzte Admin kann nicht entfernt werden.' }, { status: 400 })
      }
    }

    const { error: e } = await supabaseAdmin
      .from('profiles')
      .update({ is_admin: body.is_admin })
      .eq('id', target.id)
    if (e) return NextResponse.json({ error: e.message }, { status: 500 })
  }

  // ── Host flag ───────────────────────────────────────────────
  if (hasHost) {
    const { error: e } = await supabaseAdmin
      .from('profiles')
      .update({ is_host: body.is_host })
      .eq('id', target.id)
    if (e) return NextResponse.json({ error: e.message }, { status: 500 })

    // Keep user_metadata.role in sync so the existing navigation gates
    // (dashboard vs. guest area) route the user correctly. is_host in
    // profiles remains the authoritative, self-promotion-proof source;
    // user_metadata.role is only a routing hint. Merge onto existing
    // metadata so name/account_type aren't dropped.
    const { data: current } = await supabaseAdmin.auth.admin.getUserById(target.id)
    await supabaseAdmin.auth.admin.updateUserById(target.id, {
      user_metadata: { ...(current.user?.user_metadata ?? {}), role: body.is_host ? 'host' : 'guest' },
    })
  }

  return NextResponse.json({ ok: true })
}

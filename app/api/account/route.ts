import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * DELETE /api/account
 * Permanently deletes the currently logged-in user's account and all associated data.
 * Supabase cascades will remove profiles, bookings etc. depending on FK constraints.
 */
export async function DELETE() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  // Sign out the session before deleting so cookies are cleared
  await supabase.auth.signOut()

  // Delete via service-role admin (required — cannot self-delete via client SDK)
  const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id)
  if (error) {
    console.error('[DELETE /api/account] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

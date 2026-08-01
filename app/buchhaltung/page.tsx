import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import BuchhaltungClient from './BuchhaltungClient'

/**
 * 💶 BUCHHALTUNG (§242) — die Vollbild-Oberfläche: sevdesk komplett aus der
 * App bedienen. NUR ADMINS (bewusst enger als die Team-App — Finanzdaten).
 */
export const metadata = {
  title: 'Buchhaltung',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function BuchhaltungPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/buchhaltung')
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  if (!me?.is_admin) notFound()
  return <BuchhaltungClient />
}

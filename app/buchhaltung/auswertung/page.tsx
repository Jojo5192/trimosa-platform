import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import AuswertungClient from './AuswertungClient'

/**
 * 📊 AUSWERTUNG (§243ae) — der Statistik-Bereich der Buchhaltung:
 * Einnahmen, Ausgaben, Überschuss, Auslastung & Entwicklung mit Filtern
 * (Zeitraum / Wohnung / Konten-Gruppe). NUR ADMINS.
 */
export const metadata = {
  title: 'Auswertung',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function AuswertungPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/buchhaltung/auswertung')
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  if (!me?.is_admin) notFound()
  return <AuswertungClient />
}

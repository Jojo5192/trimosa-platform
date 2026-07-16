import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redirect, notFound } from 'next/navigation'
import TeamShell from '@/components/team/TeamShell'

/**
 * /team — die Team-App (PWA): Bottom-Tabs Chat · Aufgaben · Kalender.
 * team (admin|host|staff) sieht alles; Dienstleister (is_provider) sehen
 * nur Aufgaben + Kalender — keinen Chat.
 */
export const metadata = { title: 'TRIMOSA Team' }

export default async function TeamAppPage({ searchParams }: { searchParams: Promise<{ conv?: string; tab?: string }> }) {
  const { conv, tab } = await searchParams
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/team')

  // select('*') statt Spaltenliste: bricht nicht, falls is_provider (Migration
  // 20260716) noch nicht ausgeführt ist — Deploy-Reihenfolge egal.
  const { data: me } = await supabaseAdmin
    .from('profiles').select('*').eq('id', user.id).maybeSingle()

  const role = (me?.is_admin || me?.is_host || me?.is_staff)
    ? 'team' as const
    : me?.is_provider
    ? 'provider' as const
    : null
  if (!role) notFound()

  return (
    <main style={{ height: '100dvh', overflow: 'hidden', background: '#fff' }}>
      <TeamShell userId={user.id} role={role} initialConvId={conv ?? null} initialTab={tab} />
    </main>
  )
}

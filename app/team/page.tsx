import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redirect, notFound } from 'next/navigation'
import TeamShell from '@/components/team/TeamShell'
import StartCurtain from '@/components/team/StartCurtain'
import { cookies } from 'next/headers'
import { COOKIE_CURTAIN, COOKIE_SPRUCH, curtainDueOnLoad, greetingFor, pickSpruch } from '@/lib/start-curtain'

/**
 * /team — die Team-App (PWA): Reiter Heute · Inbox · Kalender · Aufgaben · Mehr.
 * team (admin|host|staff) sieht alles; Dienstleister (is_provider) sehen in
 * der Inbox nur Intern.
 * §281 Start-Vorhang: steht bei jedem Seitenaufruf schon im Server-HTML
 * (kein Aufblitzen der App), außer er lief in den letzten 10 Minuten
 * (Cookie tm-curtain). Begrüßung + Spruch werden HIER gewählt, damit Server-
 * HTML und Hydration identisch sind (Cookie tm-spruch = nie derselbe Spruch).
 */
export const metadata = { title: 'TRIMOSA Team' }

export default async function TeamAppPage({ searchParams }: { searchParams: Promise<{ conv?: string; tab?: string; chat?: string; task?: string }> }) {
  const { conv, tab, chat, task } = await searchParams
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

  const jar = await cookies()
  const lastCurtain = Number(jar.get(COOKIE_CURTAIN)?.value ?? 0) || null
  const showCurtain = curtainDueOnLoad(lastCurtain)
  const firstName = String(me?.display_name ?? '').trim().split(/\s+/)[0] || null
  const now = new Date()
  const greeting = greetingFor(now, firstName)
  const spruch = pickSpruch(now, jar.get(COOKIE_SPRUCH)?.value ?? null)

  return (
    <main style={{ height: '100dvh', overflow: 'hidden', background: '#f3f4f6' }}>
      <StartCurtain initialShow={showCurtain} firstName={firstName} initialGreeting={greeting} initialSpruch={spruch} />
      <TeamShell userId={user.id} role={role} initialConvId={conv ?? null} initialTab={tab} initialInternChatId={chat ?? null} initialTaskId={task ?? null} />
    </main>
  )
}

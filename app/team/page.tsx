import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdminOhneVorschau } from '@/lib/supabase-admin'
import { VORSCHAU_COOKIE, leseVorschauCookie, rollenAnwenden } from '@/lib/rollen-vorschau'
import { redirect, notFound } from 'next/navigation'
import TeamShell from '@/components/team/TeamShell'
import StartCurtain from '@/components/team/StartCurtain'
import { cookies } from 'next/headers'
import { COOKIE_CURTAIN, COOKIE_SPRUCH, cookieFor, curtainDueOnLoad, greetingFor, pickSpruch } from '@/lib/start-curtain'

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
  // 👀 Rollen-Vorschau (lib/rollen-vorschau.ts): hier bewusst die ECHTE Zeile lesen — nur so ist bekannt, dass
  // der Nutzer Chef ist (Umschalter unter „Mehr") — und die Vorschau danach selbst anwenden.
  const jar = await cookies()
  const { data: echt } = await supabaseAdminOhneVorschau
    .from('profiles').select('*').eq('id', user.id).maybeSingle()
  const darfVorschau = echt?.is_admin === true
  const cookieVorschau = leseVorschauCookie(jar.get(VORSCHAU_COOKIE)?.value)
  const vorschau = darfVorschau && cookieVorschau?.uid === user.id ? cookieVorschau : null
  const me = vorschau ? rollenAnwenden(echt, vorschau, user.id) : echt

  const role = (me?.is_admin || me?.is_host || me?.is_staff)
    ? 'team' as const
    : me?.is_provider
    ? 'provider' as const
    : null
  if (!role) notFound()

  const lastCurtain = Number(jar.get(cookieFor(COOKIE_CURTAIN, user.id))?.value ?? 0) || null
  const showCurtain = curtainDueOnLoad(lastCurtain)
  const firstName = String(me?.display_name ?? '').trim().split(/\s+/)[0] || null
  const now = new Date()
  const greeting = greetingFor(now, firstName)
  const spruch = pickSpruch(now, jar.get(cookieFor(COOKIE_SPRUCH, user.id))?.value ?? null)

  return (
    <main className="team-page" style={{ height: '100dvh', overflow: 'hidden' }}>
      <StartCurtain initialShow={showCurtain} firstName={firstName} initialGreeting={greeting} initialSpruch={spruch} userId={user.id} />
      <TeamShell userId={user.id} role={role} vorschau={vorschau?.rolle ?? null} darfVorschau={darfVorschau} initialConvId={conv ?? null} initialTab={tab} initialInternChatId={chat ?? null} initialTaskId={task ?? null} />
    </main>
  )
}

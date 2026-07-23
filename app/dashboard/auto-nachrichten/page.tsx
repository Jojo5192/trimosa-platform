import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redirect, notFound } from 'next/navigation'
import NavBar from '@/components/NavBar'
import DashboardNav from '@/components/DashboardNav'
import type { AutoMessage } from '@/lib/auto-messages'
import { getAutoSendEnabled } from '@/lib/auto-messages-engine'
import AutoMessagesBuilder, { type BuilderListing } from './AutoMessagesBuilder'

/**
 * 📨 /dashboard/auto-nachrichten — Auto-Nachrichten-Builder (§145):
 * Vorlagen anlegen, Auslöser/Text festlegen, live im Handy-Rahmen ansehen.
 * Der automatische Versand kommt als getrennter Schritt (Phase B).
 */
export default async function AutoNachrichtenPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
  if (!profile?.is_admin && !profile?.is_host) notFound()

  const { data: rows } = await supabaseAdmin
    .from('listings').select('id, title, check_in_time, check_out_time').eq('is_active', true).order('title')
  const listings: BuilderListing[] = (rows ?? []).map((l) => ({
    id: l.id as string,
    title: String(l.title ?? ''),
    checkin: (l.check_in_time as string | null) ?? '16:00',
    checkout: (l.check_out_time as string | null) ?? '10:00',
  }))

  let initial: AutoMessage[] = []
  let migrationMissing = false
  const { data: msgs, error } = await supabaseAdmin
    .from('auto_messages').select('*').order('sort').order('created_at')
  if (error) migrationMissing = true
  else initial = (msgs ?? []) as AutoMessage[]
  const sendEnabled = await getAutoSendEnabled()

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <NavBar />
      <DashboardNav />
      <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '32px 20px 80px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>
          Automatisierung
        </p>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111', margin: '0 0 6px' }}>📨 Auto-Nachrichten</h1>
        <p style={{ fontSize: '13.5px', color: '#777', margin: '0 0 24px', lineHeight: 1.6, maxWidth: 680 }}>
          Lege fest, welche Nachrichten deine Gäste automatisch bekommen — z. B. eine Willkommens-Nachricht nach der Buchung
          oder den Türcode am Anreisetag. Platzhalter wie <code>{'{vorname}'}</code> oder <code>{'{tuercode}'}</code> werden beim
          Versand mit den echten Buchungsdaten gefüllt, und jede Nachricht wird automatisch in die Sprache des Gasts übersetzt.
          Rechts siehst du live, wie sie beim Gast ankommt.
        </p>
        <AutoMessagesBuilder listings={listings} initial={initial} migrationMissing={migrationMissing} initialSendEnabled={sendEnabled} />
      </div>
    </main>
  )
}

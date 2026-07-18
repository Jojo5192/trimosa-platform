import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redirect, notFound } from 'next/navigation'
import NavBar from '@/components/NavBar'
import DashboardNav from '@/components/DashboardNav'
import { REGIONS } from '@/lib/regions'
import { parseGuide, type GuideCtx } from '@/lib/guide'
import MappeBuilder, { type BuilderListing } from './MappeBuilder'

/**
 * 📖 /dashboard/mappe — Gästemappen-Builder: Blöcke zusammenstellen,
 * live im Handy-Rahmen ansehen, speichern. Eine Mappe je Wohnung.
 */
export default async function MappePage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
  if (!profile?.is_admin && !profile?.is_host) notFound()

  const { data: rows } = await supabaseAdmin
    .from('listings').select('*').eq('is_active', true).order('title')

  const listings: BuilderListing[] = (rows ?? []).map((l) => {
    const rules: string[] = []
    if (l.rule_quiet_hours) rules.push(`🌙 Ruhezeiten: ${l.rule_quiet_start ?? '22:00'}–${l.rule_quiet_end ?? '07:00'} Uhr`)
    rules.push(l.rule_smoking_allowed ? '🚬 Rauchen erlaubt' : '🚭 Nichtraucher-Wohnung')
    rules.push(l.rule_pets_allowed ? '🐾 Haustiere willkommen' : '🐾 Keine Haustiere')
    if (!l.rule_events_allowed) rules.push('🎉 Keine Partys oder Veranstaltungen')
    const maxG = l.rule_max_guests ?? l.max_guests
    if (maxG) rules.push(`👥 Maximal ${maxG} Gäste`)
    if (typeof l.rule_additional_rules === 'string' && l.rule_additional_rules.trim()) {
      rules.push(`➕ ${l.rule_additional_rules.trim()}`)
    }
    const region = Object.entries(REGIONS).find(([, r]) =>
      typeof l.location === 'string' && l.location.includes(r.locationMatch)
    )
    const ctx: GuideCtx = {
      listingTitle: String(l.title ?? ''),
      address: l.address ?? null,
      lat: l.latitude ?? null,
      lon: l.longitude ?? null,
      checkIn: l.check_in_time ?? null,
      checkOut: l.check_out_time ?? null,
      rules,
      regionName: region ? region[1].name : null,
      regionSlug: region ? region[0] : null,
      regionClaim: region ? region[1].claim : null,
    }
    return { id: l.id as string, title: String(l.title ?? ''), blocks: parseGuide(l.guide), ctx }
  })

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <NavBar />
      <DashboardNav />
      <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '32px 20px 80px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>
          Gästemappe
        </p>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111', margin: '0 0 6px' }}>📖 Gästemappen-Builder</h1>
        <p style={{ fontSize: '13.5px', color: '#777', margin: '0 0 24px', lineHeight: 1.6, maxWidth: 640 }}>
          Stelle die digitale Mappe je Wohnung aus Bausteinen zusammen — rechts siehst du live, was der Gast sieht.
          Jeder Gast bekommt einen persönlichen Link, automatisch in seiner Sprache. Leere Bausteine erscheinen beim Gast nicht.
        </p>
        <MappeBuilder listings={listings} />
      </div>
    </main>
  )
}

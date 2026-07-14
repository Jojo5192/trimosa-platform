import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redirect, notFound } from 'next/navigation'
import NavBar from '@/components/NavBar'
import DashboardNav from '@/components/DashboardNav'
import { REGIONS } from '@/lib/regions'
import EmpfehlungenClient, { type KatalogGruppe } from './EmpfehlungenClient'

/**
 * /dashboard/empfehlungen — the three hosts pick destinations, restaurants
 * and Komoot tours from the travel-guide catalogue and attach a personal
 * comment. Shown publicly as a speech bubble with their face.
 */
export default async function EmpfehlungenPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.is_admin) notFound()

  // Catalogue from the static travel guide (serialisable plain objects)
  const gruppen: KatalogGruppe[] = Object.values(REGIONS).map((region) => {
    const seenTours = new Set<string>()
    const touren: { key: string; label: string }[] = []
    for (const t of [...(region.komootTours ?? []), ...region.pois.flatMap((p) => p.komootTours ?? [])]) {
      if (!seenTours.has(t.embedUrl)) {
        seenTours.add(t.embedUrl)
        touren.push({ key: t.embedUrl, label: t.title })
      }
    }
    return {
      region: region.name,
      pois: region.pois.map((p) => ({ key: p.slug, label: `${p.emoji} ${p.name}` })),
      kulinarik: (region.kulinarik ?? []).map((k) => ({ key: k.name, label: `${k.emoji} ${k.name}`, sub: k.art })),
      touren,
    }
  })

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <NavBar />
      <DashboardNav />

      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '32px 20px 80px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>
          Reiseführer
        </p>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111', margin: '0 0 8px' }}>Persönliche Empfehlungen</h1>
        <p style={{ fontSize: '13px', color: '#888', margin: '0 0 28px', lineHeight: 1.6 }}>
          Wähle Ausflugsziele, Restaurants oder Radtouren aus und schreibe deinen persönlichen
          Tipp dazu. Er erscheint auf der Website als Sprechblase mit deinem Profilbild —
          die empfohlenen Einträge bekommen einen goldenen Rahmen. Kurz und persönlich wirkt
          am besten (1–2 Sätze).
        </p>

        <EmpfehlungenClient gruppen={gruppen} />
      </div>
    </main>
  )
}

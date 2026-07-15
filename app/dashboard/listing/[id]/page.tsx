import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import Link from 'next/link'
import Image from 'next/image'
import ListingEditor from './ListingEditor'

export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Single-Host-Firma: jeder Team-Gastgeber/Admin darf jedes Inserat bearbeiten
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_host, is_admin').eq('id', user.id).maybeSingle()
  if (!me?.is_host && !me?.is_admin) redirect('/dashboard')

  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('*')
    .eq('id', id)
    .single()

  if (!listing) redirect('/dashboard')

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      {/* Mini-Nav */}
      <nav style={{ backgroundColor: '#fff', borderBottom: '1px solid #E5E5EA', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/">
          <Image src="/logo.png" alt="TRIMOSA" width={2924} height={354} style={{ height: '28px', width: 'auto' }} />
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Link href={`/listing/${id}`} style={{ fontSize: '12px', color: '#888', textDecoration: 'none' }} target="_blank">
            Vorschau ↗
          </Link>
          <Link href="/dashboard" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gold)', textDecoration: 'none' }}>
            ← Dashboard
          </Link>
        </div>
      </nav>

      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '32px 20px 80px' }}>
        <div style={{ marginBottom: '28px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }}>Inserat bearbeiten</p>
          <h1 style={{ fontSize: '26px', fontWeight: 700, color: '#111', margin: 0, letterSpacing: '-0.3px' }}>
            {listing.title}
          </h1>
          {listing.smoobu_id && (
            <p style={{ fontSize: '12px', color: '#BBB', margin: '4px 0 0' }}>
              Smoobu-ID {listing.smoobu_id} · Kalender & Preise werden automatisch synchronisiert
            </p>
          )}
        </div>

        <ListingEditor listing={listing} />
      </div>
    </div>
  )
}

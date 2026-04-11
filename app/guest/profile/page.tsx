import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redirect } from 'next/navigation'
import GuestProfileClient from './GuestProfileClient'

export default async function GuestProfilePage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Use supabaseAdmin so RLS never blocks us, and handle missing optional columns gracefully
  let profile: Record<string, unknown> | null = null

  // Try full select (including optional columns that might not exist yet)
  const { data: d1, error: e1 } = await supabaseAdmin
    .from('profiles')
    .select('display_name, avatar_url, bio, location, languages, guest_first_name, guest_last_name, guest_street, guest_city, guest_zip, guest_country, account_type, company_name, vat_id')
    .eq('id', user.id)
    .maybeSingle()

  if (e1) {
    // Optional columns (account_type / company_name / vat_id) probably don't exist yet
    console.warn('[ProfilePage] Full select failed, retrying minimal:', e1.message)
    const { data: d2, error: e2 } = await supabaseAdmin
      .from('profiles')
      .select('display_name, avatar_url, bio, location, languages, guest_first_name, guest_last_name, guest_street, guest_city, guest_zip, guest_country')
      .eq('id', user.id)
      .maybeSingle()
    if (e2) {
      console.error('[ProfilePage] Minimal select also failed:', e2.message)
    } else {
      profile = d2 as Record<string, unknown> | null
    }
  } else {
    profile = d1 as Record<string, unknown> | null
  }

  const accountType = (
    (profile?.account_type as string) ??
    user.user_metadata?.account_type ??
    'person'
  ) as 'person' | 'business'

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', padding: '32px 20px 80px' }}>
      <div style={{ marginBottom: '28px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#A8882A', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }}>Mein Konto</p>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#111', margin: 0 }}>Profil bearbeiten</h1>
      </div>
      <GuestProfileClient
        initialName={(profile?.display_name as string) ?? user.user_metadata?.name ?? ''}
        initialBio={(profile?.bio as string) ?? ''}
        initialLocation={(profile?.location as string) ?? ''}
        initialLanguages={(profile?.languages as string[]) ?? []}
        initialAvatarUrl={(profile?.avatar_url as string) ?? null}
        accountType={accountType}
        initialFirstName={(profile?.guest_first_name as string) ?? user.user_metadata?.firstName ?? ''}
        initialLastName={(profile?.guest_last_name as string) ?? user.user_metadata?.lastName ?? ''}
        initialCompanyName={(profile?.company_name as string) ?? user.user_metadata?.companyName ?? ''}
        initialVatId={(profile?.vat_id as string) ?? ''}
        initialStreet={(profile?.guest_street as string) ?? user.user_metadata?.street ?? ''}
        initialCity={(profile?.guest_city as string) ?? user.user_metadata?.city ?? ''}
        initialZip={(profile?.guest_zip as string) ?? user.user_metadata?.zip ?? ''}
        initialCountry={(profile?.guest_country as string) ?? user.user_metadata?.country ?? 'Deutschland'}
      />
    </div>
  )
}

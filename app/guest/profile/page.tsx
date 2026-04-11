import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import GuestProfileClient from './GuestProfileClient'

export default async function GuestProfilePage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url, bio, location, languages, guest_first_name, guest_last_name, guest_street, guest_city, guest_zip, guest_country')
    .eq('id', user.id)
    .maybeSingle()

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', padding: '32px 20px 80px' }}>
      <div style={{ marginBottom: '28px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#A8882A', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }}>Mein Konto</p>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#111', margin: 0 }}>Profil bearbeiten</h1>
      </div>
      <GuestProfileClient
        initialName={profile?.display_name ?? user.user_metadata?.name ?? ''}
        initialBio={profile?.bio ?? ''}
        initialLocation={profile?.location ?? ''}
        initialLanguages={profile?.languages ?? []}
        initialAvatarUrl={profile?.avatar_url ?? null}
        initialFirstName={profile?.guest_first_name ?? ''}
        initialLastName={profile?.guest_last_name ?? ''}
        initialStreet={profile?.guest_street ?? ''}
        initialCity={profile?.guest_city ?? ''}
        initialZip={profile?.guest_zip ?? ''}
        initialCountry={profile?.guest_country ?? 'Deutschland'}
      />
    </div>
  )
}

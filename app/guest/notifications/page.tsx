import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import GuestNotificationSettings from './GuestNotificationSettings'

export default async function GuestNotificationsPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('guest_notif_booking_confirmed, guest_notif_booking_cancelled, guest_notif_new_message, guest_notif_payment')
    .eq('id', user.id)
    .maybeSingle()

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '32px 20px 80px' }}>
      <div style={{ marginBottom: '28px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }}>Einstellungen</p>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#111', margin: 0 }}>Benachrichtigungen</h1>
        <p style={{ fontSize: '13px', color: '#888', margin: '4px 0 0' }}>Wähle, wann du eine E-Mail erhältst.</p>
      </div>
      <GuestNotificationSettings
        bookingConfirmed={profile?.guest_notif_booking_confirmed ?? true}
        bookingCancelled={profile?.guest_notif_booking_cancelled ?? true}
        newMessage={profile?.guest_notif_new_message ?? true}
        payment={profile?.guest_notif_payment ?? true}
      />
    </div>
  )
}

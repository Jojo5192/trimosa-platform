import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redirect } from 'next/navigation'
import NavBar from '@/components/NavBar'
import DashboardNav from '@/components/DashboardNav'
import NotificationSettings from './NotificationSettings'

export default async function NotificationsPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('notif_new_booking,notif_booking_cancelled,notif_new_message,notif_payment_received,notif_monthly_invoice')
    .eq('id', user.id)
    .single()

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <NavBar />
      <DashboardNav />

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '32px 20px 80px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>
          Einstellungen
        </p>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111', margin: '0 0 8px' }}>Benachrichtigungen</h1>
        <p style={{ fontSize: '13px', color: '#888', margin: '0 0 28px' }}>
          Wähle, für welche Ereignisse du eine E-Mail an <strong>{user.email}</strong> erhalten möchtest.
        </p>

        <NotificationSettings
          email={user.email ?? ''}
          initial={{
            notif_new_booking:      profile?.notif_new_booking      ?? true,
            notif_booking_cancelled: profile?.notif_booking_cancelled ?? true,
            notif_new_message:      profile?.notif_new_message      ?? true,
            notif_payment_received: profile?.notif_payment_received ?? true,
            notif_monthly_invoice:  profile?.notif_monthly_invoice  ?? true,
          }}
        />
      </div>
    </main>
  )
}

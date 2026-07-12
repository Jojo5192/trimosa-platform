import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redirect, notFound } from 'next/navigation'
import NavBar from '@/components/NavBar'
import DashboardNav from '@/components/DashboardNav'
import AdminUsersClient from './AdminUsersClient'

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.is_admin) notFound()

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <NavBar />
      <DashboardNav />

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '32px 20px 80px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>
          Einstellungen
        </p>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111', margin: '0 0 8px' }}>Admin-Verwaltung</h1>
        <p style={{ fontSize: '13px', color: '#888', margin: '0 0 28px' }}>
          Admins verwalten Einstellungen und Rollen. Gastgeber können Inserate anlegen und
          verwalten. Nur bereits registrierte Nutzer können zu Admins oder Gastgebern gemacht werden.
        </p>

        <AdminUsersClient />
      </div>
    </main>
  )
}

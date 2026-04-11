import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import NavBar from '@/components/NavBar'
import DashboardNav from '@/components/DashboardNav'
import ChatClient from './ChatClient'

export default async function ChatPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <NavBar />
      <DashboardNav />
      <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: '#AAA' }}>Lädt…</div>}>
        <ChatClient userId={user.id} />
      </Suspense>
    </main>
  )
}

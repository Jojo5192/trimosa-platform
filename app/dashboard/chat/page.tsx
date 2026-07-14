import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import NavBar from '@/components/NavBar'
import DashboardNav from '@/components/DashboardNav'
import ChatPanel from '@/components/chat/ChatPanel'

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ conv?: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const initialConvId = params.conv ?? null

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <NavBar />
      <DashboardNav />
      <ChatPanel variant="page" userId={user.id} initialConvId={initialConvId} />
    </main>
  )
}

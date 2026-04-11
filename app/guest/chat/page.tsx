import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import ChatClient from '@/app/dashboard/chat/ChatClient'

export default async function GuestChatPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '24px 20px 40px' }}>
      <div style={{ marginBottom: '20px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#A8882A', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>Nachrichten</p>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#111', margin: 0 }}>Chat</h1>
      </div>
      <ChatClient userId={user.id} />
    </div>
  )
}

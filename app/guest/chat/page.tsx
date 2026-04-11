import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import ChatClient from '@/app/dashboard/chat/ChatClient'

export default async function GuestChatPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: '#AAA' }}>Lädt…</div>}>
      <ChatClient userId={user.id} />
    </Suspense>
  )
}

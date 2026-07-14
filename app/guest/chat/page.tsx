import { createSupabaseServerClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import ChatPanel from '@/components/chat/ChatPanel'

export default async function GuestChatPage({
  searchParams,
}: {
  searchParams: Promise<{ conv?: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const initialConvId = params.conv ?? null

  return <ChatPanel variant="page" userId={user.id} initialConvId={initialConvId} />
}

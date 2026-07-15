import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redirect, notFound } from 'next/navigation'
import ChatPanel from '@/components/chat/ChatPanel'

/**
 * /team — the pure chat PWA shell: nothing but the unified inbox, full
 * height, no site chrome. This is the app the team pins to the homescreen.
 */
export const metadata = { title: 'TRIMOSA Team-Chat' }

export default async function TeamChatPage({ searchParams }: { searchParams: Promise<{ conv?: string }> }) {
  const { conv } = await searchParams
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/team')

  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host && !me?.is_staff) notFound()

  return (
    <main style={{ height: '100dvh', overflow: 'hidden', background: '#fff' }}>
      <ChatPanel variant="app" team userId={user.id} initialConvId={conv ?? null} />
    </main>
  )
}

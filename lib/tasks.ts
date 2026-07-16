/**
 * Shared auth for the tasks API: 'team' (admin|host|staff) sees and manages
 * everything, 'provider' (Dienstleister) only their own assigned tasks.
 */
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type TaskRole = { userId: string; role: 'team' | 'provider' }

export const TASK_PRIOS = ['hoch', 'mittel', 'niedrig']

export async function getTaskRole(): Promise<TaskRole | null> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // select('*'): robust auch vor Ausführung der is_provider-Migration
  const { data: me } = await supabaseAdmin
    .from('profiles').select('*').eq('id', user.id).maybeSingle()
  if (me?.is_admin || me?.is_host || me?.is_staff) return { userId: user.id, role: 'team' }
  if (me?.is_provider) return { userId: user.id, role: 'provider' }
  return null
}

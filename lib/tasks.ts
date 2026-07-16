/**
 * Shared auth + permissions for the tasks/calendar APIs.
 * Roles: admin|host (always full access) · staff · provider.
 * Staff/provider rights are ADMIN-CONFIGURABLE (app_settings 'task_permissions',
 * edited on /dashboard/admin): view 'all'|'own' and manage true|false.
 * Defaults: both see only their own tasks and cannot create/assign.
 */
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const TASK_PRIOS = ['hoch', 'mittel', 'niedrig']

export interface RolePerm { view: 'all' | 'own'; manage: boolean }
export interface TaskPermissions { staff: RolePerm; provider: RolePerm }

export const TASK_PERM_DEFAULTS: TaskPermissions = {
  staff: { view: 'own', manage: false },
  provider: { view: 'own', manage: false },
}

const g = globalThis as typeof globalThis & { __taskPermCache?: { at: number; value: TaskPermissions } }

export async function getTaskPermissions(): Promise<TaskPermissions> {
  const hit = g.__taskPermCache
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value
  let value = TASK_PERM_DEFAULTS
  try {
    const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'task_permissions').maybeSingle()
    const v = data?.value as Partial<TaskPermissions> | undefined
    if (v) {
      value = {
        staff: { ...TASK_PERM_DEFAULTS.staff, ...(v.staff ?? {}) },
        provider: { ...TASK_PERM_DEFAULTS.provider, ...(v.provider ?? {}) },
      }
    }
  } catch { /* Tabelle fehlt noch → Defaults */ }
  g.__taskPermCache = { at: Date.now(), value }
  return value
}

export function invalidateTaskPermCache() { g.__taskPermCache = undefined }

export interface TaskAuth {
  userId: string
  /** admin|host → 'admin'; is_staff → 'staff'; is_provider → 'provider' */
  role: 'admin' | 'staff' | 'provider'
  viewAll: boolean
  manage: boolean
  /** darf den Chat-Tab sehen (fürs /team-Routing) */
  chat: boolean
}

export async function getTaskAuth(): Promise<TaskAuth | null> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // select('*'): robust auch vor Ausführung der is_provider-Migration
  const { data: me } = await supabaseAdmin
    .from('profiles').select('*').eq('id', user.id).maybeSingle()
  if (!me) return null

  if (me.is_admin || me.is_host) {
    return { userId: user.id, role: 'admin', viewAll: true, manage: true, chat: true }
  }
  const perms = await getTaskPermissions()
  if (me.is_staff) {
    return { userId: user.id, role: 'staff', viewAll: perms.staff.view === 'all', manage: perms.staff.manage, chat: true }
  }
  if (me.is_provider) {
    return { userId: user.id, role: 'provider', viewAll: perms.provider.view === 'all', manage: perms.provider.manage, chat: false }
  }
  return null
}

/**
 * The TRIMOSA host team, DB-driven: every profile with is_host = true shows
 * up automatically with real display name + avatar (host badge on listing
 * pages, founders section on the about page). Falls back to the static trio
 * while the team profiles aren't registered yet. Cached in-process 5 min.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'

export interface HostMember {
  name: string        // full display name ("Pascal Junk")
  firstName: string   // "Pascal"
  initials: string    // "PJ"
  avatarUrl: string | null
}

const FALLBACK: HostMember[] = [
  { name: 'Johannes Görgen', firstName: 'Johannes', initials: 'JG', avatarUrl: null },
  { name: 'Pascal Junk', firstName: 'Pascal', initials: 'PJ', avatarUrl: null },
  { name: 'Dominik Palzer', firstName: 'Dominik', initials: 'DP', avatarUrl: null },
]

function toMember(displayName: string, avatarUrl: string | null): HostMember {
  const clean = (displayName || '').trim() || 'Gastgeber'
  const parts = clean.split(/\s+/)
  return {
    name: clean,
    firstName: parts[0],
    initials: parts.map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?',
    avatarUrl: avatarUrl || null,
  }
}

const g = globalThis as typeof globalThis & { __hostTeamCache?: { at: number; team: HostMember[] } }

export async function getHostTeam(): Promise<HostMember[]> {
  const hit = g.__hostTeamCache
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.team
  try {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('display_name, avatar_url, member_since')
      .eq('is_host', true)
      .order('member_since', { ascending: true })
    const team = (data ?? []).map((p) => toMember(p.display_name as string, p.avatar_url as string | null))
    const result = team.length >= 2 ? team : FALLBACK
    g.__hostTeamCache = { at: Date.now(), team: result }
    return result
  } catch {
    return FALLBACK
  }
}

/** "Johannes, Pascal & Dominik" */
export function teamFirstNames(team: HostMember[]): string {
  const names = team.map((m) => m.firstName)
  if (names.length <= 1) return names[0] ?? 'TRIMOSA'
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}

/**
 * 🤖 Claude als Team-Mitglied (Inhaber-Wunsch 19.07.): ein echtes, aber
 * LOGIN-LOSES Konto (Zufallspasswort, keine Rollen-Flags — taucht in keiner
 * Admin-/Zuweisungs-/Digest-Liste auf). Damit kann Claude über die Bot-Route
 * in internen Gruppen als eigenständiger Absender schreiben und erscheint in
 * Mitgliederlisten wie jede andere Person.
 */
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

const CLAUDE_EMAIL = 'claude-bot@trimosa.de'
const g = globalThis as typeof globalThis & { __claudeBotId?: string }

export async function getClaudeBotId(create = false): Promise<string | null> {
  if (g.__claudeBotId) return g.__claudeBotId
  try {
    const { data } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', 'claude_bot_id').maybeSingle()
    const id = (data?.value as { id?: string } | null)?.id
    if (id) { g.__claudeBotId = id; return id }
  } catch { /* noch nie angelegt */ }
  if (!create) return null

  let id: string | null = null
  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email: CLAUDE_EMAIL,
    email_confirm: true,
    password: randomUUID() + randomUUID(),
    user_metadata: { full_name: 'Claude', role: 'guest' },
  })
  if (!error && created?.user) {
    id = created.user.id
  } else {
    // Konto existiert bereits (z. B. app_settings-Eintrag verloren) → suchen
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    id = list?.users.find((u) => u.email === CLAUDE_EMAIL)?.id ?? null
  }
  if (!id) return null

  await supabaseAdmin.from('profiles').upsert({ id, display_name: 'Claude' })
  await supabaseAdmin.from('app_settings').upsert({
    key: 'claude_bot_id', value: { id }, updated_at: new Date().toISOString(),
  })
  g.__claudeBotId = id
  return id
}

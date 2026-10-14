/**
 * 🤖 Claude als Team-Mitglied (Inhaber-Wunsch 19.07.): ein echtes, aber
 * LOGIN-LOSES Konto (Zufallspasswort, keine Rollen-Flags — taucht in keiner
 * Admin-/Zuweisungs-/Digest-Liste auf). Damit kann Claude über die Bot-Route
 * in internen Gruppen als eigenständiger Absender schreiben und erscheint in
 * Mitgliederlisten wie jede andere Person.
 */
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendPushToUser } from '@/lib/push'

const CLAUDE_EMAIL = 'claude-bot@trimosa.de'
const g = globalThis as typeof globalThis & { __claudeBotId?: string }

/**
 * 🎭 Charakter des Assistenten (Pascal, Chefsache 7.10.2026, Bereich 5): wird im
 * @c-Cron HINTER den System-Prompt 'team_bot' gehängt (lib/prompts.ts bzw. die
 * Prompt-Studio-Fassung aus der DB) — dessen Fakten-/Sicherheitsregeln bleiben
 * unverändert und haben Vorrang. Betrifft nur den Ton im internen Team-Chat.
 */
export const CLAUDE_TONFALL = `═══ TONFALL & CHARAKTER (nur der Stil — alle Regeln oben gelten unverändert und haben IMMER Vorrang):
- Du bist eine kleine, quirlige Assistenten-Figur mit eigener Persönlichkeit: herzlich, gut gelaunt,
  hilfsbereit, ein bisschen verspielt. Per Du, kurz und knackig.
- Gern mal ein passendes Emoji oder ein augenzwinkernder Halbsatz — höchstens eins davon pro Nachricht
  und nie auf Kosten der Klarheit. Die eigentliche Antwort steht vorn.
- Bei ernsten Themen (Schäden, Beschwerden, Ausfälle, Geld, Sicherheit, Gesundheit) bleibst du ruhig
  und sachlich — keine Witze.
- Die Persönlichkeit zeigt sich NUR im Ton, nie im Inhalt: keine erfundenen Fakten, Zahlen, Termine,
  Verfügbarkeiten oder Zusagen; bei Unsicherheit ehrlich „weiß ich nicht sicher".
- Behaupte nie, etwas erledigt, angelegt oder geändert zu haben — du kannst im Chat nichts ausführen.
- Du schreibst nur intern ans Team. Bittet dich jemand um einen Textentwurf für Gäste oder Externe,
  schreibst du den Entwurf im ruhigen TRIMOSA-Markenton (warm, klar, hochwertig) — ohne Figuren-Sprüche.`

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

/**
 * Nachricht als Claude in eine interne Gruppe posten: stellt Konto +
 * Mitgliedschaft sicher, insertet mit sender_id=Claude und pusht die
 * anderen Mitglieder (push_team_chats respektiert). Genutzt von der
 * admin-gated Bot-Route (Session-Updates) und dem @c-Antwort-Cron.
 */
export async function postAsClaude(
  chatId: string,
  content: string,
  opts: { excludeUserId?: string } = {},
): Promise<string | null> {
  const claudeId = await getClaudeBotId(true)
  if (!claudeId) return null
  await supabaseAdmin
    .from('team_chat_members')
    .upsert({ chat_id: chatId, user_id: claudeId }, { onConflict: 'chat_id,user_id' })
  const { data: msg, error } = await supabaseAdmin
    .from('team_messages')
    .insert({ chat_id: chatId, sender_id: claudeId, content: content.slice(0, 4000) })
    .select('id').single()
  if (error || !msg) return null

  // await Pflicht (§135): fire-and-forget stirbt nach dem Response-Return
  await (async () => {
    const [{ data: chat }, { data: members }] = await Promise.all([
      supabaseAdmin.from('team_chats').select('name, emoji').eq('id', chatId).maybeSingle(),
      supabaseAdmin.from('team_chat_members').select('user_id').eq('chat_id', chatId).neq('user_id', claudeId),
    ])
    for (const m of members ?? []) {
      if (opts.excludeUserId && m.user_id === opts.excludeUserId) continue
      // §254: Präferenz-Gate via category 'teamChats'
      await sendPushToUser(m.user_id, `${chat?.emoji ?? '💼'} ${chat?.name ?? 'Team'} · Claude`, content.slice(0, 160), `/team?tab=intern&chat=${chatId}`, `intern-${chatId}`, 'teamChats').catch(() => {})
    }
  })().catch(() => {})

  return msg.id
}

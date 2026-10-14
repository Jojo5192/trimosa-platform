import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * 🔒 Zugriff auf einen Direkt-Chat (conversations-Welt), Sicherheitsprüfung 9.10.2026: /api/chat las und
 * schrieb Konversationen allein über die ID — jeder eingeloggte Nutzer (auch ein Gast) konnte fremde Chats
 * lesen, als gelesen markieren und hineinschreiben. Erlaubt sind jetzt nur Gast und Gastgeber der
 * Konversation sowie das Team (Admin, Gastgeber, Mitarbeiter — die Unified Inbox lässt jedes Team-Mitglied
 * antworten). Dienstleister sehen Gäste-Chats nie.
 */
export async function darfKonversation(
  conv: { host_id: string | null; guest_id: string | null } | null,
  userId: string,
): Promise<boolean> {
  if (!conv) return false
  if (conv.host_id === userId || conv.guest_id === userId) return true
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host, is_staff').eq('id', userId).maybeSingle()
  return !!(me?.is_admin || me?.is_host || me?.is_staff)
}

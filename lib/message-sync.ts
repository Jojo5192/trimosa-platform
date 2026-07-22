import { supabaseAdmin } from '@/lib/supabase-admin'
import { getReservationMessages, isSmoobuSystemMessage } from '@/lib/smoobu'
import { sendPushToTeam } from '@/lib/push'
import { translateIncoming, LANG_FLAGS } from '@/lib/translate'

export interface SyncTarget {
  id: string
  guest_name: string | null
  smoobu_reservation_id: number | string
  listingTitle?: string | null
}

/**
 * Synct die Smoobu-Nachrichten EINER Buchung in die booking-Welt der
 * messages-Tabelle (Dedupe über smoobu_message_id + Claim von Web-App-
 * Zwillingen) und pusht neue GAST-Nachrichten übersetzt ans Team.
 * Geteilt vom 10-Min-Poll-Cron (Sicherheitsnetz) und dem Smoobu-
 * newMessage-Webhook (Sofort-Zustellung, §131).
 */
export async function syncBookingMessages(b: SyncTarget): Promise<{ newMessages: number; pushes: number }> {
  let newMessages = 0
  let pushes = 0
  const msgs = await getReservationMessages(Number(b.smoobu_reservation_id))
  if (!msgs.length) return { newMessages, pushes }

  const ids = msgs.map((m) => String(m.id))
  const { data: known } = await supabaseAdmin
    .from('messages').select('smoobu_message_id').in('smoobu_message_id', ids)
  const knownSet = new Set((known ?? []).map((m) => m.smoobu_message_id))
  const newGuestMsgs: { id: string; text: string }[] = []
  for (const sm of msgs) {
    if (!sm.message?.trim() || knownSet.has(String(sm.id))) continue
    // Smoobu-Automatik-/Schloss-Protokolle NICHT in den Chat holen (§143)
    if (isSmoobuSystemMessage(sm.subject)) continue
    const isHost = ['2', 'owner', 'outgoing', 'host'].includes(String(sm.type ?? '').toLowerCase())
    // Zwillings-Claim für BEIDE Richtungen: Host-Nachrichten aus der Web-App
    // (POST speichert lokal ohne smoobu_message_id) UND Gast-Nachrichten aus
    // der FeWo-Mail-Pipeline (§129 saveGuestMessage — dieselbe Nachricht kann
    // danach auch über Smoobu ankommen). Statt Duplikat: lokale Zeile claimen.
    const { data: twin } = await supabaseAdmin
      .from('messages')
      .select('id')
      .eq('booking_id', b.id)
      .eq('sender_type', isHost ? 'host' : 'guest')
      .is('smoobu_message_id', null)
      .eq('content', sm.message.trim())
      .limit(1)
      .maybeSingle()
    if (twin) {
      await supabaseAdmin.from('messages').update({ smoobu_message_id: String(sm.id) }).eq('id', twin.id)
      continue
    }
    const { data: inserted, error } = await supabaseAdmin.from('messages').insert({
      booking_id: b.id,
      smoobu_message_id: String(sm.id),
      sender_type: isHost ? 'host' : 'guest',
      content: sm.message.trim(),
      created_at: sm.date || undefined,
    }).select('id').single()
    if (error || !inserted) continue
    newMessages++
    if (!isHost) newGuestMsgs.push({ id: inserted.id, text: sm.message.trim() })
  }

  // Translate new guest messages BEFORE pushing — the notification (and
  // the inbox preview, via the cached content_de) shows German, with the
  // guest's language as a flag. Fail-soft: untranslated original.
  if (newGuestMsgs.length) {
    const tr = await translateIncoming(newGuestMsgs)
    for (const g of newGuestMsgs) {
      const t = tr.get(g.id)
      const flag = t?.lang && t.lang !== 'de' ? `${LANG_FLAGS[t.lang] ?? '🌐'} ` : ''
      // ?conv=-Deep-Link: Tap landet im Thread, und der Tag (= URL) matcht
      // das Notification-Aufräumen beim Thread-Öffnen (§122)
      await sendPushToTeam(
        `💬 ${flag}${b.guest_name ?? 'Gast'}${b.listingTitle ? ` · ${b.listingTitle}` : ''}`,
        t?.german ?? g.text,
        '/team?conv=' + b.id,
        { guestChat: true },
      )
      pushes++
    }
  }
  return { newMessages, pushes }
}

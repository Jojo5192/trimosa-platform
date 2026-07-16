/**
 * Team web push (chat PWA). Sends a notification to every subscribed team
 * device; dead subscriptions (410/404) are pruned automatically. Requires
 * VAPID_PRIVATE_KEY + NEXT_PUBLIC_VAPID_PUBLIC_KEY in the environment.
 */
import webpush from 'web-push'
import { supabaseAdmin } from '@/lib/supabase-admin'

let configured = false
function ensureConfigured(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return false
  if (!configured) {
    webpush.setVapidDetails('mailto:mail@trimosa.de', pub, priv)
    configured = true
  }
  return true
}

type Sub = { id: string; endpoint: string; p256dh: string; auth: string }

async function sendToSubs(subs: Sub[], title: string, body: string, url: string): Promise<void> {
  const payload = JSON.stringify({ title, body: body.slice(0, 180), url })
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      )
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', s.id)
      } else {
        console.error('[push] send failed:', status, s.endpoint.slice(0, 60))
      }
    }
  }))
}

export async function sendPushToTeam(title: string, body: string, url = '/team'): Promise<void> {
  if (!ensureConfigured()) return
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
  if (!subs?.length) return
  await sendToSubs(subs, title, body, url)
}

/** Push to ONE user's devices (e.g. task assignment to a provider). */
export async function sendPushToUser(userId: string, title: string, body: string, url = '/team?tab=aufgaben'): Promise<void> {
  if (!ensureConfigured()) return
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (!subs?.length) return
  await sendToSubs(subs, title, body, url)
}

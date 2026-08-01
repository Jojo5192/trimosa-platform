import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { processInboundMail, stripHtml } from '@/lib/inbound-mail-core'

/**
 * 📬 Inbound-Mail-ZUBRINGER Nr. 1 (§127): Resend-Receiving-Webhook — Mails
 * kommen über Outlook-Umleiten-Regeln an die Inbound-Adresse. Dieser
 * Handler macht nur noch Signatur + Body-/Anhangs-Nachladen + Relay-Ernte;
 * die komplette Klassifikation lebt in lib/inbound-mail-core (geteilt mit
 * dem Graph-Poller §237, der die Postfächer DIREKT liest).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Svix-Signatur (Resend-Webhooks): HMAC-SHA256 über "id.timestamp.payload". */
function verifySvix(req: NextRequest, payload: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) return false
  const id = req.headers.get('svix-id')
  const ts = req.headers.get('svix-timestamp')
  const sigHeader = req.headers.get('svix-signature')
  if (!id || !ts || !sigHeader) return false
  // Replay-Schutz: Timestamp max. 5 Minuten alt
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${payload}`).digest('base64')
  return sigHeader.split(' ').some((part) => {
    const sig = part.split(',')[1] ?? ''
    try {
      const a = Buffer.from(sig, 'base64')
      const b = Buffer.from(expected, 'base64')
      return a.length === b.length && timingSafeEqual(a, b)
    } catch { return false }
  })
}

export async function POST(req: NextRequest) {
  const payload = await req.text()
  if (!process.env.RESEND_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'RESEND_WEBHOOK_SECRET fehlt (Vercel-Env).' }, { status: 503 })
  }
  if (!verifySvix(req, payload)) {
    return NextResponse.json({ error: 'Ungültige Signatur.' }, { status: 401 })
  }

  let body: Record<string, unknown> = {}
  try { body = JSON.parse(payload) } catch { return NextResponse.json({ error: 'Kein JSON.' }, { status: 400 }) }
  if (body.type !== 'email.received') return NextResponse.json({ ok: true, skipped: 'kein email.received' })

  const data = (body.data ?? {}) as Record<string, unknown>
  const from = String(data.from ?? '')
  const subject = String(data.subject ?? '')
  console.log('[inbound-mail] received:', { from: from.slice(0, 80), subject: subject.slice(0, 120), keys: Object.keys(data) })

  // Resend-Webhooks enthalten NUR Metadaten — der Mail-Body wird über die
  // Received-Emails-API nachgeladen (GET /emails/receiving/:email_id)
  let rawText = String(data.text ?? '') || stripHtml(String(data.html ?? ''))
  // Gast-RELAY-Adresse (FeWo/Vrbo-Mail-Bridge, §128): Bei „Umleiten"-Regeln
  // bleiben die Original-Header erhalten — Reply-To trägt die buchungs-
  // spezifische Adresse, über die Smoobu den Gast anschreiben kann
  let relayEmail = ''
  let attachments: unknown[] = Array.isArray(data.attachments) ? data.attachments : []
  const emailId = String(data.email_id ?? '')
  if (emailId && process.env.RESEND_API_KEY) {
    try {
      const r = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      })
      if (r.ok) {
        const full = await r.json() as Record<string, unknown>
        if (Array.isArray(full.attachments) && full.attachments.length) attachments = full.attachments
        if (rawText.trim().length < 80) {
          rawText = String(full.text ?? '') || stripHtml(String(full.html ?? ''))
          if (!rawText.trim()) console.error('[inbound-mail] Body-Nachladen leer — Keys:', Object.keys(full))
        }
        // Reply-To aus allen plausiblen Feldern einsammeln (Schema defensiv)
        const headers = (full.headers ?? {}) as Record<string, unknown>
        const replyRaw = [full.reply_to, full.replyTo, headers['reply-to'], headers['Reply-To'], full.from, data.from]
          .flat().filter(Boolean).map(String).join(' ')
        const m = replyRaw.match(/[\w.+-]+@messages\.homeaway\.com/i)
        if (m && !/^(sender|no-?reply)@/i.test(m[0])) relayEmail = m[0]
        console.log('[inbound-mail] reply-to-ernte:', { replyRaw: replyRaw.slice(0, 160), relayEmail: relayEmail || '—' })
      } else {
        console.error('[inbound-mail] Body-Nachladen HTTP', r.status)
      }
    } catch (e) {
      console.error('[inbound-mail] Body-Nachladen fehlgeschlagen:', e)
    }
  }

  const result = await processInboundMail({ from, subject, rawText, attachments, relayEmail })
  return NextResponse.json(result)
}

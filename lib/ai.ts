/**
 * Minimal server-side Claude API wrapper (plain fetch — no SDK dependency).
 * Used for host-facing writing help and, later, listing translations.
 * Requires ANTHROPIC_API_KEY in the environment (Vercel, sensitive).
 */

const MODEL = 'claude-sonnet-5'

export async function askClaude(system: string, user: string, maxTokens = 1500): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY ist nicht konfiguriert.')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('[ai] Claude API error:', res.status, detail.slice(0, 300))
    throw new Error(`KI-Anfrage fehlgeschlagen (${res.status}): ${detail.slice(0, 180)}`)
  }

  const data = await res.json()
  const text = (data?.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')
    .trim()
  if (!text) throw new Error('Leere KI-Antwort.')
  return text
}

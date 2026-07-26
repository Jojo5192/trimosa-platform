/**
 * Minimal server-side Claude API wrapper (plain fetch — no SDK dependency).
 * Used for host-facing writing help and, later, listing translations.
 * Requires ANTHROPIC_API_KEY in the environment (Vercel, sensitive).
 */

const MODEL = 'claude-sonnet-5'
export const FAST_MODEL = 'claude-haiku-4-5-20251001'
/**
 * 🧠 §211 Höchste Qualitätsstufe für SELTENE, anspruchsvolle Läufe
 * (Wissens-Destillate, Wochenbericht, Aufgaben-Vorschläge, Telefon-
 * Erkenntnisse). Bewusst NICHT für interaktive Pfade (✨-Vorschläge,
 * Formulierhilfe) und nie für Übersetzungen — dort zählt Tempo.
 * Per Env übersteuerbar, z. B. ANTHROPIC_SMART_MODEL=claude-sonnet-5
 * schaltet ohne Deploy zurück.
 */
export const SMART_MODEL = process.env.ANTHROPIC_SMART_MODEL || 'claude-opus-5'

/** Ist der Fehler ein „Modell gibt es (hier) nicht"-Fehler? */
function isModelUnavailable(err: unknown): boolean {
  const s = String(err)
  return /\((?:400|403|404)\)/.test(s) && /model/i.test(s)
}

/**
 * Text truncation (slice) can cut emoji surrogate pairs in half — a lone
 * surrogate makes the JSON body invalid and the API rejects it with 400
 * ("no low surrogate in string"). Strip lone halves before sending.
 */
function stripLoneSurrogates(s: string): string {
  return s
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
}

export async function askClaude(system: string, user: string, maxTokens = 1500, model: string = MODEL): Promise<string> {
  try {
    return await callClaude(system, user, maxTokens, model)
  } catch (err) {
    // Die SMART_MODEL-Läufe hängen an nächtlichen Crons — ein nicht
    // verfügbares Modell darf sie nicht ausfallen lassen (§211).
    if (model !== MODEL && isModelUnavailable(err)) {
      console.warn(`[ai] Modell ${model} nicht verfügbar → Rückfall auf ${MODEL}:`, String(err).slice(0, 160))
      return callClaude(system, user, maxTokens, MODEL)
    }
    throw err
  }
}

async function callClaude(system: string, user: string, maxTokens: number, model: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY ist nicht konfiguriert.')
  system = stripLoneSurrogates(system)
  user = stripLoneSurrogates(user)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
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
  if (!text) throw new Error(`Leere KI-Antwort (stop_reason: ${data?.stop_reason ?? '?'}).`)
  return text
}

/**
 * Wie askClaude, aber mit angehängter Datei (PDF als document-Block, Bilder
 * als image-Block) — z. B. Rechnungs-Analyse im Reinigungs-Kostenabgleich.
 */
export async function askClaudeWithFile(
  system: string,
  user: string,
  file: { mediaType: string; base64: string },
  maxTokens = 4000,
  model: string = MODEL,
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY ist nicht konfiguriert.')
  const fileBlock = file.mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.base64 } }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: stripLoneSurrogates(system),
      messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: stripLoneSurrogates(user) }] }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error('[ai] Claude file API error:', res.status, detail.slice(0, 300))
    throw new Error(`KI-Analyse fehlgeschlagen (${res.status}): ${detail.slice(0, 180)}`)
  }
  const data = await res.json()
  const text = (data?.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')
    .trim()
  if (!text) throw new Error(`Leere KI-Antwort (stop_reason: ${data?.stop_reason ?? '?'}).`)
  return text
}

/**
 * 🔎 §211 Modell-Probe: winziger Call, der meldet, ob ein Modell erreichbar
 * ist — und WELCHES Modell die API tatsächlich geantwortet hat (Feld `model`
 * der Antwort). Diagnose für die Admin-Action 'ai-model-test'.
 */
export async function probeModel(model: string): Promise<{ ok: boolean; model: string | null; antwort?: string; fehler?: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, model: null, fehler: 'ANTHROPIC_API_KEY fehlt' }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 2048,
        messages: [{ role: 'user', content: 'Antworte mit genau einem Wort: bereit' }],
      }),
    })
    const detail = await res.text()
    if (!res.ok) return { ok: false, model: null, fehler: `${res.status}: ${detail.slice(0, 200)}` }
    const data = JSON.parse(detail)
    const text = (data?.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text).join('').trim()
    return { ok: true, model: data?.model ?? null, antwort: text.slice(0, 80) }
  } catch (err) {
    return { ok: false, model: null, fehler: String(err).slice(0, 200) }
  }
}

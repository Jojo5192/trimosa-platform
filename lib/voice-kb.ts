import { supabaseAdmin } from '@/lib/supabase-admin'
import { parseGuide, blockForListing, type GuideBlock } from '@/lib/guide'

/**
 * ☎️📚 KB-Auto-Sync (§175 Phase 2b): hält die Wissensdatenbank der
 * ElevenLabs-Telefon-Assistentin automatisch aktuell — aus denselben
 * Quellen, die die App ohnehin pflegt:
 *   1. Wohnungs-Steckbriefe (listings-DB)
 *   2. chat_knowledge-Destillate (dieselbe Quelle wie der ✨-Chat)
 *   3. Gästemappen-Bausteine je Wohnung — SENSIBLE Inhalte GEFILTERT
 *      (WLAN-Passwörter und Türcode-Blöcke bleiben draußen; die gibt es
 *      am Telefon nur über das Verifizierungs-Tool).
 * Verwaltete Dokumente tragen das Namens-Präfix „[Auto] " — manuell in
 * ElevenLabs angelegte Dokumente werden nie angefasst.
 */

const EL_BASE = 'https://api.elevenlabs.io'
const AGENT_ID = process.env.ELEVENLABS_AGENT_ID ?? 'agent_1301kya169areasafmcmd58cft83'
const PREFIX = '[Auto] '

function elHeaders(): Record<string, string> {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new Error('ELEVENLABS_API_KEY ist nicht konfiguriert.')
  return { 'xi-api-key': key, 'Content-Type': 'application/json' }
}

/** Mappen-Baustein → Klartext fürs Telefon-Wissen (sensible Blöcke raus) */
function blockToText(b: GuideBlock): string | null {
  switch (b.type) {
    case 'heading': return `## ${b.text}`
    case 'text': return b.text
    case 'info': return `${b.title ? b.title + ': ' : ''}${b.text}`
    case 'warning': return `WICHTIG: ${b.text}`
    case 'steps': return [b.title, ...b.steps.map((s, i) => `${i + 1}. ${s}`)].filter(Boolean).join('\n')
    case 'wifi':
      // Passwort NIE — nur die Existenz + wo es steht
      return b.ssid ? `WLAN vorhanden (Netzwerk „${b.ssid}") — das Passwort steht in der persönlichen Gästemappe des Gasts.` : null
    case 'door': return null    // Türcode-Infos komplett draußen (nur via Verifizierung)
    default: return null        // contact/image/map/times/rules/region/chat → an anderer Stelle abgedeckt
  }
}

async function buildDocs(): Promise<{ name: string; text: string }[]> {
  const docs: { name: string; text: string }[] = []

  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('id, title, address, city, max_guests, check_in_time, check_out_time, description, guide')
    .eq('is_active', true)
    .order('title')
  const active = listings ?? []

  // ── 1. Steckbriefe ──
  const steck = active.map((l) => [
    `### ${l.title}`,
    l.address ? `Lage: ${l.address}` : (l.city ? `Lage: ${l.city}` : ''),
    l.max_guests ? `Bis zu ${l.max_guests} Gäste` : '',
    `Check-in ab ${String(l.check_in_time ?? '16:00').slice(0, 5)} Uhr (Self-Check-in mit Türcode), Check-out bis ${String(l.check_out_time ?? '10:00').slice(0, 5)} Uhr`,
    String(l.description ?? '').replace(/\s+/g, ' ').slice(0, 400),
  ].filter(Boolean).join('\n')).join('\n\n')
  docs.push({ name: `${PREFIX}Wohnungs-Steckbriefe`, text: `# TRIMOSA Wohnungen (automatisch aktualisiert)\n\n${steck}` })

  // ── 2. Chat-Wissensbasis (Destillate aus echten Gäste-Chats) ──
  try {
    const { data: know } = await supabaseAdmin
      .from('chat_knowledge').select('scope, listing_id, content')
    const titleOf = new Map(active.map((l) => [l.id, l.title]))
    const parts: string[] = []
    for (const k of know ?? []) {
      const label = k.scope === 'global' ? 'Allgemein' : (titleOf.get(k.listing_id) ?? null)
      if (!label || !k.content) continue
      parts.push(`## ${label}\n${String(k.content).slice(0, 6000)}`)
    }
    if (parts.length) {
      docs.push({
        name: `${PREFIX}Wissensbasis aus Gäste-Chats`,
        text: `# Destilliertes Wissen aus echten Gäste-Gesprächen (automatisch aktualisiert)\n\n${parts.join('\n\n')}`,
      })
    }
  } catch { /* fail-soft */ }

  // ── 3. Gästemappen-Infos (Pool §150; Fallback listings.guide) ──
  try {
    const { data: pool } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', 'guide_global').maybeSingle()
    const poolBlocks = parseGuide((pool?.value as { blocks?: unknown } | null)?.blocks)
    const parts: string[] = []
    for (const l of active) {
      let blocks = poolBlocks.filter((b) => blockForListing(b, l.id))
      if (!blocks.length) blocks = parseGuide(l.guide)
      const lines = blocks.map(blockToText).filter((t): t is string => !!t)
      if (lines.length) parts.push(`## ${l.title}\n${lines.join('\n\n').slice(0, 8000)}`)
    }
    if (parts.length) {
      docs.push({
        name: `${PREFIX}Gästemappen-Infos je Wohnung`,
        text: [
          '# Infos aus den digitalen Gästemappen (automatisch aktualisiert)',
          'Hinweis: WLAN-Passwörter und Türcodes stehen bewusst NICHT hier —',
          'sie werden nur nach Verifizierung genannt bzw. stehen in der Gästemappe.',
          '',
          parts.join('\n\n'),
        ].join('\n'),
      })
    }
  } catch { /* fail-soft */ }

  // ── 4. Telefon-Erkenntnisse (Phase 2b, §183): Destillat aus echten
  //      Anruf-Transkripten + den Erledigt-Lösungen der Anruf-Aufgaben ──
  try {
    const { data: pk } = await supabaseAdmin
      .from('app_settings').select('value').eq('key', 'voice_phone_knowledge').maybeSingle()
    const md = String((pk?.value as { md?: string } | null)?.md ?? '').trim()
    if (md) {
      docs.push({
        name: `${PREFIX}Telefon-Erkenntnisse`,
        text: `# Erkenntnisse aus bisherigen Telefonaten (automatisch aktualisiert)\n\n${md.slice(0, 20000)}`,
      })
    }
  } catch { /* fail-soft */ }

  return docs
}

interface KbEntry { type?: string; id: string; name?: string; usage_mode?: string }

export async function syncVoiceKb(): Promise<{ uploaded: number; removed: number; kept: number; debug?: unknown }> {
  const headers = elHeaders()

  // Aktuellen Agent-Stand lesen (bestehende KB-Liste inkl. manueller Docs)
  const agentRes = await fetch(`${EL_BASE}/v1/convai/agents/${AGENT_ID}`, { headers })
  if (!agentRes.ok) throw new Error(`Agent-GET HTTP ${agentRes.status}: ${(await agentRes.text()).slice(0, 300)}`)
  const agent = await agentRes.json()
  const current: KbEntry[] = agent?.conversation_config?.agent?.prompt?.knowledge_base ?? []
  const manual = current.filter((e) => !String(e.name ?? '').startsWith(PREFIX))
  const oldAuto = current.filter((e) => String(e.name ?? '').startsWith(PREFIX))

  // Neue Dokumente hochladen
  const docs = await buildDocs()
  const created: KbEntry[] = []
  for (const d of docs) {
    const res = await fetch(`${EL_BASE}/v1/convai/knowledge-base/text`, {
      method: 'POST', headers, body: JSON.stringify({ name: d.name, text: d.text }),
    })
    if (!res.ok) throw new Error(`KB-Upload „${d.name}" HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const j = await res.json()
    // Eintrags-Form der bestehenden Liste spiegeln (Feld-Formate variieren)
    const template = current[0] ?? { type: 'text' }
    created.push({ ...('usage_mode' in template ? { usage_mode: template.usage_mode } : {}), type: template.type ?? 'text', id: String(j.id), name: d.name })
  }

  // Agent auf manuelle + neue Auto-Dokumente setzen
  const patchRes = await fetch(`${EL_BASE}/v1/convai/agents/${AGENT_ID}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ conversation_config: { agent: { prompt: { knowledge_base: [...manual, ...created] } } } }),
  })
  if (!patchRes.ok) throw new Error(`Agent-PATCH HTTP ${patchRes.status}: ${(await patchRes.text()).slice(0, 300)}`)

  // Alte Auto-Dokumente aufräumen (best effort — erst NACH dem Umhängen)
  let removed = 0
  for (const e of oldAuto) {
    try {
      const del = await fetch(`${EL_BASE}/v1/convai/knowledge-base/${e.id}`, { method: 'DELETE', headers })
      if (del.ok) removed++
    } catch { /* noop */ }
  }

  return { uploaded: created.length, removed, kept: manual.length }
}

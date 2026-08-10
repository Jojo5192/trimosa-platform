import { NextRequest, NextResponse } from 'next/server'
import { askClaude, FAST_MODEL } from '@/lib/ai'
import { sendPushToTeam } from '@/lib/push'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * 📺 TV-Bridge — Gegenstelle für den TRIMOSA-TV-Server (tv.trimosa.de, Hetzner).
 *
 * Der TV-Server authentifiziert sich mit dem gemeinsamen Geheimnis
 * TV_BRIDGE_SECRET (Vercel-Env) == TRIMOSA_BRIDGE_SECRET (TV-.env) und nutzt:
 *   - action 'chat':  KI-Aufrufe (Übersetzung/Umformulieren) über den zentralen
 *                     Anthropic-Key → der TV braucht keinen eigenen OpenAI-Key mehr.
 *   - action 'alert': Push an die TRIMOSA-Admins (Server-/Box-Probleme).
 *
 * Es gibt bewusst KEINE Gäste-/Buchungsdaten hier — nur diese beiden Aktionen.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.TV_BRIDGE_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'Bridge nicht konfiguriert' }, { status: 503 })
  }
  const auth = req.headers.get('authorization') || ''
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Nicht berechtigt' }, { status: 401 })
  }

  let p: { action?: string; system?: string; user?: string; max_tokens?: number; title?: string; body?: string; url?: string | null } = {}
  try {
    p = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Ungültiger Body' }, { status: 400 })
  }

  if (p.action === 'chat') {
    const system = (p.system || '').slice(0, 8000)
    const user = (p.user || '').slice(0, 20000)
    if (!user.trim()) return NextResponse.json({ ok: false, error: 'user leer' }, { status: 400 })
    const maxTokens = Math.min(Math.max(p.max_tokens || 3000, 100), 8000)
    try {
      // FAST_MODEL (Haiku) — Übersetzungen/Umformulieren, Tempo zählt, spottbillig.
      const text = await askClaude(system, user, maxTokens, FAST_MODEL)
      return NextResponse.json({ ok: true, text })
    } catch (e) {
      return NextResponse.json({ ok: false, error: `KI-Fehler: ${e}` }, { status: 502 })
    }
  }

  if (p.action === 'alert') {
    const title = (p.title || '📺 TV-System').slice(0, 80)
    const alertBody = (p.body || '').slice(0, 300)
    // Ziel-URL: interne /team-URLs erlaubt, sonst neutral auf /team.
    const url = p.url && p.url.startsWith('/') ? p.url : '/team'
    try {
      // Ohne opts → an alle Team-Geräte (Admins/Hosts/Staff). TV-Ausfälle sind
      // selten und wichtig; keine Filterung über Gäste-Chat-Präferenzen.
      await sendPushToTeam(title, alertBody || title, url)
      return NextResponse.json({ ok: true })
    } catch (e) {
      return NextResponse.json({ ok: false, error: `Push-Fehler: ${e}` }, { status: 502 })
    }
  }

  return NextResponse.json({ ok: false, error: `Unbekannte action: ${p.action}` }, { status: 400 })
}

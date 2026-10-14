'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AssistentAvatar } from '@/components/team/AssistentFigur'
import {
  BOT_NAME, WARTE_LANG_MS, WARTE_MAX_MS, WARTE_THEMA_MS,
  offeneBotFrage, warteStufe, warteText, type BotChatMsg,
} from '@/lib/assistent-logik'

/**
 * 💬 Warte-Anzeige des KI-Assistenten (Pascal, Chefsache 7.10.2026, Bereich 8):
 * Steht im Verlauf eine @c-Frage ohne Bot-Antwort, zeigt der Thread sofort eine
 * Claude-Blase mit drei Punkten, nach 1,5 s einen Themen-Satz („Ich schaue in den
 * Kalender …"), nach 8 s „Dauert einen Moment …". Kommt die echte Antwort (der
 * minütliche @c-Cron postet sie als Claude), verschwindet die Blase von selbst;
 * nach 3 Min. bleibt nur ein dezenter Hinweis. Rein clientseitig — nichts in der DB.
 * Die Frage wird aus dem Verlauf abgeleitet: so greift die Anzeige für Text,
 * Bild mit Bildunterschrift und bei allen Gruppen-Mitgliedern gleich.
 */

const CSS = `
.tm-ass-dots { display: inline-flex; align-items: center; gap: 4px; height: 18px; }
.tm-ass-dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--tm-muted); opacity: 0.35; animation: tmAssDot 1.2s ease-in-out infinite; }
.tm-ass-dots i:nth-child(2) { animation-delay: 0.18s; }
.tm-ass-dots i:nth-child(3) { animation-delay: 0.36s; }
@keyframes tmAssDot { 0%, 60%, 100% { opacity: 0.35; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
.tm-ass-satz { animation: tmAssIn 0.25s ease both; }
@keyframes tmAssIn { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .tm-ass-dots i { animation: none; opacity: 0.6; }
  .tm-ass-satz { animation: none; }
}
`

const NUR_VORLESEN: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
}

export default function AssistentWarteBlase({ msgs, botId }: {
  msgs: BotChatMsg[]
  /** ID des Bot-Kontos (GET /api/team-chat → botId); ohne ID Rückfall über den Namen */
  botId: string | null
}) {
  const frage = useMemo(() => offeneBotFrage(msgs, botId), [msgs, botId])
  const frageId = frage?.id ?? null
  const frageAm = frage?.createdAt ?? null
  // Wie lange die Frage schon wartet — nur über Timer gesetzt (keine Uhr im Render)
  const [stand, setStand] = useState<{ id: string; ms: number; live: boolean } | null>(null)

  useEffect(() => {
    if (!frageId || !frageAm) return
    const jetzt = Date.now()
    const gesendet = Date.parse(frageAm)
    // Start = Sendezeit; geht das Gerät hinter der Serveruhr, nicht in der Zukunft starten
    const start = Number.isFinite(gesendet) ? Math.min(gesendet, jetzt) : jetzt
    // Nur Fragen, die beim ersten Sehen noch jung sind (alte, nie beantwortete
    // @c-Fragen zeigen beim späteren Öffnen der Gruppe nichts an)
    const live = jetzt - start < WARTE_MAX_MS
    const zeige = () => setStand({ id: frageId, ms: Date.now() - start, live })
    const timer = [setTimeout(zeige, 0)]
    if (live) {
      for (const ab of [WARTE_THEMA_MS, WARTE_LANG_MS, WARTE_MAX_MS]) {
        const rest = ab - (jetzt - start)
        if (rest > 0) timer.push(setTimeout(zeige, rest + 30))
      }
    }
    return () => timer.forEach(clearTimeout)
  }, [frageId, frageAm])

  const sichtbar = !!frage && !!stand && stand.id === frage.id && stand.live
  const stufe = sichtbar ? warteStufe(stand.ms) : null

  // Mitlaufen: ist der Feed (Eltern-Scroller) unten, die Blase ins Bild holen —
  // sie erscheint einen Takt nach der Frage und wächst mit dem Themen-Satz
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!stufe) return
    const el = ref.current
    const feed = el?.parentElement
    if (!el || !feed) return
    const abstand = feed.scrollHeight - feed.scrollTop - feed.clientHeight
    if (abstand < el.offsetHeight + 160) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [stufe])

  if (!frage || !stand || !sichtbar || !stufe) return null
  const text = warteText(frage, stand.ms)

  // Ein und dieselbe Live-Region über alle Stufen — Screenreader lesen jeden Wechsel vor
  return (
    <div
      ref={ref} role="status" aria-live="polite"
      style={stufe === 'aus'
        ? { fontSize: 12, lineHeight: 1.4, color: 'var(--tm-muted)', margin: '0 0 8px 34px' }
        : { display: 'flex', gap: 8, justifyContent: 'flex-start', alignItems: 'flex-end', marginBottom: 8 }}
    >
      {stufe === 'aus' ? text : (
        <>
          <style href="tm-assistent-warten" precedence="default">{CSS}</style>
          <AssistentAvatar size={26} />
          <div style={{ maxWidth: '76%' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--tm-accent-dark)', margin: '0 0 2px 4px' }}>{BOT_NAME}</div>
            <div className="imsg-tail-in" style={{ position: 'relative' }}>
              <div style={{
                borderRadius: 18, padding: '8px 13px', background: 'var(--tm-surface2)', color: 'var(--tm-text)',
                display: 'flex', alignItems: 'center', gap: 9, minHeight: 36, boxSizing: 'border-box',
              }}>
                <span className="tm-ass-dots" aria-hidden="true"><i /><i /><i /></span>
                {text
                  ? <span key={text} className="tm-ass-satz" style={{ fontSize: 14, lineHeight: 1.4, color: 'var(--tm-muted)' }}>{text}</span>
                  : <span style={NUR_VORLESEN}>tippt …</span>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

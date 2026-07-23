'use client'

/**
 * "✨ Formulieren" helper under a listing-editor text field: sends the current
 * text (plus grounding facts) to /api/ai/polish and shows the suggestion in a
 * gold preview box with accept/discard. Never writes into the field directly —
 * the host always confirms.
 */
import { useState } from 'react'

interface Props {
  field: string
  text: string
  context?: Record<string, string | number>
  onAccept: (text: string) => void
}

export default function AiPolishButton({ field, text, context, onAccept }: Props) {
  const [busy, setBusy] = useState(false)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [error, setError] = useState('')
  // §158: optionale Anweisung („kürzer und lockerer", „erwähne den Parkplatz")
  const [instruction, setInstruction] = useState('')

  async function run() {
    setBusy(true)
    setError('')
    setSuggestion(null)
    try {
      const res = await fetch('/api/ai/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, text, context, ...(instruction.trim() ? { instruction: instruction.trim() } : {}) }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'KI-Fehler.'); return }
      setSuggestion(data.suggestion)
    } catch {
      setError('Verbindung zur KI fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: '6px' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={run} disabled={busy} style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0,
          padding: '5px 12px', borderRadius: '999px', cursor: busy ? 'wait' : 'pointer',
          border: '1px solid #E8D9A0', background: '#FDFAF0',
          fontSize: '11.5px', fontWeight: 700, color: 'var(--gold-dark)',
          opacity: busy ? 0.6 : 1,
        }}>
          {busy ? '✨ Claude schreibt…' : instruction.trim() ? '✨ Anweisung umsetzen' : text.trim() ? '✨ Mit KI verbessern' : '✨ Entwurf schreiben lassen'}
        </button>
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!busy) run() } }}
          placeholder="Anweisung (optional), z. B. kürzer und lockerer…"
          style={{
            flex: '1 1 200px', minWidth: 0, borderRadius: 999, border: '1px solid #E5E1D6',
            padding: '5px 12px', fontSize: '11.5px', color: '#555', outline: 'none',
            fontFamily: 'inherit', background: '#fff',
          }}
        />
      </div>
      {error && <p style={{ fontSize: '11px', color: '#DC2626', margin: '6px 0 0' }}>{error}</p>}

      {suggestion && (
        <div style={{
          marginTop: '8px', borderRadius: '12px', border: '1.5px solid var(--gold)',
          background: 'linear-gradient(135deg, #FDF9EE, #FAF3DD)', padding: '12px 14px',
        }}>
          <p style={{ fontSize: '10px', fontWeight: 800, color: 'var(--gold-dark)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 6px' }}>
            ✨ Vorschlag
          </p>
          <p style={{ fontSize: '13px', color: '#3A3427', lineHeight: 1.6, margin: '0 0 10px', whiteSpace: 'pre-wrap' }}>{suggestion}</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={() => { onAccept(suggestion); setSuggestion(null) }} style={{
              padding: '7px 16px', borderRadius: '999px', border: 'none',
              background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
              color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
            }}>Übernehmen</button>
            <button type="button" onClick={run} disabled={busy} style={{
              padding: '7px 14px', borderRadius: '999px', border: '1px solid #E0DDD6',
              background: '#fff', color: '#666', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            }}>↻ Neu</button>
            <button type="button" onClick={() => setSuggestion(null)} style={{
              padding: '7px 14px', borderRadius: '999px', border: '1px solid #E0DDD6',
              background: '#fff', color: '#999', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            }}>Verwerfen</button>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

/**
 * Prompt-Studio (admin): view/edit the AI system prompts, let Claude rewrite
 * them from an instruction, reset to the code default.
 */
import { useEffect, useState, useCallback } from 'react'

interface PromptRow { key: string; label: string; content: string; isCustom: boolean; default: string }

export default function PromptStudio() {
  const [prompts, setPrompts] = useState<PromptRow[]>([])
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/ai/knowledge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'prompts-list' }),
    })
    if (res.ok) setPrompts((await res.json()).prompts ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  async function act(action: string, extra: Record<string, string>) {
    setBusy(true); setMsg('')
    const res = await fetch('/api/ai/knowledge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, key: openKey, ...extra }),
    })
    const data = await res.json()
    setBusy(false)
    if (!res.ok) { setMsg('Fehler: ' + (data.error ?? res.status)); return null }
    return data
  }

  return (
    <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #E8E6E0', padding: '20px', marginTop: '24px' }}>
      <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: '0 0 6px' }}>🎛️ Prompt-Studio</h2>
      <p style={{ fontSize: '12.5px', color: '#888', margin: '0 0 14px', lineHeight: 1.6 }}>
        Die Anweisungen hinter den KI-Funktionen — hier einsehen, direkt bearbeiten oder
        von Claude nach deinen Wünschen umschreiben lassen. Änderungen wirken sofort.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {prompts.map((p) => {
          const open = openKey === p.key
          return (
            <div key={p.key} style={{ border: open ? '1.5px solid var(--gold)' : '1px solid #E8E6E0', borderRadius: '12px' }}>
              <button type="button" onClick={() => { setOpenKey(open ? null : p.key); setDraft(p.content); setInstruction(''); setMsg('') }} style={{
                width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '11px 14px', border: 'none', background: 'none', cursor: 'pointer',
              }}>
                <span style={{ fontSize: '13.5px', fontWeight: 600, color: '#1D1D1F' }}>{p.label}</span>
                <span style={{ fontSize: '11px', fontWeight: 700, color: p.isCustom ? 'var(--gold-dark)' : '#B5B0A6' }}>
                  {p.isCustom ? 'angepasst' : 'Standard'}{open ? ' ▲' : ' ▼'}
                </span>
              </button>
              {open && (
                <div style={{ padding: '0 14px 13px' }}>
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10} style={{
                    width: '100%', boxSizing: 'border-box', borderRadius: '10px', border: '1.5px solid #D2D2D7',
                    padding: '10px 12px', fontSize: '12px', fontFamily: 'ui-monospace, monospace', lineHeight: 1.5,
                    color: '#1D1D1F', resize: 'vertical', outline: 'none', background: '#FAFAF8',
                  }} />
                  <div style={{ display: 'flex', gap: 8, margin: '8px 0', alignItems: 'center' }}>
                    <input value={instruction} onChange={(e) => setInstruction(e.target.value)}
                      placeholder="✨ Änderungswunsch… (z. B. „Ton lockerer, immer Late-Checkout erwähnen“)"
                      style={{ flex: 1, border: '1px solid #E0DDD6', borderRadius: 999, padding: '8px 14px', fontSize: '12.5px', outline: 'none' }} />
                    <button type="button" disabled={busy || !instruction.trim()} onClick={async () => {
                      const data = await act('prompt-improve', { instruction, content: draft })
                      if (data?.proposal) { setDraft(data.proposal); setMsg('✨ Vorschlag übernommen — prüfen und speichern.') }
                    }} style={{
                      padding: '8px 14px', borderRadius: 999, border: 'none', flexShrink: 0, cursor: 'pointer',
                      background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))', color: '#fff', fontSize: '12px', fontWeight: 700,
                      opacity: busy || !instruction.trim() ? 0.5 : 1,
                    }}>{busy ? '⏳' : 'Mit KI anpassen'}</button>
                  </div>
                  {msg && <p style={{ fontSize: '12px', color: msg.startsWith('Fehler') ? '#DC2626' : 'var(--gold-dark)', margin: '0 0 8px' }}>{msg}</p>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" disabled={busy} onClick={async () => {
                      const data = await act('prompt-save', { content: draft })
                      if (data?.ok) { setMsg('Gespeichert — wirkt sofort.'); load() }
                    }} style={{ padding: '8px 18px', borderRadius: 999, border: 'none', background: '#12222E', color: '#fff', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' }}>
                      Speichern
                    </button>
                    <button type="button" disabled={busy} onClick={async () => {
                      const data = await act('prompt-reset', {})
                      if (data?.ok) { setDraft(data.content); setMsg('Auf Standard zurückgesetzt.'); load() }
                    }} style={{ padding: '8px 14px', borderRadius: 999, border: '1px solid #E5E5EA', background: '#fff', color: '#777', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}>
                      Standard wiederherstellen
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

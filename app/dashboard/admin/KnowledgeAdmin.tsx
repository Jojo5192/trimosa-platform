'use client'

/**
 * Admin card for the learning chat knowledge base: import the Smoobu message
 * history (paginated loop) and (re-)distil the FAQ knowledge documents.
 */
import { useEffect, useState, useCallback } from 'react'

interface KnowledgeDoc { scope: string; title: string; sources: number; updatedAt: string }

export default function KnowledgeAdmin() {
  const [archiveCount, setArchiveCount] = useState<number | null>(null)
  const [docs, setDocs] = useState<KnowledgeDoc[]>([])
  const [importing, setImporting] = useState(false)
  const [importLog, setImportLog] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshLog, setRefreshLog] = useState('')

  const loadStatus = useCallback(async () => {
    const res = await fetch('/api/ai/knowledge')
    if (res.ok) {
      const data = await res.json()
      setArchiveCount(data.archiveCount)
      setDocs(data.documents ?? [])
    }
  }, [])
  useEffect(() => { loadStatus() }, [loadStatus])

  async function runBackfill() {
    setImporting(true)
    setImportLog('Import läuft — Seite 1…')
    let page = 1
    let total = 0
    try {
      for (;;) {
        const res = await fetch('/api/ai/knowledge', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'backfill', page }),
        })
        if (!res.ok) { setImportLog(`Fehler auf Seite ${page}: ${(await res.json()).error ?? res.status}`); break }
        const data = await res.json()
        total += data.imported
        setImportLog(`Seite ${page}: ${data.reservations} Reservierungen, ${total} Nachrichten importiert…`)
        if (!data.hasMore) { setImportLog(`✓ Fertig — ${total} Nachrichten aus der Smoobu-Historie importiert.`); break }
        page += 1
        if (page > 200) { setImportLog('Abbruch: über 200 Seiten — bitte melden.'); break }
      }
    } catch (err) {
      setImportLog('Verbindungsfehler: ' + String(err))
    } finally {
      setImporting(false)
      loadStatus()
    }
  }

  async function runRefresh() {
    setRefreshing(true)
    setRefreshLog('Claude destilliert die Wissensbasis — das dauert 1–2 Minuten…')
    try {
      const res = await fetch('/api/ai/knowledge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh' }),
      })
      const data = await res.json()
      if (!res.ok) setRefreshLog('Fehler: ' + (data.error ?? res.status))
      else setRefreshLog((data.results as { scope: string; sources: number; status: string }[])
        .map((r) => `${r.scope}: ${r.status} (${r.sources} Antworten)`).join(' · '))
    } catch (err) {
      setRefreshLog('Verbindungsfehler: ' + String(err))
    } finally {
      setRefreshing(false)
      loadStatus()
    }
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #E8E6E0', padding: '20px', marginTop: '24px' }}>
      <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: '0 0 6px' }}>🧠 Chat-Wissensbasis</h2>
      <p style={{ fontSize: '12.5px', color: '#888', margin: '0 0 16px', lineHeight: 1.6 }}>
        Grundlage für die ✨-Antwortvorschläge im Chat: Importiere einmalig die Smoobu-Nachrichten
        der letzten Jahre, dann destilliert Claude daraus ein Wissensdokument je Wohnung.
        Die Wissensbasis frischt sich danach wöchentlich automatisch auf.
      </p>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <button type="button" onClick={runBackfill} disabled={importing || refreshing} style={{
          padding: '9px 18px', borderRadius: '10px', border: '1px solid #E0DDD6', background: '#fff',
          fontSize: '12.5px', fontWeight: 700, color: '#333', cursor: importing ? 'wait' : 'pointer',
          opacity: importing || refreshing ? 0.6 : 1,
        }}>
          {importing ? '⏳ Importiert…' : '📥 Smoobu-Historie importieren'}
        </button>
        <button type="button" onClick={runRefresh} disabled={importing || refreshing} style={{
          padding: '9px 18px', borderRadius: '10px', border: 'none',
          background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
          fontSize: '12.5px', fontWeight: 700, color: '#fff', cursor: refreshing ? 'wait' : 'pointer',
          opacity: importing || refreshing ? 0.6 : 1,
        }}>
          {refreshing ? '⏳ Destilliert…' : '🧠 Wissensbasis jetzt aufbauen'}
        </button>
      </div>

      {importLog && <p style={{ fontSize: '12px', color: '#555', margin: '0 0 6px' }}>{importLog}</p>}
      {refreshLog && <p style={{ fontSize: '12px', color: '#555', margin: '0 0 12px' }}>{refreshLog}</p>}

      <p style={{ fontSize: '12px', color: '#999', margin: '0 0 8px' }}>
        Archiv: {archiveCount ?? '…'} Nachrichten
      </p>
      {docs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {docs.map((d) => (
            <p key={d.scope + d.title} style={{ fontSize: '12px', color: '#666', margin: 0 }}>
              📄 <strong>{d.title}</strong> — {d.sources} Antworten ausgewertet, Stand {fmtDate(d.updatedAt)}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

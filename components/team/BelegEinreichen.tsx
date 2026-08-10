'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { haptic } from '@/components/team/ux'
import DocScanner from '@/components/DocScanner'

/**
 * 🧾 BELEG EINREICHEN (§243ad) — Vollbild-Bereich im Mehr-Tab für ALLE
 * Team-Rollen inkl. Dienstleister: Beleg hochladen (Foto/Scan/Datei, mehrere
 * Fotos = EIN mehrseitiges PDF), Standort/Wohnung wählen, optionale Notiz.
 * Der Beleg landet in der Beleg-Inbox der Buchhaltung (Admin entscheidet) —
 * die Antwort enthält BEWUSST keinerlei Finanzdaten, nur die Bestätigung.
 * Overlay via createPortal(document.body) — §83-Lektion (fixed im Scroller);
 * Portal-Root trägt team-shell (Zoom-Sperre/16px-Inputs).
 */

const NAVY = '#12222E'
const GOLD = '#B0912B'
const INK = '#1A1814'
const SUB = '#8A8578'

export default function BelegEinreichen({ onClose }: { onClose: () => void }) {
  const [orte, setOrte] = useState<string[]>(['Allgemein'])
  const [ort, setOrt] = useState('Allgemein')
  const [notiz, setNotiz] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [fertig, setFertig] = useState(false)
  const [err, setErr] = useState('')
  // §256: Fotos laufen erst durch den Dokumentenscanner (Zuschnitt/Aufhellung)
  const [scanBilder, setScanBilder] = useState<File[] | null>(null)
  const pdfHold = useRef<File[]>([])

  useEffect(() => {
    fetch('/api/belege/einreichen', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (Array.isArray(j.orte) && j.orte.length) setOrte(j.orte) })
      .catch(() => {})
  }, [])

  const bildZuJpeg = async (file: File): Promise<Uint8Array> => {
    // Scanner-Seiten sind schon JPEG ≤2000px — nicht erneut encodieren (§256)
    if (file.type === 'image/jpeg' && /^beleg-scan-/.test(file.name)) return new Uint8Array(await file.arrayBuffer())
    const bmp = await createImageBitmap(file)
    const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * s))
    canvas.height = Math.max(1, Math.round(bmp.height * s))
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('Bild-Konvertierung fehlgeschlagen'))), 'image/jpeg', 0.88))
    return new Uint8Array(await blob.arrayBuffer())
  }

  const senden = async () => {
    if (!files.length) { setErr('Bitte zuerst ein Foto oder eine Datei wählen.'); return }
    setBusy(true); setErr('')
    try {
      // mehrere Fotos = EIN mehrseitiger Beleg → Client-PDF (§243ad)
      const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
      const bilder = files.filter((f) => !pdfs.includes(f))
      const uploads: File[] = [...pdfs]
      if (bilder.length === 1) uploads.push(bilder[0])
      else if (bilder.length > 1) {
        const { PDFDocument } = await import('pdf-lib')
        const doc = await PDFDocument.create()
        for (const b of bilder) {
          const jpg = await doc.embedJpg(await bildZuJpeg(b))
          const page = doc.addPage([jpg.width, jpg.height])
          page.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height })
        }
        const bytes = await doc.save()
        uploads.push(new File([bytes as unknown as BlobPart], `scan-${bilder.length}-seiten.pdf`, { type: 'application/pdf' }))
      }
      for (const f of uploads) {
        const fd = new FormData()
        fd.append('file', f)
        fd.append('ort', ort)
        if (notiz.trim()) fd.append('notiz', notiz.trim())
        const r = await fetch('/api/belege/einreichen', { method: 'POST', body: fd })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      }
      haptic()
      setFertig(true)
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const reset = () => { setFiles([]); setNotiz(''); setFertig(false); setErr('') }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="team-shell" style={{ position: 'fixed', inset: 0, zIndex: 80, background: '#F2F2F7', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: NAVY, color: '#fff', padding: 'max(12px, env(safe-area-inset-top)) 16px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: -0.3 }}>🧾 Beleg einreichen</div>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.14)', border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, borderRadius: 999, padding: '6px 13px', cursor: 'pointer' }}>✕</button>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 16px calc(30px + env(safe-area-inset-bottom))' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'grid', gap: 14 }}>
          {fertig ? (
            <div style={{ background: '#fff', borderRadius: 14, padding: '38px 22px', textAlign: 'center', boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)' }}>
              <div style={{ fontSize: 44 }}>✅</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: INK, marginTop: 10 }}>Danke — Beleg eingereicht!</div>
              <div style={{ fontSize: 14, color: SUB, marginTop: 6, lineHeight: 1.5 }}>Die Buchhaltung übernimmt ab hier. Du musst nichts weiter tun.</div>
              <button onClick={reset} style={{ marginTop: 18, background: GOLD, color: '#fff', border: 'none', borderRadius: 12, padding: '12px 18px', fontSize: 15.5, fontWeight: 700, cursor: 'pointer' }}>
                Weiteren Beleg einreichen
              </button>
            </div>
          ) : (
            <>
              <label style={{
                background: '#fff', borderRadius: 14, padding: '22px 18px', textAlign: 'center',
                boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)', cursor: busy ? 'wait' : 'pointer',
                border: files.length ? `1.5px solid ${GOLD}` : '1.5px dashed rgba(60,60,67,0.25)',
                WebkitTapHighlightColor: 'transparent', display: 'block',
              }}>
                <div style={{ fontSize: 34 }}>📸</div>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: INK, marginTop: 6 }}>
                  {files.length
                    ? `${files.length} ${files.length === 1 ? 'Datei' : 'Dateien'} ausgewählt`
                    : 'Foto aufnehmen / Datei wählen'}
                </div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 3, lineHeight: 1.45 }}>
                  Rechnung, Kassenbon, Quittung — mehrere Fotos werden zu EINEM Beleg zusammengefasst
                </div>
                <input type="file" accept="image/*,application/pdf" multiple disabled={busy}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const fs = Array.from(e.target.files ?? []); e.target.value = ''
                    if (!fs.length) return
                    setErr('')
                    // §256: Bilder → Dokumentenscanner, PDFs bleiben wie sie sind
                    const pdfs = fs.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
                    const bilder = fs.filter((f) => !pdfs.includes(f))
                    if (bilder.length) { pdfHold.current = pdfs; setScanBilder(bilder) }
                    else setFiles(pdfs)
                  }} />
              </label>

              <div style={{ background: '#fff', borderRadius: 14, padding: 16, display: 'grid', gap: 13, boxShadow: '0 0 0 0.5px rgba(60,60,67,0.1)' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: SUB, letterSpacing: '0.04em', margin: '0 2px 5px' }}>WOFÜR IST DER BELEG?</div>
                  <select value={ort} onChange={(e) => setOrt(e.target.value)} style={{
                    width: '100%', boxSizing: 'border-box', fontSize: 16, padding: '11px 12px',
                    borderRadius: 11, border: '0.5px solid rgba(60,60,67,0.25)', background: '#fff', color: INK,
                  }}>
                    {orte.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: SUB, letterSpacing: '0.04em', margin: '0 2px 5px' }}>NOTIZ (OPTIONAL)</div>
                  <textarea value={notiz} onChange={(e) => setNotiz(e.target.value)} rows={3}
                    placeholder="z. B. Ersatzteil für die Spülmaschine, gekauft bei Bauhaus"
                    style={{
                      width: '100%', boxSizing: 'border-box', fontSize: 16, padding: '11px 12px',
                      borderRadius: 11, border: '0.5px solid rgba(60,60,67,0.25)', background: '#fff',
                      color: INK, resize: 'vertical', fontFamily: 'inherit',
                    }} />
                </div>
              </div>

              {err && (
                <div style={{ background: '#FFEBE9', color: '#D70015', borderRadius: 12, padding: '11px 14px', fontSize: 14 }}>{err}</div>
              )}

              <button onClick={senden} disabled={busy || !files.length} style={{
                background: GOLD, color: '#fff', border: 'none', borderRadius: 13,
                padding: '14px 18px', fontSize: 16.5, fontWeight: 700,
                cursor: busy || !files.length ? 'default' : 'pointer',
                opacity: busy || !files.length ? 0.55 : 1,
              }}>
                {busy ? '⏳ Wird hochgeladen…' : '📤 Beleg einreichen'}
              </button>
            </>
          )}
        </div>
      </div>

      {scanBilder && (
        <DocScanner files={scanBilder}
          onCancel={() => setScanBilder(null)}
          onDone={(jpegs) => { setFiles([...pdfHold.current, ...jpegs]); setScanBilder(null) }} />
      )}
    </div>,
    document.body,
  )
}

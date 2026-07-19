/**
 * PDF-Erzeugung für abgeschlossene QS-Protokolle (pdf-lib, pure JS).
 * Layout: A4, Kopf mit Wohnung/Datum/Prüfer:in, je Sektion die Punkte mit
 * Status (OK / MANGEL / nicht geprüft), Stückzahlen und Notizen, danach
 * die angehängten Fotos. Ablage im listing-images-Bucket (qs/<id>/…),
 * die URL wandert in qs_checks.pdf_url.
 * WICHTIG: Standard-Fonts sind WinAnsi — Umlaute ok, KEINE Emojis in Texte.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { QsReport, QsSection } from '@/lib/qs'

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 48
const NAVY = rgb(0.07, 0.13, 0.18)
const GOLD = rgb(0.68, 0.55, 0.18)
const GRAY = rgb(0.45, 0.44, 0.42)
const RED = rgb(0.73, 0.11, 0.11)
const GREEN = rgb(0.09, 0.5, 0.24)

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(probe, size) <= maxWidth) line = probe
    else { if (line) lines.push(line); line = w }
  }
  if (line) lines.push(line)
  return lines
}

/** WinAnsi verträgt keine Emojis/Sonderzeichen außerhalb Latin-1 — rausfiltern. */
function safe(text: string): string {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/[^\x20-\x7E\xA0-\xFFäöüÄÖÜß€„“”‘’–—·…]/g, '').trim()
}

export async function generateQsPdf(opts: {
  checkId: string
  listingTitle: string
  dueDate: string
  completedAt: Date
  inspectorName: string
  report: QsReport
  photos: { url: string }[]
  /** Checkliste, mit der das Protokoll ausgefüllt wurde (Snapshot bzw. aufgelöst) */
  template: QsSection[]
}): Promise<string | null> {
  try {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const contentWidth = A4[0] - 2 * MARGIN

    let page: PDFPage = doc.addPage(A4)
    let y = A4[1] - MARGIN

    const newPageIfNeeded = (needed: number) => {
      if (y - needed < MARGIN + 24) {
        page = doc.addPage(A4)
        y = A4[1] - MARGIN
      }
    }
    const text = (t: string, opts2: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number } = {}) => {
      const size = opts2.size ?? 10
      page.drawText(safe(t), { x: opts2.x ?? MARGIN, y, size, font: opts2.font ?? font, color: opts2.color ?? NAVY })
      y -= size + 4
    }

    /* Kopf */
    page.drawRectangle({ x: 0, y: A4[1] - 92, width: A4[0], height: 92, color: NAVY })
    page.drawText('TRIMOSA', { x: MARGIN, y: A4[1] - 44, size: 20, font: bold, color: GOLD })
    page.drawText('Qualitätssicherungs-Protokoll', { x: MARGIN, y: A4[1] - 66, size: 13, font, color: rgb(1, 1, 1) })
    y = A4[1] - 118

    const fmt = (iso: string) => { const [yy, m, d] = iso.split('-'); return `${Number(d)}.${Number(m)}.${yy}` }
    text(`Wohnung: ${opts.listingTitle}`, { size: 12, font: bold })
    text(`Geplanter Termin: ${fmt(opts.dueDate)}   ·   Durchgeführt am: ${opts.completedAt.toLocaleDateString('de-DE')}`, { size: 10, color: GRAY })
    text(`Prüfer:in: ${opts.inspectorName}`, { size: 10, color: GRAY })
    y -= 8

    /* Sektionen */
    const items = opts.report.items ?? {}
    for (const sec of opts.template) {
      newPageIfNeeded(60)
      y -= 6
      page.drawRectangle({ x: MARGIN, y: y - 4, width: contentWidth, height: 1.2, color: GOLD })
      y -= 10
      text(sec.title, { size: 12, font: bold })
      y -= 2
      for (const item of sec.items) {
        const v = items[item.id] ?? {}
        const status = v.s === 'ok' ? 'OK' : v.s === 'mangel' ? 'MANGEL' : v.s === 'na' ? 'n. geprüft' : '—'
        const color = v.s === 'mangel' ? RED : v.s === 'ok' ? GREEN : GRAY
        const countStr = item.type === 'anzahl' && v.count != null ? `   (Anzahl: ${v.count})` : ''
        newPageIfNeeded(30)
        const label = safe(item.label)
        page.drawText(label, { x: MARGIN, y, size: 10, font, color: NAVY })
        page.drawText(safe(status + countStr), {
          x: A4[0] - MARGIN - bold.widthOfTextAtSize(safe(status + countStr), 10),
          y, size: 10, font: bold, color,
        })
        y -= 14
        if (v.note) {
          for (const line of wrap(`Notiz: ${v.note}`, font, 9, contentWidth - 16)) {
            newPageIfNeeded(14)
            page.drawText(safe(line), { x: MARGIN + 14, y, size: 9, font, color: GRAY })
            y -= 12
          }
          y -= 2
        }
      }
    }

    /* Gesamtnotiz */
    if (opts.report.note?.trim()) {
      newPageIfNeeded(50)
      y -= 8
      text('Weitere Anmerkungen', { size: 12, font: bold })
      for (const line of wrap(opts.report.note, font, 10, contentWidth)) {
        newPageIfNeeded(16)
        text(line, { size: 10 })
      }
    }

    /* Fotos (je 2 pro Reihe) */
    if (opts.photos.length) {
      page = doc.addPage(A4)
      y = A4[1] - MARGIN
      text('Fotos', { size: 13, font: bold })
      y -= 6
      const imgW = (contentWidth - 16) / 2
      let col = 0
      let rowH = 0
      for (const p of opts.photos.slice(0, 12)) {
        try {
          const res = await fetch(p.url)
          if (!res.ok) continue
          const buf = new Uint8Array(await res.arrayBuffer())
          const isPng = p.url.toLowerCase().includes('.png')
          const img = isPng ? await doc.embedPng(buf) : await doc.embedJpg(buf)
          const scale = imgW / img.width
          const h = img.height * scale
          if (col === 0) {
            if (y - h < MARGIN) { page = doc.addPage(A4); y = A4[1] - MARGIN }
            rowH = h
          }
          const x = MARGIN + col * (imgW + 16)
          page.drawImage(img, { x, y: y - h, width: imgW, height: h })
          col++
          if (col === 2) { y -= rowH + 14; col = 0; rowH = 0 }
        } catch { /* einzelnes Foto überspringen */ }
      }
      if (col === 1) y -= rowH + 14
    }

    /* Fußzeile auf jeder Seite */
    const pages = doc.getPages()
    pages.forEach((p, i) => {
      p.drawText(safe(`Optische Prüfung / Sichtkontrolle · TRIMOSA Apartments & Homes eGbR · Seite ${i + 1}/${pages.length}`), {
        x: MARGIN, y: 26, size: 8, font, color: GRAY,
      })
    })

    const bytes = await doc.save()
    const stamp = opts.completedAt.toISOString().slice(0, 10)
    const path = `qs/${opts.checkId}/protokoll-${stamp}.pdf`
    const { error } = await supabaseAdmin.storage
      .from('listing-images')
      .upload(path, Buffer.from(bytes), { contentType: 'application/pdf', upsert: true })
    if (error) {
      console.error('[qs-pdf] upload failed:', error.message)
      return null
    }
    const { data: pub } = supabaseAdmin.storage.from('listing-images').getPublicUrl(path)
    return pub.publicUrl
  } catch (e) {
    console.error('[qs-pdf] generation failed:', e)
    return null
  }
}

'use client'

import { useState } from 'react'
import type { GuideBlock, GuideCtx } from '@/lib/guide'
import { blockHasContent } from '@/lib/guide'

/**
 * 📖 Gästemappe: rendert die Block-Liste — geteilt zwischen der öffentlichen
 * Mappe (/mappe/[token], Server-Seite reicht bereits übersetzte Blöcke + Labels)
 * und der Live-Vorschau im Builder (preview=true zeigt auch leere Blöcke blass).
 */

export interface GuideLabels {
  wifi: string; network: string; password: string; copy: string; copied: string
  checkInFrom: string; checkOutUntil: string; addressTitle: string; route: string
  rulesTitle: string; regionTitle: string; regionCta: string; contactTitle: string
  emptyBlock: string
}

export const DE_LABELS: GuideLabels = {
  wifi: 'WLAN', network: 'Netzwerk', password: 'Passwort', copy: 'Kopieren', copied: 'Kopiert!',
  checkInFrom: 'Check-in ab', checkOutUntil: 'Check-out bis',
  addressTitle: 'Adresse & Anfahrt', route: 'Route in Google Maps öffnen',
  rulesTitle: 'Hausregeln', regionTitle: 'Region entdecken',
  regionCta: 'Zum Reiseführer', contactTitle: 'Dein Gastgeber-Team',
  emptyBlock: 'Noch nicht ausgefüllt — erscheint erst mit Inhalt.',
}

const CARD: React.CSSProperties = {
  background: '#fff', border: '1px solid #EDE9DE', borderRadius: 16,
  padding: '16px 18px', boxShadow: '0 2px 10px rgba(20,15,0,0.04)',
}

function CopyValue({ label, value, labels }: { label: string; value: string; labels: GuideLabels }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: '#8A8065', marginBottom: 1 }}>{label}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1A1400', fontFamily: 'ui-monospace, Menlo, monospace', overflowWrap: 'anywhere' }}>{value}</div>
      </div>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
          }).catch(() => {})
        }}
        style={{
          flexShrink: 0, padding: '7px 13px', borderRadius: 999, border: 'none', cursor: 'pointer',
          background: copied ? '#16A34A' : 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)',
          color: '#fff', fontSize: 12, fontWeight: 700, transition: 'background .15s',
        }}
      >{copied ? labels.copied : labels.copy}</button>
    </div>
  )
}

export default function GuideBlocks({ blocks, ctx, labels, preview = false }: {
  blocks: GuideBlock[]
  ctx: GuideCtx
  labels: GuideLabels
  preview?: boolean
}) {
  const visible = preview ? blocks : blocks.filter((b) => blockHasContent(b, ctx))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {visible.map((b) => {
        const empty = preview && !blockHasContent(b, ctx)
        const wrap = (child: React.ReactNode) => (
          <div key={b.id} style={{ opacity: empty ? 0.45 : 1 }}>
            {child}
            {empty && (
              <div style={{ fontSize: 10.5, color: '#B0A793', marginTop: 3, fontStyle: 'italic' }}>
                {labels.emptyBlock}
              </div>
            )}
          </div>
        )

        switch (b.type) {
          case 'heading':
            return wrap(
              <h2 style={{ margin: '14px 0 0', fontSize: 19, fontWeight: 800, color: '#1A1400', letterSpacing: '-0.2px' }}>
                {b.text || '…'}
              </h2>
            )
          case 'text':
            return wrap(
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.7, color: '#4A4438', whiteSpace: 'pre-line' }}>
                {b.text || '…'}
              </p>
            )
          case 'info':
            return wrap(
              <div style={CARD}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: b.text ? 6 : 0 }}>
                  <span style={{ fontSize: 20 }}>{b.emoji || 'ℹ️'}</span>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: '#1A1400' }}>{b.title || '…'}</span>
                </div>
                {b.text && <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: '#4A4438', whiteSpace: 'pre-line' }}>{b.text}</p>}
              </div>
            )
          case 'warning':
            return wrap(
              <div style={{ ...CARD, background: '#FFF7ED', border: '1px solid #FED7AA' }}>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: '#92400E', whiteSpace: 'pre-line' }}>
                  ⚠️ {b.text || '…'}
                </p>
              </div>
            )
          case 'steps':
            return wrap(
              <div style={CARD}>
                {b.title && <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1A1400', marginBottom: 10 }}>{b.title}</div>}
                <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {b.steps.filter((s) => preview || s.trim()).map((s, i) => (
                    <li key={i} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                      <span style={{
                        flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: '#FAF5E4',
                        color: '#8A7020', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{i + 1}</span>
                      <span style={{ fontSize: 13.5, lineHeight: 1.6, color: '#4A4438', paddingTop: 1 }}>{s || '…'}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )
          case 'wifi':
            return wrap(
              <div style={CARD}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1A1400', marginBottom: 4 }}>📶 {labels.wifi}</div>
                <CopyValue label={labels.network} value={b.ssid || '—'} labels={labels} />
                {b.password && (
                  <div style={{ borderTop: '1px solid #F0EDE5' }}>
                    <CopyValue label={labels.password} value={b.password} labels={labels} />
                  </div>
                )}
              </div>
            )
          case 'door':
            return wrap(
              <div style={{ ...CARD, background: '#12222E', border: 'none' }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: '#E3C878', marginBottom: 6 }}>🔑 {b.title || '…'}</div>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: 'rgba(245,240,232,0.85)', whiteSpace: 'pre-line' }}>{b.text || '…'}</p>
              </div>
            )
          case 'contact':
            return wrap(
              <div style={CARD}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1A1400', marginBottom: 6 }}>📞 {labels.contactTitle}</div>
                {b.note && <p style={{ margin: '0 0 10px', fontSize: 13.5, lineHeight: 1.65, color: '#4A4438', whiteSpace: 'pre-line' }}>{b.note}</p>}
                {b.phone && (
                  <a href={`tel:${b.phone.replace(/[^+\d]/g, '')}`} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 999,
                    background: 'linear-gradient(135deg, var(--gold, #AE8D2D), #8A7020)', color: '#fff',
                    fontSize: 13.5, fontWeight: 700, textDecoration: 'none',
                  }}>📞 {b.phone}</a>
                )}
              </div>
            )
          case 'map': {
            const q = ctx.lat && ctx.lon ? `${ctx.lat},${ctx.lon}` : encodeURIComponent(ctx.address ?? '')
            return wrap(
              <div style={CARD}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1A1400', marginBottom: 5 }}>📍 {labels.addressTitle}</div>
                <p style={{ margin: '0 0 10px', fontSize: 13.5, color: '#4A4438' }}>{ctx.address ?? '—'}</p>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${q}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 999,
                    border: '1.5px solid var(--gold, #AE8D2D)', color: '#8A7020', fontSize: 13, fontWeight: 700, textDecoration: 'none',
                  }}
                >{labels.route} ↗</a>
              </div>
            )
          }
          case 'times':
            return wrap(
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ ...CARD, flex: 1, textAlign: 'center', padding: '13px 10px' }}>
                  <div style={{ fontSize: 11, color: '#8A8065', marginBottom: 3 }}>{labels.checkInFrom}</div>
                  <div style={{ fontSize: 19, fontWeight: 800, color: '#1A1400' }}>{ctx.checkIn ?? '—'}</div>
                </div>
                <div style={{ ...CARD, flex: 1, textAlign: 'center', padding: '13px 10px' }}>
                  <div style={{ fontSize: 11, color: '#8A8065', marginBottom: 3 }}>{labels.checkOutUntil}</div>
                  <div style={{ fontSize: 19, fontWeight: 800, color: '#1A1400' }}>{ctx.checkOut ?? '—'}</div>
                </div>
              </div>
            )
          case 'rules':
            return wrap(
              <div style={CARD}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1A1400', marginBottom: 8 }}>🏠 {labels.rulesTitle}</div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {ctx.rules.map((r, i) => (
                    <li key={i} style={{ fontSize: 13.5, lineHeight: 1.55, color: '#4A4438' }}>{r}</li>
                  ))}
                  {ctx.rules.length === 0 && <li style={{ fontSize: 13, color: '#B0A793' }}>—</li>}
                </ul>
              </div>
            )
          case 'region':
            return wrap(
              <a
                href={ctx.regionSlug ? `/region/${ctx.regionSlug}` : '#'}
                target="_blank" rel="noopener noreferrer"
                style={{ ...CARD, display: 'block', background: '#12222E', border: 'none', textDecoration: 'none' }}
              >
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--gold, #AE8D2D)', marginBottom: 5 }}>
                  {labels.regionTitle.toUpperCase()}
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#F5F0E8', marginBottom: 2 }}>{ctx.regionName ?? '—'}</div>
                {ctx.regionClaim && <div style={{ fontSize: 12.5, color: 'rgba(245,240,232,0.65)', marginBottom: 9 }}>{ctx.regionClaim}</div>}
                <span style={{ fontSize: 13, fontWeight: 700, color: '#E3C878' }}>{labels.regionCta} →</span>
              </a>
            )
        }
      })}
    </div>
  )
}

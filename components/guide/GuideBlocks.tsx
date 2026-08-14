'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { GuideBlock, GuideCtx, GuideLabels, InventarGroupKey, InventarItem } from '@/lib/guide'
import { blockHasContent, inventarGroupOf, inventarGroupLabel, INVENTAR_KATALOG } from '@/lib/guide'

/**
 * 📖 Gästemappe: rendert die Block-Liste — geteilt zwischen der öffentlichen
 * Mappe (/mappe/[token], Server-Seite reicht bereits übersetzte Blöcke + Labels)
 * und der Live-Vorschau im Builder (preview=true zeigt auch leere Blöcke blass).
 * Labels/Interface leben server-safe in lib/guide.ts (RSC-Client-Referenz-Falle).
 */

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
          background: copied ? '#16A34A' : 'var(--gold, #AE8D2D)',
          color: '#fff', fontSize: 12, fontWeight: 700, transition: 'background .15s',
        }}
      >{copied ? labels.copied : labels.copy}</button>
    </div>
  )
}

/** §165: WLAN-QR — Kamera scannen = verbinden (zweites Gerät/Tablet/Laptop;
 *  ein Web-„Verbinden"-Klick am selben Gerät ist vom OS nicht erlaubt).
 *  Client-seitig generiert — das Passwort verlässt die Seite nie. */
function WifiQr({ ssid, password, hint }: { ssid: string; password: string; hint: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const esc = (v: string) => v.replace(/([\\;,:"])/g, '\\$1')
    const payload = `WIFI:T:WPA;S:${esc(ssid)};P:${esc(password)};;`
    import('qrcode')
      .then((QR) => QR.toDataURL(payload, { width: 320, margin: 1, color: { dark: '#1A1400', light: '#FFFFFF' } }))
      .then((u) => { if (alive) setUrl(u) })
      .catch(() => {})
    return () => { alive = false }
  }, [ssid, password])
  if (!url) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, borderTop: '1px solid #F0EDE5', paddingTop: 12, marginTop: 4 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="WLAN-QR-Code" style={{ width: 96, height: 96, borderRadius: 10, flexShrink: 0 }} />
      <span style={{ fontSize: 11.5, color: '#8A8065', lineHeight: 1.55 }}>📷 {hint}</span>
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
  // §198b: Fotos als Thumbnail, Tipp = Vollbild-Lightbox (Portal — §83: nie fixed im Scroller)
  const [lightbox, setLightbox] = useState<string | null>(null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {visible.map((b) => {
        const empty = preview && !blockHasContent(b, ctx)
        // Anker je Baustein (§154 Sprung-Navigation): mb-<id> + scrollMarginTop
        // hält den Abschnitt unter der sticky Nav-Leiste frei
        const wrap = (child: React.ReactNode) => (
          <div key={b.id} id={`mb-${b.id}`} style={{ opacity: empty ? 0.45 : 1, scrollMarginTop: 70 }}>
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
          case 'steps': {
            // §196: Foto je Schritt — Zuordnung über den ORIGINAL-Index
            // (der Leer-Filter darf die Bild-Zuordnung nicht verschieben)
            const list = b.steps
              .map((s, idx) => ({ s, img: b.stepImages?.[idx] || '' }))
              .filter((x) => preview || x.s.trim() || x.img)
            return wrap(
              <div style={CARD}>
                {b.title && <div style={{ fontSize: 14.5, fontWeight: 700, color: '#1A1400', marginBottom: 10 }}>{b.title}</div>}
                <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {list.map((x, i) => (
                    <li key={i} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                      <span style={{
                        flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: '#FAF5E4',
                        color: '#8A7020', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>{i + 1}</span>
                      <span style={{ fontSize: 13.5, lineHeight: 1.6, color: '#4A4438', paddingTop: 1, flex: 1, minWidth: 0 }}>
                        {x.s || '…'}
                        {x.img && (
                          <button type="button" onClick={() => setLightbox(x.img)} style={{
                            border: 'none', padding: 0, background: 'none', cursor: 'zoom-in',
                            display: 'block', marginTop: 8, position: 'relative',
                          }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={x.img} alt="" style={{
                              display: 'block', width: 128, height: 84, objectFit: 'cover',
                              borderRadius: 10, boxShadow: '0 1px 6px rgba(0,0,0,0.14)',
                            }} />
                            <span style={{
                              position: 'absolute', right: 5, bottom: 5, width: 22, height: 22, borderRadius: '50%',
                              background: 'rgba(18,34,46,0.75)', color: '#fff', fontSize: 11,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>🔍</span>
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )
          }
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
                {b.ssid && b.password && <WifiQr ssid={b.ssid} password={b.password} hint={labels.wifiQrHint} />}
              </div>
            )
          case 'door':
            return wrap(
              <div style={{ ...CARD, background: '#12222E', border: 'none' }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: '#E3C878', marginBottom: 6 }}>🔑 {b.title || '…'}</div>
                {/* Türcode-Automatik (§132): Code groß, sobald das Anzeige-
                    Fenster erreicht ist; vorher der Hinweis, ab wann er kommt */}
                {ctx.doorCode && (
                  <div style={{ margin: '6px 0 10px', textAlign: 'center' }}>
                    <div style={{
                      display: 'inline-block', padding: '10px 22px', borderRadius: 14,
                      background: 'rgba(227,200,120,0.12)', border: '1px solid rgba(227,200,120,0.4)',
                      fontSize: 30, fontWeight: 800, letterSpacing: '0.35em', color: '#E3C878',
                      fontVariantNumeric: 'tabular-nums', paddingRight: 12,
                    }}>{ctx.doorCode}</div>
                  </div>
                )}
                {!ctx.doorCode && ctx.doorNote && (
                  <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.6, color: 'rgba(227,200,120,0.85)', textAlign: 'center' }}>⏳ {ctx.doorNote}</p>
                )}
                {(b.text || (!ctx.doorCode && !ctx.doorNote)) && (
                  <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.65, color: 'rgba(245,240,232,0.85)', whiteSpace: 'pre-line' }}>{b.text || '…'}</p>
                )}
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
                    background: 'var(--gold, #AE8D2D)', color: '#fff',
                    fontSize: 13.5, fontWeight: 700, textDecoration: 'none',
                  }}>📞 {b.phone}</a>
                )}
              </div>
            )
          case 'image': {
            // §196b: Zwei Fotos nebeneinander (z. B. Straßenfoto + Parkplatz-
            // Skizze) — quadratisch zugeschnitten, damit die Reihe bündig ist
            const single = b.url || b.url2 || ''
            const pair = !!(b.url && b.url2)
            return wrap(
              <figure style={{ margin: 0 }}>
                {pair
                  ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {[b.url, b.url2 as string].map((u, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={u} alt={b.caption || 'Foto'} onClick={() => setLightbox(u)} style={{
                          display: 'block', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover',
                          borderRadius: 16, boxShadow: '0 2px 10px rgba(0,0,0,0.08)', cursor: 'zoom-in',
                        }} />
                      ))}
                    </div>
                  )
                  : single
                    ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={single} alt={b.caption || 'Foto'} onClick={() => setLightbox(single)} style={{
                        display: 'block', width: '100%', height: 'auto', borderRadius: 16,
                        boxShadow: '0 2px 10px rgba(0,0,0,0.08)', cursor: 'zoom-in',
                      }} />
                    )
                    : <div style={{ borderRadius: 16, background: '#ECE8DE', padding: '34px 0', textAlign: 'center', fontSize: 22 }}>📷</div>}
                {b.caption && (
                  <figcaption style={{ margin: '7px 4px 0', fontSize: 12, color: '#8A8065', lineHeight: 1.5 }}>{b.caption}</figcaption>
                )}
              </figure>
            )
          }
          case 'link': {
            if (!b.url.trim() && !preview) return null
            return wrap(
              <div style={{ ...CARD, textAlign: 'center' }}>
                {b.url.trim()
                  ? (
                    <a href={b.url} target="_blank" rel="noopener noreferrer" style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 26px', borderRadius: 999,
                      background: 'var(--gold, #AE8D2D)', color: '#fff',
                      fontSize: 14, fontWeight: 700, textDecoration: 'none',
                    }}>{b.title || 'Öffnen'} ↗</a>
                  )
                  : <span style={{ fontSize: 11.5, color: '#B45309' }}>⚠️ Noch keine Adresse (URL) eingetragen.</span>}
                {b.note ? (
                  <p style={{ margin: '11px 0 0', fontSize: 12.5, lineHeight: 1.55, color: '#6B6455' }}>{b.note}</p>
                ) : null}
              </div>
            )
          }
          case 'review': {
            const pid = ctx.googlePlaceId
            if (!pid && !preview) return null
            return wrap(
              <div style={{ ...CARD, textAlign: 'center' }}>
                <div style={{ fontSize: 25, letterSpacing: 5, color: '#D9A62E', marginBottom: 5 }}>★★★★★</div>
                <div style={{ fontSize: 15.5, fontWeight: 800, color: '#1A1400', marginBottom: 5 }}>{b.title || labels.reviewTitle}</div>
                <p style={{ margin: '0 0 13px', fontSize: 13.5, lineHeight: 1.6, color: '#4A4438' }}>{b.text || labels.reviewText}</p>
                {pid
                  ? (
                    <a href={`https://search.google.com/local/writereview?placeid=${pid}`} target="_blank" rel="noopener noreferrer" style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 24px', borderRadius: 999,
                      background: 'var(--gold, #AE8D2D)', color: '#fff',
                      fontSize: 13.5, fontWeight: 700, textDecoration: 'none',
                    }}>⭐ {labels.reviewButton}</a>
                  )
                  : (
                    <span style={{ fontSize: 11.5, color: '#B45309' }}>
                      ⚠️ Ohne Google-Place-ID am Inserat bleibt der Baustein beim Gast unsichtbar (Inserats-Editor → Plattform-URLs).
                    </span>
                  )}
              </div>
            )
          }
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
                {b.show !== 'checkout' && (
                  <div style={{ ...CARD, flex: 1, textAlign: 'center', padding: '13px 10px' }}>
                    <div style={{ fontSize: 11, color: '#8A8065', marginBottom: 3 }}>{labels.checkInFrom}</div>
                    <div style={{ fontSize: 19, fontWeight: 800, color: '#1A1400' }}>{ctx.checkIn ?? '—'}</div>
                  </div>
                )}
                {b.show !== 'checkin' && (
                  <div style={{ ...CARD, flex: 1, textAlign: 'center', padding: '13px 10px' }}>
                    <div style={{ fontSize: 11, color: '#8A8065', marginBottom: 3 }}>{labels.checkOutUntil}</div>
                    <div style={{ fontSize: 19, fontWeight: 800, color: '#1A1400' }}>{ctx.checkOut ?? '—'}</div>
                  </div>
                )}
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
          case 'inventar': {
            // §195: ausklappbare Inventar-Checkliste — Gruppierung folgt dem
            // Katalog (eigene Einträge unter „Weiteres"), Stückzahl als Badge
            const groupOrder: InventarGroupKey[] = [...INVENTAR_KATALOG.map((g) => g.key), 'eigene']
            const grouped = groupOrder
              .map((key) => ({
                key,
                emoji: INVENTAR_KATALOG.find((g) => g.key === key)?.emoji ?? '🔹',
                items: (b.items ?? []).filter((it: InventarItem) => inventarGroupOf(it.id) === key),
              }))
              .filter((g) => g.items.length > 0)
            return wrap(
              <details style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
                <summary style={{
                  cursor: 'pointer', listStyle: 'none', padding: '14px 18px',
                  display: 'flex', alignItems: 'center', gap: 10, WebkitTapHighlightColor: 'transparent',
                }}>
                  <span style={{ fontSize: 18 }}>📦</span>
                  <span style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: '#1A1400' }}>{b.title || '…'}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: '#8A7020', background: '#FAF5E4',
                    padding: '3px 9px', borderRadius: 999, flexShrink: 0,
                  }}>{(b.items ?? []).length}</span>
                  <span style={{ fontSize: 11, color: '#B0A793', flexShrink: 0 }}>▾</span>
                </summary>
                <div style={{ padding: '0 18px 16px', borderTop: '1px solid #F0EDE5' }}>
                  {grouped.map((g) => (
                    <div key={g.key} style={{ marginTop: 13 }}>
                      <div style={{
                        fontSize: 10.5, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
                        color: '#8A8065', marginBottom: 7,
                      }}>{g.emoji} {inventarGroupLabel(labels, g.key)}</div>
                      <ul style={{
                        margin: 0, padding: 0, listStyle: 'none',
                        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '5px 12px',
                      }}>
                        {g.items.map((it: InventarItem) => (
                          <li key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#4A4438', lineHeight: 1.45 }}>
                            <span style={{ fontSize: 14, flexShrink: 0 }}>{it.emoji}</span>
                            <span style={{ minWidth: 0 }}>
                              {it.label}
                              {it.note && <span style={{ display: 'block', fontSize: 11, color: '#8A8065', lineHeight: 1.4 }}>{it.note}</span>}
                            </span>
                            {typeof it.count === 'number' && it.count > 0 && (
                              <span style={{
                                fontSize: 10.5, fontWeight: 800, color: '#8A7020', background: '#FAF5E4',
                                padding: '1px 7px', borderRadius: 999, flexShrink: 0,
                              }}>× {it.count}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            )
          }
          case 'chat':
            // §163/§166: Positions-Marker — den ECHTEN Chat rendert die
            // Mappe-Seite an dieser Stelle; die Builder-Vorschau zeigt die
            // KOMBI-Karte „Kontakt & Chat" in derselben Optik (Text →
            // Telefon → Chat, Daten aus dem Kontakt-Baustein gemergt)
            return preview
              ? wrap(
                  <div style={{ borderRadius: 16, overflow: 'hidden', background: '#12222E', padding: '15px 18px' }}>
                    {(b.phone || b.note) && (
                      <>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: '#E3C878', marginBottom: b.note ? 6 : 10 }}>📞 Kontakt</div>
                        {b.note && <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'rgba(245,240,232,0.7)', lineHeight: 1.6 }}>{b.note}</p>}
                        {b.phone && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 999,
                            border: '1px solid rgba(227,200,120,0.4)', color: '#E3C878', fontSize: 13.5, fontWeight: 700, marginBottom: 4,
                          }}>📞 {b.phone}</span>
                        )}
                        <div style={{ borderTop: '1px solid rgba(245,240,232,0.12)', margin: '12px 0' }} />
                      </>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 14.5, fontWeight: 700, color: '#E3C878' }}>💬 Nachricht an dein Gastgeber-Team</span>
                      <span style={{ fontSize: 12, color: 'rgba(245,240,232,0.6)' }}>▼</span>
                    </div>
                    {!(b.phone || b.note) && (
                      <p style={{ margin: '8px 0 0', fontSize: 11, color: 'rgba(245,240,232,0.45)' }}>
                        Tipp: Ein 📞-Kontakt-Baustein füllt hier Telefon + Hinweis mit aus.
                      </p>
                    )}
                  </div>
                )
              : null
        }
      })}
      {lightbox && createPortal(
        <div onClick={() => setLightbox(null)} style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(10,14,18,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, cursor: 'zoom-out',
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" style={{
            maxWidth: '100%', maxHeight: '94%', borderRadius: 14,
            boxShadow: '0 12px 44px rgba(0,0,0,0.55)',
          }} />
          <button type="button" onClick={() => setLightbox(null)} aria-label="Schließen" style={{
            position: 'absolute', top: 'calc(14px + env(safe-area-inset-top))', right: 16,
            width: 38, height: 38, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.16)', color: '#fff', fontSize: 17, fontWeight: 700,
          }}>✕</button>
        </div>,
        document.body,
      )}
    </div>
  )
}

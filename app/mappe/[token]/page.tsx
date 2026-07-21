import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { makeTr } from '@/lib/static-translate'
import { isUiLang, UI_LANG_META, type UiLang } from '@/lib/i18n'
import { REGIONS } from '@/lib/regions'
import { checkRateLimit } from '@/lib/rate-limit'
import { parseGuide, collectGuideTexts, translateBlocks, DE_LABELS, type GuideCtx, type GuideLabels } from '@/lib/guide'
import { ensureDoorCode, getRevealDays } from '@/lib/locks'
import GuideBlocks from '@/components/guide/GuideBlocks'

/**
 * 📖 Öffentliche Gästemappe — persönlicher, unguessbarer Link je Buchung
 * (/mappe/<portal_token>). Startsprache = Buchungssprache des Gasts,
 * umschaltbar über ?lang=. Nicht indexierbar (noindex + robots-Disallow).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120 // Erstübersetzung einer Sprache kann dauern

export const metadata: Metadata = { robots: { index: false, follow: false } }

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}.${m}.${y}`
}

export default async function MappePage({ params, searchParams }: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ lang?: string }>
}) {
  const { token } = await params
  const { lang: langParam } = await searchParams
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound()

  const h = await headers()
  const ip = (h.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  const allowed = await checkRateLimit(`mappe:${ip}`, 120, 3600)
  if (!allowed) notFound()

  const { data: booking } = await supabaseAdmin
    .from('bookings')
    .select('*, listings(*)')
    .eq('portal_token', token)
    .maybeSingle()
  if (!booking || booking.status === 'cancelled') notFound()
  const listing = (Array.isArray(booking.listings) ? booking.listings[0] : booking.listings) as Record<string, unknown> | null
  if (!listing) notFound()

  const lang: UiLang = isUiLang(langParam ?? '')
    ? (langParam as UiLang)
    : isUiLang(String(booking.guest_lang ?? '')) ? (booking.guest_lang as UiLang) : 'de'

  // ── Hausregeln aus dem Inserat als lesbare Zeilen ──
  const rules: string[] = []
  if (listing.rule_quiet_hours) rules.push(`🌙 Ruhezeiten: ${listing.rule_quiet_start ?? '22:00'}–${listing.rule_quiet_end ?? '07:00'} Uhr`)
  rules.push(listing.rule_smoking_allowed ? '🚬 Rauchen erlaubt' : '🚭 Nichtraucher-Wohnung')
  rules.push(listing.rule_pets_allowed ? '🐾 Haustiere willkommen' : '🐾 Keine Haustiere')
  if (!listing.rule_events_allowed) rules.push('🎉 Keine Partys oder Veranstaltungen')
  const maxG = (listing.rule_max_guests ?? listing.max_guests) as number | null
  if (maxG) rules.push(`👥 Maximal ${maxG} Gäste`)
  if (typeof listing.rule_additional_rules === 'string' && listing.rule_additional_rules.trim()) {
    rules.push(`➕ ${listing.rule_additional_rules.trim()}`)
  }

  const region = Object.entries(REGIONS).find(([, r]) =>
    typeof listing.location === 'string' && listing.location.includes(r.locationMatch)
  )

  const blocksDe = parseGuide(listing.guide)

  // ── Türcode-Automatik (§132): Code on-demand erzeugen, sobald das
  //    Anzeige-Fenster erreicht ist (deckt kurzfristige Buchungen ohne
  //    nächtlichen Cron-Lauf ab); vorher nur der Hinweis, ab wann er kommt ──
  let doorCode: string | null = null
  let doorNoteDe: string | null = null
  const todayIso = new Date().toISOString().slice(0, 10)
  const locksArr = (listing.locks as { provider: string }[] | null) ?? []
  console.log('[mappe] door-check:', { booking: String(booking.id).slice(0, 8), locks: locksArr.length, checkIn: booking.check_in, checkOut: booking.check_out, status: booking.status })
  if (locksArr.length && String(booking.check_out ?? '') >= todayIso) {
    const revealDays = await getRevealDays()
    const daysToArrival = Math.ceil((new Date(String(booking.check_in) + 'T00:00:00Z').getTime() - Date.now()) / 86400_000)
    console.log('[mappe] door-window:', { daysToArrival, revealDays, hatCode: !!booking.door_code })
    if (daysToArrival <= revealDays) {
      doorCode = (booking.door_code as string | null) ?? null
      if (!doorCode) {
        try { doorCode = await ensureDoorCode(String(booking.id)) } catch (e) { console.error('[mappe] door-code:', e) }
      }
    } else {
      doorNoteDe = `Dein Türcode erscheint hier ${revealDays} Tage vor Anreise.`
    }
  }

  // Hat die Mappe (noch) keinen door-Block, wird er bei aktiver Türcode-
  // Automatik SYNTHETISCH eingefügt — sonst hätte der Code keinen Platz zum
  // Erscheinen (auch bei komplett leerer Mappe bekommt der Gast so den Code)
  let blocksAll = blocksDe
  if ((doorCode || doorNoteDe) && !blocksDe.some((b) => b.type === 'door')) {
    let idx = -1
    for (const t of ['steps', 'map', 'times'] as const) {
      const i = blocksDe.findIndex((b) => b.type === t)
      if (i >= 0) { idx = i + 1; break }
    }
    if (idx < 0) idx = Math.min(1, blocksDe.length)
    blocksAll = [
      ...blocksDe.slice(0, idx),
      { id: 'auto-door', type: 'door' as const, title: 'Schlüssel & Zugang', text: '' },
      ...blocksDe.slice(idx),
    ]
  }

  const ctxDe: GuideCtx = {
    listingTitle: String(listing.title ?? ''),
    address: (listing.address as string | null) ?? null,
    lat: (listing.latitude as number | null) ?? null,
    lon: (listing.longitude as number | null) ?? null,
    checkIn: (listing.check_in_time as string | null) ?? null,
    checkOut: (listing.check_out_time as string | null) ?? null,
    rules,
    regionName: region ? region[1].name : null,
    regionSlug: region ? region[0] : null,
    regionClaim: region ? region[1].claim : null,
    doorCode,
    doorNote: doorNoteDe,
  }

  // ── Übersetzung (Blöcke + Labels + UI + Hausregeln) in einem Batch ──
  const UI_DE = {
    hallo: 'Hallo', deinAufenthalt: 'Dein Aufenthalt im', zeitraum: 'Zeitraum',
    untitled: 'Deine Gästemappe', fallback: 'Der Gastgeber hat diese Mappe noch nicht befüllt — bei Fragen melde dich gern direkt.',
  }
  let blocks = blocksAll
  let ctx = ctxDe
  let labels: GuideLabels = DE_LABELS
  let ui = UI_DE
  if (lang !== 'de') {
    const tr = await makeTr(lang, [
      ...collectGuideTexts(blocksAll), ...rules,
      ...Object.values(DE_LABELS), ...Object.values(UI_DE),
      ctxDe.regionClaim ?? '', ctxDe.doorNote ?? '',
    ])
    blocks = translateBlocks(blocksAll, tr)
    ctx = {
      ...ctxDe, rules: rules.map(tr),
      regionClaim: ctxDe.regionClaim ? tr(ctxDe.regionClaim) : null,
      doorNote: ctxDe.doorNote ? tr(ctxDe.doorNote) : null,
    }
    labels = Object.fromEntries(Object.entries(DE_LABELS).map(([k, v]) => [k, tr(v)])) as unknown as GuideLabels
    ui = Object.fromEntries(Object.entries(UI_DE).map(([k, v]) => [k, tr(v)])) as typeof UI_DE
  }

  const firstName = String(booking.guest_name ?? '').trim().split(/\s+/)[0] || null
  const range = `${fmtDate(booking.check_in)} – ${fmtDate(booking.check_out)}`

  return (
    <div style={{ minHeight: '100vh', background: '#F5F3EE', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      {/* Kopf */}
      <div style={{ background: 'linear-gradient(160deg, #12222E 0%, #172A22 100%)', padding: '34px 20px 28px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--gold, #AE8D2D)', letterSpacing: '0.02em', marginBottom: 16 }}>
            TRIMOSA
            <span style={{ display: 'block', fontSize: 7.5, fontWeight: 400, color: '#B9B2A4', letterSpacing: '0.2em', marginTop: 2 }}>APARTMENTS &amp; HOMES</span>
          </div>
          <h1 style={{ margin: '0 0 6px', fontSize: 25, fontWeight: 800, color: '#F5F0E8', letterSpacing: '-0.3px' }}>
            {firstName ? `${ui.hallo} ${firstName}! 👋` : ui.untitled}
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: 'rgba(245,240,232,0.75)', lineHeight: 1.6 }}>
            {ui.deinAufenthalt} <strong style={{ color: '#E3C878' }}>{ctx.listingTitle}</strong>
            <span style={{ display: 'block', fontSize: 12.5, color: 'rgba(245,240,232,0.55)', marginTop: 2 }}>{ui.zeitraum}: {range}</span>
          </p>
          {/* Sprachwahl */}
          <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
            {(Object.keys(UI_LANG_META) as UiLang[]).map((l) => (
              <a key={l} href={`?lang=${l}`} style={{
                padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 700, textDecoration: 'none',
                background: l === lang ? 'var(--gold, #AE8D2D)' : 'rgba(245,240,232,0.12)',
                color: l === lang ? '#fff' : 'rgba(245,240,232,0.75)',
              }}>{UI_LANG_META[l].flag} {l.toUpperCase()}</a>
            ))}
          </div>
        </div>
      </div>

      {/* Inhalt */}
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '22px 16px 48px' }}>
        {blocks.length > 0
          ? <GuideBlocks blocks={blocks} ctx={ctx} labels={labels} />
          : <p style={{ fontSize: 14, color: '#8A8065', lineHeight: 1.7 }}>{ui.fallback}</p>}
        <p style={{ margin: '34px 0 0', textAlign: 'center', fontSize: 11, color: '#B0A793' }}>
          TRIMOSA Apartments &amp; Homes · trimosa.de
        </p>
      </div>
    </div>
  )
}

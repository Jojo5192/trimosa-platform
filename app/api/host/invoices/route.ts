import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const month = req.nextUrl.searchParams.get('month') // e.g. "2026-03"
  if (!month) return NextResponse.json({ error: 'month fehlt' }, { status: 400 })

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('billing_name,billing_address,billing_city,billing_zip,billing_country,billing_tax_id,account_holder')
    .eq('id', user.id)
    .single()

  const { data: listings } = await supabaseAdmin
    .from('listings').select('id').eq('host_id', user.id)

  const listingIds = listings?.map(l => l.id) ?? []
  if (listingIds.length === 0) return NextResponse.json({ error: 'Keine Inserate' }, { status: 404 })

  const from = `${month}-01`
  const to   = `${month}-31`

  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('id, check_in, check_out, total_price, guests, listings(title)')
    .in('listing_id', listingIds)
    .in('status', ['confirmed', 'completed'])
    .gte('check_in', from)
    .lte('check_in', to)

  const bks = bookings ?? []
  const totalRevenue   = bks.reduce((s, b) => s + (b.total_price ?? 0), 0)
  const commission     = totalRevenue * 0.1
  const vat            = commission * 0.07
  const commissionGross = commission + vat

  const monthNames: Record<string, string> = {
    '01': 'Januar', '02': 'Februar', '03': 'März', '04': 'April',
    '05': 'Mai', '06': 'Juni', '07': 'Juli', '08': 'August',
    '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Dezember',
  }
  const [yyyy, mm] = month.split('-')
  const monthLabel = `${monthNames[mm]} ${yyyy}`

  function fmt(n: number) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n)
  }

  // Generate simple HTML-based PDF-ready document
  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Provisionsrechnung ${monthLabel}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #1a1a1a; padding: 48px; }
  .logo { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #A8882A; margin-bottom: 4px; }
  .logo span { color: #1a1a1a; font-weight: 400; font-size: 12px; letter-spacing: 2px; display: block; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 48px; }
  .invoice-meta { text-align: right; color: #666; font-size: 12px; line-height: 1.8; }
  .invoice-meta strong { color: #1a1a1a; font-size: 18px; display: block; margin-bottom: 8px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-bottom: 40px; }
  .party h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #888; margin-bottom: 8px; }
  .party p { line-height: 1.7; color: #333; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #888; padding: 8px 12px; border-bottom: 2px solid #E8E6E0; }
  td { padding: 10px 12px; border-bottom: 1px solid #F0EDE8; font-size: 13px; color: #333; }
  tr:last-child td { border-bottom: none; }
  .totals { margin-left: auto; width: 280px; }
  .total-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
  .total-row.final { font-weight: 700; font-size: 15px; padding-top: 10px; border-top: 2px solid #E8E6E0; margin-top: 6px; color: #A8882A; }
  .footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid #E8E6E0; font-size: 11px; color: #888; line-height: 1.7; text-align: center; }
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="logo">TRIMOSA<span>APARTMENTS & HOMES</span></div>
    <div style="font-size:12px;color:#888;margin-top:8px;line-height:1.6">
      TRIMOSA GmbH · Musterstraße 1<br>
      54634 Bitburg · Deutschland<br>
      kontakt@trimosa.de
    </div>
  </div>
  <div class="invoice-meta">
    <strong>Provisionsrechnung</strong>
    Rechnungsnummer: ${year}-${month.replace('-','')}-${user.id.slice(0,6).toUpperCase()}<br>
    Zeitraum: ${monthLabel}<br>
    Datum: ${new Date().toLocaleDateString('de-DE')}
  </div>
</div>

<div class="parties">
  <div class="party">
    <h3>Leistungsempfänger</h3>
    <p>
      ${profile?.billing_name ?? profile?.account_holder ?? 'Gastgeber'}<br>
      ${profile?.billing_address ?? '—'}<br>
      ${profile?.billing_zip ?? ''} ${profile?.billing_city ?? ''}<br>
      ${profile?.billing_country ?? 'Deutschland'}
      ${profile?.billing_tax_id ? `<br>USt-ID: ${profile.billing_tax_id}` : ''}
    </p>
  </div>
  <div class="party">
    <h3>Leistungserbringer</h3>
    <p>
      TRIMOSA GmbH<br>
      Musterstraße 1<br>
      54634 Bitburg<br>
      USt-ID: DE123456789
    </p>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>Unterkunft</th>
      <th>Zeitraum</th>
      <th>Gäste</th>
      <th style="text-align:right">Buchungsumsatz</th>
      <th style="text-align:right">Provision (10%)</th>
    </tr>
  </thead>
  <tbody>
    ${bks.map(b => {
      const lt = b.listings as { title: string } | null
      return `<tr>
        <td>${lt?.title ?? '—'}</td>
        <td>${b.check_in} – ${b.check_out}</td>
        <td>${b.guests}</td>
        <td style="text-align:right">${fmt(b.total_price ?? 0)}</td>
        <td style="text-align:right">${fmt((b.total_price ?? 0) * 0.1)}</td>
      </tr>`
    }).join('')}
  </tbody>
</table>

<div class="totals">
  <div class="total-row"><span>Gesamtumsatz</span><span>${fmt(totalRevenue)}</span></div>
  <div class="total-row"><span>Provision netto (10%)</span><span>${fmt(commission)}</span></div>
  <div class="total-row"><span>MwSt. 7%</span><span>${fmt(vat)}</span></div>
  <div class="total-row final"><span>Rechnungsbetrag</span><span>${fmt(commissionGross)}</span></div>
  <div class="total-row" style="font-size:12px;color:#888;margin-top:8px"><span>Deine Auszahlung</span><span>${fmt(totalRevenue - commissionGross)}</span></div>
</div>

<div class="footer">
  Diese Rechnung wird automatisch von TRIMOSA generiert. Bei Fragen: buchhaltung@trimosa.de<br>
  TRIMOSA GmbH · Amtsgericht Trier · HRB 12345 · Geschäftsführer: Max Mustermann
</div>
</body>
</html>`

  // Return as HTML for now (browser can print-to-PDF); later replace with actual PDF lib
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="TRIMOSA-Rechnung-${month}.html"`,
    },
  })
}

// Helper
const year = new Date().getFullYear()

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'
import { getInvoicePdf } from '@/lib/lexoffice'
import { getSevInvoicePdf } from '@/lib/sevdesk'
import { SEV_ENGINE_STICHTAG } from '@/lib/sevdesk-engine'

/**
 * 🧾 Gast-Rechnungs-Download (§158): unguessbarer Link je Buchung über den
 * Mappe-Token (/api/rechnung/<portal_token>) — streamt das PDF live aus dem
 * Rechnungssystem (kein Storage-Zwischenstand, immer der aktuelle Beleg).
 *
 * §235 STICHTAGS-WEICHE: Anreisen ab 02.08.2026 → sevdesk; ältere
 * Buchungen → lexoffice (deren sevdesk-Neuaufbau-Kopien §234 sind interne
 * Belege ohne Anschrift und gehen NIE an Gäste).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ error: 'Nicht gefunden.' }, { status: 404 })

  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  if (!(await checkRateLimit(`rechnung:${ip}`, 30, 3600))) {
    return NextResponse.json({ error: 'Zu viele Anfragen.' }, { status: 429 })
  }

  const { data: b } = await supabaseAdmin
    .from('bookings').select('id, status, check_in').eq('portal_token', token).maybeSingle()
  if (!b || b.status === 'cancelled') return NextResponse.json({ error: 'Nicht gefunden.' }, { status: 404 })

  if (String(b.check_in) >= SEV_ENGINE_STICHTAG) {
    const { data: inv } = await supabaseAdmin
      .from('sevdesk_invoices').select('sevdesk_id, invoice_number').eq('booking_id', b.id).maybeSingle()
    if (inv?.sevdesk_id) {
      const pdf = await getSevInvoicePdf(inv.sevdesk_id)
      if (!pdf.ok || !pdf.pdf) {
        console.error('[rechnung] sevdesk-PDF-Abruf:', pdf.error)
        return NextResponse.json({ error: 'Rechnung derzeit nicht abrufbar.' }, { status: 502 })
      }
      const name = `Rechnung${inv.invoice_number ? `-${inv.invoice_number}` : ''}.pdf`.replace(/[^\w.-]/g, '_')
      return pdfResponse(pdf.pdf, name)
    }
    // §243ac-Randfall (Manuela Marc): Anreise ≥ Stichtag, aber die Rechnung
    // wurde noch VOR dem Umzug in lexoffice ausgestellt („auf Rechnung") —
    // ohne diesen Fallback lieferte der Link 404 statt der echten Rechnung.
    const { data: legacy } = await supabaseAdmin
      .from('lexoffice_invoices').select('lexoffice_id, voucher_number').eq('booking_id', b.id).maybeSingle()
    if (!legacy?.lexoffice_id) return NextResponse.json({ error: 'Noch keine Rechnung vorhanden.' }, { status: 404 })
    const lname = `Rechnung${legacy.voucher_number ? `-${legacy.voucher_number}` : ''}.pdf`.replace(/[^\w.-]/g, '_')
    const { data: archived } = await supabaseAdmin.storage.from('belege')
      .download(`lex-archiv/${legacy.lexoffice_id}.pdf`)
    if (archived) return pdfResponse(Buffer.from(await archived.arrayBuffer()), lname)
    const lpdf = await getInvoicePdf(legacy.lexoffice_id)
    if (!lpdf.ok || !lpdf.pdf) return NextResponse.json({ error: 'Rechnung derzeit nicht abrufbar.' }, { status: 502 })
    return pdfResponse(lpdf.pdf, lname)
  }

  const { data: inv } = await supabaseAdmin
    .from('lexoffice_invoices').select('lexoffice_id, voucher_number').eq('booking_id', b.id).maybeSingle()
  if (!inv?.lexoffice_id) return NextResponse.json({ error: 'Noch keine Rechnung vorhanden.' }, { status: 404 })

  const name = `Rechnung${inv.voucher_number ? `-${inv.voucher_number}` : ''}.pdf`.replace(/[^\w.-]/g, '_')

  // §243ac: STORAGE-ARCHIV zuerst (die lexoffice-Kündigung killt die Live-API;
  // archiveInvoicePdfs hat alle Alt-PDFs nach belege/lex-archiv/ gelegt)
  const { data: archived } = await supabaseAdmin.storage.from('belege')
    .download(`lex-archiv/${inv.lexoffice_id}.pdf`)
  if (archived) {
    return pdfResponse(Buffer.from(await archived.arrayBuffer()), name)
  }

  const pdf = await getInvoicePdf(inv.lexoffice_id)
  if (!pdf.ok || !pdf.pdf) {
    console.error('[rechnung] PDF-Abruf:', pdf.error)
    return NextResponse.json({ error: 'Rechnung derzeit nicht abrufbar.' }, { status: 502 })
  }
  return pdfResponse(pdf.pdf, name)
}

function pdfResponse(pdf: Buffer, name: string): NextResponse {
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

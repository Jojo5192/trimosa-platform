import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'
import { getInvoicePdf } from '@/lib/lexoffice'

/**
 * 🧾 Gast-Rechnungs-Download (§158): unguessbarer Link je Buchung über den
 * Mappe-Token (/api/rechnung/<portal_token>) — streamt das PDF live aus
 * lexoffice (kein Storage-Zwischenstand, immer der aktuelle Beleg — auch
 * nach manuellen Anpassungen in der lexoffice-UI).
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
    .from('bookings').select('id, status').eq('portal_token', token).maybeSingle()
  if (!b || b.status === 'cancelled') return NextResponse.json({ error: 'Nicht gefunden.' }, { status: 404 })

  const { data: inv } = await supabaseAdmin
    .from('lexoffice_invoices').select('lexoffice_id, voucher_number').eq('booking_id', b.id).maybeSingle()
  if (!inv?.lexoffice_id) return NextResponse.json({ error: 'Noch keine Rechnung vorhanden.' }, { status: 404 })

  const pdf = await getInvoicePdf(inv.lexoffice_id)
  if (!pdf.ok || !pdf.pdf) {
    console.error('[rechnung] PDF-Abruf:', pdf.error)
    return NextResponse.json({ error: 'Rechnung derzeit nicht abrufbar.' }, { status: 502 })
  }
  const name = `Rechnung${inv.voucher_number ? `-${inv.voucher_number}` : ''}.pdf`.replace(/[^\w.-]/g, '_')
  return new NextResponse(new Uint8Array(pdf.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}

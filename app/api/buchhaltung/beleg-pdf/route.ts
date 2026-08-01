import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pdfForVoucher } from '@/lib/beleg-ki'

/**
 * 📄 BELEG-VORSCHAU-PROXY (§243g) — streamt das Original eines sevdesk-
 * Belegs (Storage-Kopie, sonst sevdesk-Dokument-Download). Damit haben
 * auch die 207 lexoffice-Importe OHNE Storage-Kopie eine Vorschau in der
 * /buchhaltung-Oberfläche. Admin-only (wie die Seite selbst).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  if (!me?.is_admin) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const voucherId = req.nextUrl.searchParams.get('voucherId') ?? ''
  if (!/^\d{3,15}$/.test(voucherId)) return NextResponse.json({ error: 'voucherId nötig.' }, { status: 400 })
  const pdf = await pdfForVoucher(voucherId)
  if (!pdf) return NextResponse.json({ error: 'Kein Dokument zu diesem Beleg gefunden.' }, { status: 404 })
  const buf = Buffer.from(pdf.base64, 'base64')
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': pdf.mediaType,
      'Content-Disposition': 'inline; filename="beleg-' + voucherId + (pdf.mediaType === 'application/pdf' ? '.pdf"' : pdf.mediaType === 'image/png' ? '.png"' : '.jpg"'),
      'Cache-Control': 'private, max-age=300',
    },
  })
}

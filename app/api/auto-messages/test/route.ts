import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolvePlaceholders, demoContext, MAPPE_BTN_SENTINEL } from '@/lib/auto-messages'
import { sendAutoMessageEmail } from '@/lib/email'

/**
 * 📧 Test-Versand einer Auto-Nachricht (Phase B, §148): rendert den
 * MITGESCHICKTEN Editor-Stand (auch ungespeichert) mit Demo-Daten und mailt
 * ihn an die eigene Login-Adresse — inkl. Gästemappen-Button. Kein Gast
 * involviert, kein Log-Eintrag.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  const body = String(b.body ?? '').slice(0, 4000)
  if (!body.trim()) return NextResponse.json({ error: 'Kein Text zum Testen.' }, { status: 400 })

  const to = user.email
  if (!to) return NextResponse.json({ error: 'Eigene E-Mail nicht gefunden.' }, { status: 500 })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa.de'
  const demoMappe = `${siteUrl}/mappe/beispiel`
  const ctx = { ...demoContext(String(b.wohnung ?? '') || 'City Home', '16:00', '10:00'), mappe: demoMappe }
  const text = resolvePlaceholders(body.split('{mappe_button}').join(MAPPE_BTN_SENTINEL), ctx)
    .replace(/\{\w+\}/g, '').replace(/\n{3,}/g, '\n\n').trim()

  const res = await sendAutoMessageEmail({
    to, guestName: ctx.name, listingTitle: `TEST · ${ctx.wohnung}`,
    text, mappeUrl: demoMappe, lang: 'de',
  })
  if (!res.ok) return NextResponse.json({ error: res.error ?? 'Versand fehlgeschlagen.' }, { status: 500 })
  return NextResponse.json({ ok: true, an: to })
}

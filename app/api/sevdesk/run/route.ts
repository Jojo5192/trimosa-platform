import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runSevInvoiceRun } from '@/lib/sevdesk-engine'
import { migrateInvoiceCostCentres } from '@/lib/sevdesk'

/**
 * 🧾 sevdesk-Tageslauf (§235) — übernimmt ab dem Stichtag 02.08.2026 den
 * 15:00-Cron der lexoffice-Engine:
 *  GET  → Vercel-Cron 13:00 UTC (= 15:00 CEST) — Rechnungen für die
 *         heutigen (+ gestrigen Nachzügler-) Anreisen (Bearer CRON_SECRET).
 *  POST → Admin/Gastgeber: { dryRun: true } (Default) zeigt, was erstellt
 *         WÜRDE; { dryRun: false } stößt den Lauf manuell an.
 */
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  try {
    return NextResponse.json(await runSevInvoiceRun())
  } catch (err) {
    console.error('[sevdesk-engine] cron:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  try {
    const b = await request.json().catch(() => ({}))
    // §240: Bestand von Wohnungs- auf Standort-Kostenstellen umziehen
    if (b.action === 'kst-migrate') {
      const { data: listings } = await supabaseAdmin
        .from('listings').select('title, location_group').eq('is_active', true)
      const mapping: Record<string, string> = {}
      for (const l of listings ?? []) {
        if (l.location_group) mapping[String(l.title)] = String(l.location_group)
      }
      return NextResponse.json(await migrateInvoiceCostCentres(mapping, {
        dryRun: b.dryRun !== false,
        ...(typeof b.limit === 'number' ? { limit: b.limit } : {}),
      }))
    }
    return NextResponse.json(await runSevInvoiceRun({ dryRun: b.dryRun !== false }))
  } catch (err) {
    console.error('[sevdesk-engine] manual:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

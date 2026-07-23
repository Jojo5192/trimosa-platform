import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { BLOCK_META, type GuideBlock } from '@/lib/guide'

/**
 * 📖 Gästemappen-POOL (§150): EIN gemeinsamer Baustein-Bestand für alle
 * Wohnungen (app_settings 'guide_global'); je Baustein steuert listingIds,
 * für welche Wohnungen er gilt. Die öffentliche Mappe nutzt den Pool,
 * sobald er für die Wohnung Bausteine enthält — sonst das alte
 * listings.guide (sanfte Migration).
 */
export const dynamic = 'force-dynamic'
const MAX_BLOCKS = 200

async function requireHost() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
  return (me?.is_admin || me?.is_host) ? user : null
}

export async function PUT(req: NextRequest) {
  if (!(await requireHost())) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!Array.isArray(b.blocks)) return NextResponse.json({ error: 'blocks fehlt.' }, { status: 400 })
  if (b.blocks.length > MAX_BLOCKS) return NextResponse.json({ error: `Maximal ${MAX_BLOCKS} Bausteine.` }, { status: 400 })
  const blocks = (b.blocks as GuideBlock[]).filter(
    (x) => x && typeof x === 'object' && typeof x.type === 'string' && x.type in BLOCK_META,
  )
  const { error } = await supabaseAdmin.from('app_settings').upsert(
    { key: 'guide_global', value: { blocks } }, { onConflict: 'key' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, count: blocks.length })
}

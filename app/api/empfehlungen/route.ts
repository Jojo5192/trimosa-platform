import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { REGIONS } from '@/lib/regions'

/** The ISR pages showing recommendations — refresh them right after a write */
function revalidateGuidePages() {
  revalidatePath('/region/[slug]', 'page')
  revalidatePath('/erlebnis/[slug]', 'page')
}

/**
 * CRUD for the hosts' personal recommendations (/dashboard/empfehlungen).
 * Admin-only (Johannes/Pascal/Dominik). item_keys are validated against the
 * static catalogue in lib/regions.ts so no orphan entries can be written.
 */

async function requireAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return profile?.is_admin ? user : null
}

function validKeys(): Record<string, Set<string>> {
  const poi = new Set<string>()
  const kulinarik = new Set<string>()
  const tour = new Set<string>()
  for (const region of Object.values(REGIONS)) {
    region.pois.forEach((p) => {
      poi.add(p.slug)
      p.komootTours?.forEach((t) => tour.add(t.embedUrl))
    })
    region.kulinarik?.forEach((k) => kulinarik.add(k.name))
    region.komootTours?.forEach((t) => tour.add(t.embedUrl))
  }
  return { poi, kulinarik, tour }
}

export async function GET() {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const { data, error } = await supabaseAdmin
    .from('empfehlungen')
    .select('item_type, item_key, comment, author_id, profiles:author_id (display_name, avatar_url)')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).map((r) => {
    const p = (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles) as
      { display_name: string | null; avatar_url: string | null } | null
    return {
      item_type: r.item_type,
      item_key: r.item_key,
      comment: r.comment,
      author_id: r.author_id,
      author_name: p?.display_name?.trim().split(/\s+/)[0] || 'TRIMOSA',
      author_avatar: p?.avatar_url || null,
    }
  })
  return NextResponse.json({ userId: user.id, empfehlungen: rows })
}

export async function PUT(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const { item_type, item_key, comment } = await request.json()
  const catalog = validKeys()
  if (!(item_type in catalog) || typeof item_key !== 'string' || !catalog[item_type].has(item_key)) {
    return NextResponse.json({ error: 'Unbekannter Eintrag.' }, { status: 400 })
  }
  const text = typeof comment === 'string' ? comment.trim() : ''
  if (text.length === 0 || text.length > 500) {
    return NextResponse.json({ error: 'Kommentar muss 1–500 Zeichen lang sein.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('empfehlungen').upsert(
    { item_type, item_key, author_id: user.id, comment: text, updated_at: new Date().toISOString() },
    { onConflict: 'item_type,item_key,author_id' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateGuidePages()
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const { item_type, item_key } = await request.json()
  if (typeof item_type !== 'string' || typeof item_key !== 'string') {
    return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 })
  }
  const { error } = await supabaseAdmin
    .from('empfehlungen')
    .delete()
    .eq('item_type', item_type)
    .eq('item_key', item_key)
    .eq('author_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateGuidePages()
  return NextResponse.json({ ok: true })
}

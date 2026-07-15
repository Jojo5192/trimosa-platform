import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { translateListing, translationStatus } from '@/lib/listing-translate'

/**
 * Listing translations (EN/FR/NL):
 *   GET  → per-language status for the editor card (exists / fresh / updatedAt)
 *   POST → run the AI translation for all languages (owner or admin)
 */
export const maxDuration = 300

async function requireOwnerOrAdmin(listingId: string) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Nicht angemeldet', status: 401 as const }
  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('id, host_id, title, description, rooms, translations, slug')
    .eq('id', listingId)
    .single()
  if (!listing) return { error: 'Inserat nicht gefunden', status: 404 as const }
  if (listing.host_id !== user.id) {
    const { data: me } = await supabaseAdmin.from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
    if (!me?.is_admin && !me?.is_host) return { error: 'Keine Berechtigung', status: 403 as const }
  }
  return { listing }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const check = await requireOwnerOrAdmin(id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })
  return NextResponse.json({ status: translationStatus(check.listing) })
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const check = await requireOwnerOrAdmin(id)
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status })

  const result = await translateListing(id)

  // The public detail page renders translations server-side — bust its cache.
  revalidatePath(`/listing/${check.listing.slug ?? id}`)

  const { data: fresh } = await supabaseAdmin
    .from('listings').select('title, description, rooms, translations').eq('id', id).single()
  return NextResponse.json({ result, status: fresh ? translationStatus(fresh) : [] })
}

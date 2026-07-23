import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * 📷 Foto-Upload für Gästemappen-Bausteine (§150): multipart 'file'
 * (Client skaliert vorher auf JPEG ≤1600px — Task-Foto-Muster §89),
 * landet im listing-images-Bucket unter guide/… → öffentliche URL.
 */
export const dynamic = 'force-dynamic'
const MAX_BYTES = 8 * 1024 * 1024

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: me } = await supabaseAdmin
    .from('profiles').select('is_admin, is_host').eq('id', user.id).maybeSingle()
  if (!me?.is_admin && !me?.is_host) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Keine Datei erhalten.' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Datei zu groß (max. 8 MB).' }, { status: 400 })
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'Nur Bilder erlaubt.' }, { status: 400 })

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `guide/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await supabaseAdmin.storage
    .from('listing-images')
    .upload(path, buf, { contentType: file.type, upsert: false })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data: pub } = supabaseAdmin.storage.from('listing-images').getPublicUrl(path)
  return NextResponse.json({ ok: true, url: pub.publicUrl })
}

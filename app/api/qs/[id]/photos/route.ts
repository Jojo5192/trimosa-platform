import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'

/**
 * Fotos am QS-Protokoll (Muster = Task-Fotos):
 *  POST   → multipart 'file' (Client skaliert auf JPEG ≤1600px) — Upload in
 *           listing-images unter qs/<id>/…, Eintrag in qs_checks.photos.
 *  DELETE → { url } entfernt Foto (Assignee/Admin, solange nicht abgeschlossen).
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }
const MAX_BYTES = 8 * 1024 * 1024
const MAX_PHOTOS = 12

async function loadAuthorized(id: string) {
  const me = await getTaskAuth()
  if (!me) return { error: NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 }) }
  const { data: check } = await supabaseAdmin.from('qs_checks').select('*').eq('id', id).maybeSingle()
  if (!check) return { error: NextResponse.json({ error: 'Termin nicht gefunden.' }, { status: 404 }) }
  if (me.role !== 'admin' && check.assignee_id !== me.userId) {
    return { error: NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 }) }
  }
  return { me, check }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await loadAuthorized(id)
  if ('error' in res) return res.error
  const { me, check } = res
  if (check.status !== 'geplant') return NextResponse.json({ error: 'Protokoll ist bereits abgeschlossen.' }, { status: 400 })

  const photos = Array.isArray(check.photos) ? check.photos : []
  if (photos.length >= MAX_PHOTOS) return NextResponse.json({ error: `Maximal ${MAX_PHOTOS} Fotos je Protokoll.` }, { status: 400 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Keine Datei erhalten.' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Datei zu groß (max. 8 MB).' }, { status: 400 })
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'Nur Bilder erlaubt.' }, { status: 400 })

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `qs/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await supabaseAdmin.storage
    .from('listing-images')
    .upload(path, buf, { contentType: file.type, upsert: false })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data: pub } = supabaseAdmin.storage.from('listing-images').getPublicUrl(path)
  const entry = { url: pub.publicUrl, by: me.userId, at: new Date().toISOString() }
  const { error } = await supabaseAdmin
    .from('qs_checks')
    .update({ photos: [...photos, entry], updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, photo: entry }, NO_STORE)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const res = await loadAuthorized(id)
  if ('error' in res) return res.error
  const { check } = res
  if (check.status !== 'geplant') return NextResponse.json({ error: 'Protokoll ist bereits abgeschlossen.' }, { status: 400 })

  const { url } = await req.json().catch(() => ({}))
  const photos = (Array.isArray(check.photos) ? check.photos : []) as { url: string }[]
  const remaining = photos.filter((p) => p.url !== url)
  if (remaining.length === photos.length) return NextResponse.json({ error: 'Foto nicht gefunden.' }, { status: 404 })

  const marker = '/listing-images/'
  const idx = typeof url === 'string' ? url.indexOf(marker) : -1
  if (idx > -1) {
    await supabaseAdmin.storage.from('listing-images').remove([url.slice(idx + marker.length)]).catch(() => {})
  }

  const { error } = await supabaseAdmin
    .from('qs_checks')
    .update({ photos: remaining, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true }, NO_STORE)
}

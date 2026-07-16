import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth, canSeeTask } from '@/lib/tasks'

/**
 * Fotos an Aufgaben (z. B. Mangel-Foto vom Admin, Ergebnis-Foto vom Handwerker):
 *  POST   → multipart 'file' (Client skaliert vorher auf JPEG ≤1600px) —
 *           Upload in den bestehenden listing-images-Bucket unter tasks/<id>/…,
 *           URL wandert in tasks.photos [{url, by, at}].
 *  DELETE → { url } entfernt Foto (nur manage-Rechte).
 */
export const dynamic = 'force-dynamic'
const NO_STORE = { headers: { 'Cache-Control': 'no-store, must-revalidate' } }
const MAX_BYTES = 8 * 1024 * 1024
const MAX_PHOTOS = 12

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: task } = await supabaseAdmin.from('tasks').select('*').eq('id', id).maybeSingle()
  if (!task) return NextResponse.json({ error: 'Aufgabe nicht gefunden.' }, { status: 404 })
  if (!canSeeTask(auth, task)) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })

  const photos = Array.isArray(task.photos) ? task.photos : []
  if (photos.length >= MAX_PHOTOS) return NextResponse.json({ error: `Maximal ${MAX_PHOTOS} Fotos je Aufgabe.` }, { status: 400 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Keine Datei erhalten.' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Datei zu groß (max. 8 MB).' }, { status: 400 })
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'Nur Bilder erlaubt.' }, { status: 400 })

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `tasks/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await supabaseAdmin.storage
    .from('listing-images')
    .upload(path, buf, { contentType: file.type, upsert: false })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data: pub } = supabaseAdmin.storage.from('listing-images').getPublicUrl(path)
  const entry = { url: pub.publicUrl, by: auth.userId, at: new Date().toISOString() }
  const { error } = await supabaseAdmin
    .from('tasks')
    .update({ photos: [...photos, entry], updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, photo: entry }, NO_STORE)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getTaskAuth()
  if (!auth || !auth.manage) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: task } = await supabaseAdmin.from('tasks').select('photos').eq('id', id).maybeSingle()
  if (!task) return NextResponse.json({ error: 'Aufgabe nicht gefunden.' }, { status: 404 })

  const { url } = await req.json().catch(() => ({}))
  const photos = (Array.isArray(task.photos) ? task.photos : []) as { url: string }[]
  const remaining = photos.filter((p) => p.url !== url)
  if (remaining.length === photos.length) return NextResponse.json({ error: 'Foto nicht gefunden.' }, { status: 404 })

  // Storage-Objekt best-effort mitlöschen (Pfad aus der Public-URL)
  const marker = '/listing-images/'
  const idx = typeof url === 'string' ? url.indexOf(marker) : -1
  if (idx > -1) {
    await supabaseAdmin.storage.from('listing-images').remove([url.slice(idx + marker.length)]).catch(() => {})
  }

  const { error } = await supabaseAdmin
    .from('tasks')
    .update({ photos: remaining, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true }, NO_STORE)
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTaskAuth } from '@/lib/tasks'

/**
 * 💼 Anhang-Upload für den Team-Chat: liefert eine SIGNIERTE Upload-URL —
 * der Client lädt direkt zu Supabase Storage hoch (Videos/PDFs sprengen sonst
 * Vercels 4,5-MB-Body-Limit). Danach POST der Nachricht mit der publicUrl.
 */
export const dynamic = 'force-dynamic'

const ALLOWED: Record<string, { type: 'image' | 'video' | 'pdf'; ext: string }> = {
  'image/jpeg': { type: 'image', ext: 'jpg' },
  'image/png': { type: 'image', ext: 'png' },
  'image/webp': { type: 'image', ext: 'webp' },
  'video/mp4': { type: 'video', ext: 'mp4' },
  'video/quicktime': { type: 'video', ext: 'mov' },
  'video/webm': { type: 'video', ext: 'webm' },
  'application/pdf': { type: 'pdf', ext: 'pdf' },
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getTaskAuth()
  if (!auth) return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 403 })
  const { data: member } = await supabaseAdmin
    .from('team_chat_members').select('chat_id').eq('chat_id', id).eq('user_id', auth.userId).maybeSingle()
  if (!member) return NextResponse.json({ error: 'Kein Mitglied.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const mime = String(body.fileType ?? '')
  const meta = ALLOWED[mime]
  if (!meta) return NextResponse.json({ error: 'Dateityp nicht unterstützt (Bilder, Videos, PDF).' }, { status: 400 })

  const path = `team-chat/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${meta.ext}`
  const { data, error } = await supabaseAdmin.storage
    .from('listing-images')
    .createSignedUploadUrl(path)
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Upload-URL fehlgeschlagen.' }, { status: 500 })

  const { data: pub } = supabaseAdmin.storage.from('listing-images').getPublicUrl(path)
  return NextResponse.json({
    path: data.path,
    token: data.token,
    bucket: 'listing-images',
    publicUrl: pub.publicUrl,
    attachmentType: meta.type,
  })
}

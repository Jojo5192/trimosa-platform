import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdminOhneVorschau } from '@/lib/supabase-admin'
import {
  VORSCHAU_COOKIE, VORSCHAU_MAX_AGE_S, VORSCHAU_NAME, istVorschauRolle, leseVorschauCookie, vorschauCookieWert,
} from '@/lib/rollen-vorschau'

/**
 * 👀 Rollen-Vorschau (Mehr → „Ansicht als …", nur Chefs) — lib/rollen-vorschau.ts.
 *  GET            → { vorschau: 'host'|'staff'|'provider'|null, darf: boolean }
 *  POST { rolle } → setzt das signierte Cookie (nur is_admin der ECHTEN Zeile), 8 Stunden
 *  DELETE         → beendet die Vorschau (jeder, der das Cookie hat — es ist sein eigenes)
 * Immer über supabaseAdminOhneVorschau: der normale Client lieferte in der Vorschau is_admin = false.
 */
export const dynamic = 'force-dynamic'

async function echterNutzer(): Promise<{ id: string; isAdmin: boolean } | null> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: me } = await supabaseAdminOhneVorschau
    .from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  return { id: user.id, isAdmin: me?.is_admin === true }
}

export async function GET(request: NextRequest) {
  const me = await echterNutzer()
  if (!me) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  const v = leseVorschauCookie(request.cookies.get(VORSCHAU_COOKIE)?.value)
  return NextResponse.json({ vorschau: v && v.uid === me.id ? v.rolle : null, darf: me.isAdmin }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  const me = await echterNutzer()
  if (!me) return NextResponse.json({ error: 'Nicht angemeldet.' }, { status: 401 })
  if (!me.isAdmin) return NextResponse.json({ error: 'Die Rollen-Vorschau können nur Chefs einschalten.' }, { status: 403 })
  const body = await request.json().catch(() => ({})) as { rolle?: unknown }
  if (!istVorschauRolle(body.rolle)) return NextResponse.json({ error: 'Unbekannte Rolle.' }, { status: 400 })
  const wert = vorschauCookieWert(me.id, body.rolle)
  if (!wert) return NextResponse.json({ error: 'Vorschau nicht verfügbar (Server-Schlüssel fehlt).' }, { status: 500 })
  const res = NextResponse.json({ vorschau: body.rolle, name: VORSCHAU_NAME[body.rolle] })
  res.cookies.set(VORSCHAU_COOKIE, wert, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: VORSCHAU_MAX_AGE_S })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ vorschau: null })
  res.cookies.set(VORSCHAU_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 })
  return res
}

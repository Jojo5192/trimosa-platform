import { createClient } from '@supabase/supabase-js'
import { mitRollenVorschau } from '@/lib/rollen-vorschau'

/**
 * Service-role Supabase client — bypasses Row Level Security.
 * Use only in server-side API routes, never expose to the client.
 *
 * 👀 Rollen-Vorschau (7.10.2026, lib/rollen-vorschau.ts): Liest ein Request mit gültigem Vorschau-Cookie die
 * EIGENE Profilzeile (`from('profiles')…eq('id', <uid>)`), kommen die Rollen-Flags der Vorschau-Rolle zurück.
 * Alles andere ist unverändert. Wer die echte Zeile braucht (Vorschau setzen/prüfen), nimmt
 * supabaseAdminOhneVorschau.
 */
export const supabaseAdminOhneVorschau = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export const supabaseAdmin = mitRollenVorschau(supabaseAdminOhneVorschau)

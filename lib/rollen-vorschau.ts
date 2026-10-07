import { createHmac, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { istVorschauRolle, type VorschauRolle } from '@/lib/rollen-vorschau-namen'

/**
 * 👀 Rollen-Vorschau (Inhaber 7.10.2026): Chefs (is_admin) können sich die Team-App so ansehen, wie sie ein
 * Gastgeber, ein Mitarbeiter (Reinigung) oder ein Dienstleister sieht.
 *
 * Wie das wirkt: JEDE Rollen-Prüfung im Server-Code liest die Flags is_admin/is_host/is_staff/is_provider aus
 * der eigenen Profilzeile (über 90 Stellen, Muster `supabaseAdmin.from('profiles')…eq('id', user.id)`). Statt
 * alle Stellen anzufassen, hängt sich die Vorschau an den Service-Client (mitRollenVorschau in
 * lib/supabase-admin.ts): Ist das signierte Cookie gesetzt und gilt es für genau die Nutzer-ID, nach der die
 * Abfrage filtert, werden die Rollen-Flags der GELESENEN Zeile auf die Vorschau-Rolle gesetzt. Damit sehen
 * Seite (app/team/page.tsx), alle API-Routen und darüber die Panels dieselbe Rolle.
 *
 * Sicherheit: nur Herabstufung. Das Cookie stellt nur ein Admin aus (POST /api/team/vorschau prüft die ECHTE
 * Zeile über supabaseAdminOhneVorschau), es ist HMAC-signiert (Service-Key), an die Nutzer-ID gebunden und
 * läuft nach 8 Stunden ab. Zeilen anderer Nutzer (Empfängerlisten, Aufgaben-Ersteller …) bleiben unberührt,
 * SQL-seitige Filter (.or('is_admin.eq.true,…')) ebenfalls. Außerhalb eines Requests (Crons, Bot) gibt es
 * kein Cookie → keine Wirkung. Aktionen in der Vorschau wirken ECHT (gleiches Konto).
 */

export const VORSCHAU_COOKIE = 'tm-rollen-vorschau'
export const VORSCHAU_MAX_AGE_S = 8 * 60 * 60

export { VORSCHAU_ROLLEN, VORSCHAU_NAME, VORSCHAU_HINWEIS, istVorschauRolle } from '@/lib/rollen-vorschau-namen'
export type { VorschauRolle } from '@/lib/rollen-vorschau-namen'

export interface RollenFlags { is_admin: boolean; is_host: boolean; is_staff: boolean; is_provider: boolean }

/** Flags, die die Vorschau-Rolle hätte (genau EIN Flag gesetzt). */
export function vorschauFlags(rolle: VorschauRolle): RollenFlags {
  return { is_admin: false, is_host: rolle === 'host', is_staff: rolle === 'staff', is_provider: rolle === 'provider' }
}

/* ── Cookie: Wert = uid.rolle.ablauf.signatur ──────────── */

function geheimnis(): string | null {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY
  return s && s.length >= 16 ? s : null
}

function signatur(nutzlast: string, key: string): string {
  return createHmac('sha256', key).update(nutzlast).digest('base64url')
}

export function vorschauCookieWert(uid: string, rolle: VorschauRolle, jetztMs: number = Date.now()): string | null {
  const key = geheimnis()
  if (!key) return null
  const ablauf = Math.floor(jetztMs / 1000) + VORSCHAU_MAX_AGE_S
  const nutzlast = `${uid}.${rolle}.${ablauf}`
  return `${nutzlast}.${signatur(nutzlast, key)}`
}

export interface Vorschau { uid: string; rolle: VorschauRolle; ablauf: number }

/** Prüft Signatur und Ablauf; null bei allem, was nicht exakt passt. */
export function leseVorschauCookie(wert: string | null | undefined, jetztMs: number = Date.now()): Vorschau | null {
  if (!wert) return null
  const key = geheimnis()
  if (!key) return null
  const teile = wert.split('.')
  if (teile.length !== 4) return null
  const [uid, rolle, ablaufRoh, sig] = teile
  if (!/^[0-9a-f-]{36}$/i.test(uid) || !istVorschauRolle(rolle)) return null
  const ablauf = Number(ablaufRoh)
  if (!Number.isFinite(ablauf) || ablauf * 1000 < jetztMs) return null
  const soll = signatur(`${uid}.${rolle}.${ablauf}`, key)
  const a = Buffer.from(sig)
  const b = Buffer.from(soll)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return { uid, rolle, ablauf }
}

/**
 * Aktive Vorschau des laufenden Requests (Cookie). Außerhalb eines Requests (Cron, Bot, Build) wirft
 * next/headers — dann null. Pro Request wird höchstens einmal gelesen (WeakMap-Cache wäre hier nicht nötig:
 * cookies() ist billig, die Signaturprüfung auch).
 */
export async function aktiveVorschau(): Promise<Vorschau | null> {
  try {
    const { cookies } = await import('next/headers')
    const jar = await cookies()
    return leseVorschauCookie(jar.get(VORSCHAU_COOKIE)?.value)
  } catch {
    return null
  }
}

/* ── Anwenden auf gelesene Profilzeilen ────────────────── */

const FLAG_KEYS = ['is_admin', 'is_host', 'is_staff', 'is_provider'] as const

/**
 * Setzt die Rollen-Flags EINER Profilzeile auf die Vorschau-Rolle — nur, wenn die Zeile zur Vorschau-ID gehört
 * (per id-Feld oder per Filter) und, sofern lesbar, wirklich ein Admin ist (nur Herabstufung). Felder, die
 * die Abfrage nicht ausgewählt hat, werden nicht hinzugefügt.
 */
export function rollenAnwenden<T>(zeile: T, vorschau: Vorschau, gefilterteId: string | null): T {
  if (!zeile || typeof zeile !== 'object') return zeile
  const z = zeile as Record<string, unknown>
  const id = typeof z.id === 'string' ? z.id : gefilterteId
  if (id !== vorschau.uid) return zeile
  if ('is_admin' in z && z.is_admin !== true) return zeile
  const flags = vorschauFlags(vorschau.rolle)
  const neu: Record<string, unknown> = { ...z }
  for (const k of FLAG_KEYS) if (k in neu) neu[k] = flags[k]
  return neu as T
}

/**
 * Hüllt den Service-Client so ein, dass Abfragen auf `profiles` mit Filter `.eq('id', <Vorschau-ID>)` die
 * Rollen-Flags der Vorschau liefern. Alle anderen Tabellen, Filter und Abfragen laufen unverändert.
 * Technik: `.select()` liefert einen Builder, dessen Ketten-Methoden `this` zurückgeben — ein Proxy merkt sich
 * den id-Filter und bearbeitet das Ergebnis im `then` nach.
 */
export function mitRollenVorschau<T extends SupabaseClient>(client: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any
  return new Proxy(client, {
    get(ziel, prop, empfaenger) {
      if (prop !== 'from') return Reflect.get(ziel, prop, empfaenger)
      return (tabelle: string) => {
        const qb: Any = (ziel as Any).from(tabelle)
        if (tabelle !== 'profiles') return qb
        return new Proxy(qb, {
          get(qZiel, qProp) {
            const wert = Reflect.get(qZiel, qProp)
            if (qProp !== 'select' || typeof wert !== 'function') return typeof wert === 'function' ? wert.bind(qZiel) : wert
            return (...args: unknown[]) => {
              const fb: Any = wert.apply(qZiel, args)
              let gefilterteId: string | null = null
              const fbProxy: Any = new Proxy(fb, {
                get(fZiel, fProp) {
                  if (fProp === 'eq') {
                    return (spalte: string, v: unknown) => {
                      if (spalte === 'id' && typeof v === 'string') gefilterteId = v
                      fZiel.eq(spalte, v)
                      return fbProxy
                    }
                  }
                  if (fProp === 'then') {
                    return (onFulfilled?: (r: Any) => unknown, onRejected?: (e: unknown) => unknown) =>
                      fZiel.then((res: Any) => nachbearbeiten(res, gefilterteId)).then(onFulfilled, onRejected)
                  }
                  const v = Reflect.get(fZiel, fProp)
                  if (typeof v !== 'function') return v
                  return (...a: unknown[]) => {
                    const r = v.apply(fZiel, a)
                    return r === fZiel ? fbProxy : r
                  }
                },
              })
              return fbProxy
            }
          },
        })
      }
    },
  })
}

async function nachbearbeiten<R extends { data?: unknown }>(res: R, gefilterteId: string | null): Promise<R> {
  if (!res || !gefilterteId || res.data == null) return res
  const vorschau = await aktiveVorschau()
  if (!vorschau || vorschau.uid !== gefilterteId) return res
  const data = Array.isArray(res.data)
    ? res.data.map((z) => rollenAnwenden(z, vorschau, gefilterteId))
    : rollenAnwenden(res.data, vorschau, gefilterteId)
  return { ...res, data }
}

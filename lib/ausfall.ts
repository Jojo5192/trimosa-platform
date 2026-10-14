import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * 🚨 Ausfall-Meldungen für Hintergrund-Läufe (Server-Prüfung 9.10.2026, Lehre aus dem FeWo-Bewertungs-Abruf, der
 * wochenlang „ok, 0 geholt" meldete): Smoobu-Nachrichten-Abgleich, Mail-Scan, Auto-Nachrichten und Türcode-Anlage
 * antworteten bei einem Totalausfall trotzdem 200 — niemand merkte, dass keine Gast-Nachricht, keine Buchungsmail
 * oder keine Auto-Nachricht mehr ankam.
 *
 * meldeAusfall(): Team-Push (Kategorie 🔧 System) — höchstens alle 6 Stunden je Lauf, damit ein 10-Minuten-Cron
 * nicht alle 10 Minuten piept. ausfallBehoben(): beim nächsten erfolgreichen Lauf genau EINE Entwarnung, aber nur,
 * wenn vorher wirklich gewarnt wurde. Zustand in app_settings (Schlüssel ausfall:<lauf>), fail-soft: kann der
 * Zustand nicht gelesen/geschrieben werden, wird trotzdem gemeldet (lieber einmal zu oft als nie).
 */

const DROSSEL_MS = 6 * 3_600_000

interface AusfallZustand { seit: string; gemeldetAm: string | null; text: string; anzahl: number }

async function lese(key: string): Promise<AusfallZustand | null> {
  try {
    const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', `ausfall:${key}`).maybeSingle()
    const v = data?.value as Partial<AusfallZustand> | undefined
    return v && typeof v.seit === 'string' ? { seit: v.seit, gemeldetAm: v.gemeldetAm ?? null, text: String(v.text ?? ''), anzahl: Number(v.anzahl) || 1 } : null
  } catch {
    return null
  }
}

async function schreibe(key: string, z: AusfallZustand | null): Promise<void> {
  try {
    if (z) await supabaseAdmin.from('app_settings').upsert({ key: `ausfall:${key}`, value: z }, { onConflict: 'key' })
    else await supabaseAdmin.from('app_settings').delete().eq('key', `ausfall:${key}`)
  } catch (e) {
    console.error('[ausfall] Zustand nicht gespeichert:', key, e)
  }
}

function seitText(iso: string): string {
  const min = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  return min < 90 ? `seit ${min} Min.` : min < 48 * 60 ? `seit ${Math.round(min / 60)} Std.` : `seit ${Math.round(min / 1440)} Tagen`
}

/** Lauf ist ausgefallen. `titel` kurz („Smoobu-Nachrichten-Abgleich"), `text` = was passiert ist + was tun. */
export async function meldeAusfall(key: string, titel: string, text: string): Promise<void> {
  const jetzt = new Date().toISOString()
  const alt = await lese(key)
  const z: AusfallZustand = alt
    ? { ...alt, text: text.slice(0, 300), anzahl: alt.anzahl + 1 }
    : { seit: jetzt, gemeldetAm: null, text: text.slice(0, 300), anzahl: 1 }
  console.error(`[ausfall] ${titel}: ${text}`)
  const faellig = !z.gemeldetAm || Date.now() - Date.parse(z.gemeldetAm) >= DROSSEL_MS
  if (faellig) {
    try {
      const { sendPushToTeam } = await import('@/lib/push')
      await sendPushToTeam(`⚠️ Störung: ${titel}`, `${text.slice(0, 140)} (${seitText(z.seit)})`, '/team?tab=einstellungen', { category: 'system' })
      z.gemeldetAm = jetzt
    } catch (e) {
      console.error('[ausfall] Push fehlgeschlagen:', key, e)
    }
  }
  await schreibe(key, z)
}

/** Lauf ist wieder gesund — Entwarnung nur, wenn vorher gewarnt wurde. Billig: ein Lesezugriff je Lauf. */
export async function ausfallBehoben(key: string, titel: string): Promise<void> {
  const alt = await lese(key)
  if (!alt) return
  if (alt.gemeldetAm) {
    try {
      const { sendPushToTeam } = await import('@/lib/push')
      await sendPushToTeam(`✅ Läuft wieder: ${titel}`, `Die Störung ${seitText(alt.seit).replace('seit', 'von vor')} ist behoben.`, '/team?tab=einstellungen', { category: 'system' })
    } catch { /* egal */ }
  }
  await schreibe(key, null)
}

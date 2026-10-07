/**
 * 👀 Rollen-Vorschau — der client-taugliche Teil (keine Node-Importe): Rollen, Anzeigenamen, Typprüfung.
 * Server-Logik (Cookie, Signatur, Client-Hülle) steht in lib/rollen-vorschau.ts.
 */
export const VORSCHAU_ROLLEN = ['host', 'staff', 'provider'] as const
export type VorschauRolle = (typeof VORSCHAU_ROLLEN)[number]

export const VORSCHAU_NAME: Record<VorschauRolle, string> = {
  host: 'Gastgeber',
  staff: 'Mitarbeiter',
  provider: 'Dienstleister',
}

/** Kurz erklärt, was die Rolle in der App sieht (für den Umschalter unter „Mehr"). */
export const VORSCHAU_HINWEIS: Record<VorschauRolle, string> = {
  host: 'wie ein Gastgeber: Gäste-Chat, Kalender mit Preisen, Kennzahlen, aber keine Chef-Bereiche',
  staff: 'wie die Reinigung: Heute, Aufgaben, Intern — ohne Preise, Kennzahlen und Chef-Bereiche',
  provider: 'wie ein Dienstleister: nur Intern-Chat und zugewiesene Aufgaben',
}

export function istVorschauRolle(v: unknown): v is VorschauRolle {
  return typeof v === 'string' && (VORSCHAU_ROLLEN as readonly string[]).includes(v)
}

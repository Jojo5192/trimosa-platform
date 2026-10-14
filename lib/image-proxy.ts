/**
 * Welche externen Bild-URLs dürfen durch next/image (unser Bild-Optimierer /_next/image) laufen?
 * Muss images.remotePatterns in next.config.ts EXAKT spiegeln (Host UND Pfad): im Dev-Modus wirft
 * next/image für unbekannte Hosts, in Produktion antwortet /_next/image mit 400 (kaputtes Bild) —
 * deshalb vorher prüfen und sonst auf <img> zurückfallen.
 * Nebeneffekt des Proxys: Besucher kontaktieren Airbnb/Google/Booking/Facebook nicht mehr direkt
 * (Datenschutz), und 1200-px-Avatare kommen als 36-px-WebP an (Performance, 14.10.2026).
 */
const REGELN: Array<{ host: RegExp; pfad?: RegExp }> = [
  { host: /^wccrfgjzxpztfmnqpfiy\.supabase\.co$/i, pfad: /^\/storage\/v1\/object\/public\// },
  { host: /^upload\.wikimedia\.org$/i, pfad: /^\/wikipedia\/commons\// },
  { host: /^a0\.muscache\.com$/i },                                   // Airbnb-Avatare
  { host: /^[a-z0-9-]+(\.[a-z0-9-]+)*\.googleusercontent\.com$/i },   // Google-/Booking-Avatare (lh3…)
  { host: /^[a-z0-9-]+(\.[a-z0-9-]+)*\.bstatic\.com$/i },             // Booking-Standard-Avatare
  { host: /^graph\.facebook\.com$/i },                                // Booking-Avatare via Facebook (302 → fbcdn)
]

export function darfNextImage(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    return REGELN.some((r) => r.host.test(u.hostname) && (!r.pfad || r.pfad.test(u.pathname)))
  } catch {
    return false
  }
}

/**
 * Google-Avatare tragen einen Größenparameter (…=s1920-c-rp-mo-br100 → 1920-px-PNG, ~1,5 MB je Bild).
 * Für 36-px-Anzeige reicht s128; spart dem Optimierer ~99 % Upstream-Volumen. Andere Hosts unverändert.
 */
export function avatarSrc(url: string): string {
  try {
    const u = new URL(url)
    if (/\.googleusercontent\.com$/i.test(u.hostname)) return url.replace(/=s\d+(-[^=/?#]*)?$/, '=s128-c')
  } catch { /* ungültige URL → unverändert */ }
  return url
}

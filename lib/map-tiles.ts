/**
 * Kartenkacheln — die EINE Quelle für alle Leaflet-Karten der Seite
 * (Startseiten-Karte, Region, Erlebnis, Inserat, Genuss-Guide, Standort-Wähler
 * im Inserats-Editor). Client-sicher: keine Server-Importe.
 *
 * Hintergrund (4.10.2026): CARTO verlangt seit den Basemaps-Terms vom
 * 29.09.2026 einen API-Schlüssel. Ohne gültigen Schlüssel liefert
 * basemaps.cartocdn.com für JEDE Anfrage eine Wasserzeichen-Kachel
 * („API KEY REQUIRED", HTTP 200, kein Fehler) — alle Karten waren leer.
 *
 *  - Schlüssel: kostenlos unter https://carto.com/basemaps/apikey (E-Mail
 *    genügt, kein Konto). Im Formular „commercial" angeben — gewerbliche
 *    Nutzung ist bis 1 Mio. Kachel-Abrufe pro Kalendermonat frei. Der
 *    Schlüssel steht in jeder Kachel-URL, ist also öffentlich — er gehört in
 *    die Vercel-Env NEXT_PUBLIC_CARTO_KEY (wird beim Build eingebacken,
 *    danach neu deployen). Empfohlen: im CARTO-Dashboard auf die Website
 *    trimosa.de beschränken (Hosts müssen exakt passen; nicht gelistete
 *    Hosts bekommen HTTP 403 und landen dann auf der Ausweichkarte).
 *  - Ohne Schlüssel lädt die Karte die Standard-Kacheln von OpenStreetMap
 *    (kein Schlüssel nötig), per CSS-Filter an den ruhigen Look angenähert.
 *  - MIT Schlüssel prüft addBaseTiles() einmal je Browser-Sitzung, ob CARTO
 *    wirklich Karten liefert. Kommt das Wasserzeichen (Schlüssel vertippt,
 *    gelöscht, Kontingent erschöpft) oder schlagen die Kacheln fehl (403),
 *    wechselt die Karte von selbst auf OpenStreetMap — eine leere Karte
 *    bleibt so nie unbemerkt live.
 *
 * Namensnennung: Beide Anbieter verlangen sie sichtbar und LESBAR auf jeder
 * Karte (CARTO: „not hidden, faded or behind a click", sonst droht die
 * Sperrung des Schlüssels). Darum hier keine blassen Farben — die Gestaltung
 * steht im Block #trimosa-map-styles (RegionMap + ListingsMap).
 */

export type MapTileStyle = 'light' | 'voyager'

export interface MapTiles {
  /** Leaflet-URL-Vorlage */
  url: string
  /** Optionen für L.tileLayer */
  options: { subdomains?: string; maxZoom: number; className?: string }
  /** HTML für die Namensnennung */
  attribution: string
  provider: 'carto' | 'osm'
}

// Minimaler Ausschnitt der Leaflet-API (Leaflet kommt als window.L vom CDN).
interface TileLayerLike {
  addTo(map: MapLike): TileLayerLike
  on(event: string, handler: () => void): unknown
}
interface AttributionLike {
  addAttribution(html: string): AttributionLike
  removeAttribution(html: string): AttributionLike
  addTo(map: MapLike): AttributionLike
}
interface MapLike {
  removeLayer(layer: TileLayerLike): unknown
  getPane(name: string): unknown
}
interface LeafletLike {
  tileLayer(url: string, options: MapTiles['options']): TileLayerLike
  control: { attribution(options: { position: string; prefix: boolean }): AttributionLike }
}

// Nur URL-sichere Zeichen zulassen — ein vertippter Env-Wert darf keine
// kaputte Kachel-URL erzeugen (dann lieber gleich die Ausweichkarte).
const RAW_KEY = (process.env.NEXT_PUBLIC_CARTO_KEY ?? '').trim()
const CARTO_KEY = /^[A-Za-z0-9._~-]{8,200}$/.test(RAW_KEY) ? RAW_KEY : ''

// Wortlaut und Linkziele exakt nach https://carto.com/attribution/ bzw. der
// OSM-Kachel-Richtlinie.
const OSM_CREDIT = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
const CARTO_CREDIT = '© <a href="https://carto.com/attribution/" target="_blank" rel="noopener">CARTO</a>'

function cartoTiles(style: MapTileStyle): MapTiles {
  // Die seit Jahren genutzten Pfade — laut CARTO genügt es, an jede
  // basemaps.cartocdn.com-URL ?key=<key> anzuhängen.
  const path = style === 'voyager' ? 'rastertiles/voyager' : 'light_all'
  return {
    url: `https://{s}.basemaps.cartocdn.com/${path}/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
    options: { subdomains: 'abcd', maxZoom: 19 },
    attribution: `${OSM_CREDIT}, ${CARTO_CREDIT}`,
    provider: 'carto',
  }
}

function osmTiles(style: MapTileStyle): MapTiles {
  // Exakt die von der OSM-Kachel-Richtlinie verlangte URL (https, keine
  // Subdomains). Die Klasse landet auf dem Layer-Container und steuert den
  // Farbfilter (siehe ensureOsmStyles).
  return {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, className: style === 'voyager' ? 'trimosa-osm-voyager' : 'trimosa-osm-light' },
    attribution: OSM_CREDIT,
    provider: 'osm',
  }
}

/** Kachel-Quelle laut Konfiguration: CARTO mit Schlüssel, sonst OpenStreetMap. */
export function mapTiles(style: MapTileStyle): MapTiles {
  return CARTO_KEY ? cartoTiles(style) : osmTiles(style)
}

// Die OSM-Standardkarte ist kräftig bunt; die Filter holen sie nah an den
// gewohnten ruhigen Look, damit die goldenen Marker im Vordergrund bleiben.
// Die Spezifität schlägt die Filter aus den Karten-Komponenten
// (.trimosa-searchmap / .trimosa-map-voyager).
function ensureOsmStyles(): void {
  const id = 'trimosa-osm-tile-styles'
  if (typeof document === 'undefined' || document.getElementById(id)) return
  const el = document.createElement('style')
  el.id = id
  el.textContent = `
    .leaflet-container .leaflet-layer.trimosa-osm-light .leaflet-tile {
      filter: grayscale(0.72) sepia(0.14) contrast(0.92) brightness(1.07);
    }
    .leaflet-container .leaflet-layer.trimosa-osm-voyager .leaflet-tile {
      filter: saturate(0.78) contrast(0.96) brightness(1.03);
    }
  `
  document.head.appendChild(el)
}

function writeMemo(style: MapTileStyle, ok: boolean): void {
  try { window.sessionStorage.setItem(memoKey(style), ok ? '1' : '0') } catch { /* egal */ }
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}

// Liefert CARTO mit unserem Schlüssel echte Karten? Bei unbekanntem Schlüssel
// antwortet CARTO mit HTTP 200 und dem Wasserzeichen — erkennbar nur daran,
// dass zwei völlig verschiedene Kartenausschnitte (Mitteleuropa und
// Nordamerika) bytegleich zurückkommen. Das bleibt richtig, auch wenn CARTO
// das Wasserzeichen einmal umgestaltet. Bei einer Website-Beschränkung, die
// den aktuellen Host nicht enthält, kommt HTTP 403. Beides heißt: ausweichen.
// Ergebnis je Browser-Sitzung gemerkt (zwei kleine Abrufe pro Sitzung und Stil).
const probes: Partial<Record<MapTileStyle, Promise<boolean>>> = {}

const memoKey = (style: MapTileStyle) => `trimosa-carto-${style}-${CARTO_KEY.slice(-6)}`

function readMemo(style: MapTileStyle): boolean | null {
  try {
    const known = window.sessionStorage.getItem(memoKey(style))
    return known === '1' ? true : known === '0' ? false : null
  } catch {
    return null // Speicher gesperrt (privater Modus) — dann eben prüfen
  }
}

function cartoWorks(style: MapTileStyle): Promise<boolean> {
  const running = probes[style]
  if (running) return running
  const probe = (async (): Promise<boolean> => {
    const known = readMemo(style)
    if (known !== null) return known

    let ok: boolean
    let timer: number | undefined
    try {
      const ctrl = new AbortController()
      timer = window.setTimeout(() => ctrl.abort(), 6000)
      const retina = window.devicePixelRatio > 1 ? '@2x' : ''
      const tile = (x: number, y: number) =>
        cartoTiles(style).url
          .replace('{s}', 'a').replace('{z}', '4')
          .replace('{x}', String(x)).replace('{y}', String(y)).replace('{r}', retina)
      const [a, b] = await Promise.all([
        // no-store: echte Kacheln sind monatelang cachebar — aus dem Browser-Cache
        // beantwortet, würde die Prüfung einen später gesperrten Schlüssel nie bemerken.
        fetch(tile(8, 5), { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' }),
        fetch(tile(4, 5), { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' }),
      ])
      if (!a.ok || !b.ok) ok = false
      else ok = !sameBytes(await a.arrayBuffer(), await b.arrayBuffer())
    } catch {
      // Netz weg, Zeitüberschreitung, Werbeblocker: daraus lässt sich nichts
      // ableiten — CARTO behalten und beim nächsten Seitenaufruf neu prüfen.
      delete probes[style]
      return true
    } finally {
      if (timer !== undefined) window.clearTimeout(timer)
    }
    writeMemo(style, ok)
    if (!ok) console.warn('[map-tiles] CARTO liefert das Wasserzeichen statt Karten — Schlüssel in NEXT_PUBLIC_CARTO_KEY prüfen. Karte läuft auf OpenStreetMap.')
    return ok
  })()
  probes[style] = probe
  return probe
}

/**
 * Hängt Grundkarte und Namensnennung an eine Leaflet-Karte. Die Karte muss
 * mit attributionControl: false angelegt sein (die Kontrolle kommt von hier).
 */
export function addBaseTiles(L: LeafletLike, map: MapLike, style: MapTileStyle): void {
  // In dieser Sitzung schon als gestört erkannt? Dann gleich die Ausweichkarte,
  // ohne erst Wasserzeichen-Kacheln anzufordern.
  const first = CARTO_KEY && readMemo(style) !== false ? cartoTiles(style) : osmTiles(style)
  if (first.provider === 'osm') ensureOsmStyles()
  const credit = L.control.attribution({ position: 'bottomleft', prefix: false })
    .addAttribution(first.attribution)
    .addTo(map)
  const layer = L.tileLayer(first.url, first.options).addTo(map)
  if (first.provider !== 'carto') return

  let swapped = false
  const toOsm = () => {
    if (swapped) return
    swapped = true
    try {
      // Karte inzwischen entfernt (Seitenwechsel, Neuaufbau)? Dann nichts tun.
      if (!map.getPane('tilePane')) return
      const osm = osmTiles(style)
      ensureOsmStyles()
      map.removeLayer(layer)
      credit.removeAttribution(first.attribution)
      credit.addAttribution(osm.attribution)
      L.tileLayer(osm.url, osm.options).addTo(map)
    } catch { /* Karte wurde währenddessen abgebaut */ }
  }

  // Netz 1: Wasserzeichen trotz HTTP 200 (Schlüssel unbekannt, Kontingent leer).
  void cartoWorks(style).then((ok) => { if (!ok) toOsm() })

  // Netz 2: CARTO lehnt die Kacheln ab (HTTP 403 bei Website-Beschränkung für
  // einen nicht gelisteten Host). Solche Antworten kann die Prüfung oben nicht
  // lesen, wenn ihnen der CORS-Header fehlt — die Kachel-Fehler sieht Leaflet
  // aber immer. Drei Fehler ohne eine einzige geladene Kachel → ausweichen.
  let loaded = 0
  let failed = 0
  layer.on('tileload', () => { loaded++ })
  layer.on('tileerror', () => {
    failed++
    if (loaded === 0 && failed >= 3 && !swapped) {
      writeMemo(style, false)
      console.warn('[map-tiles] CARTO-Kacheln laden nicht (403/Netz) — Karte läuft auf OpenStreetMap.')
      toOsm()
    }
  })
}

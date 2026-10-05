/**
 * FeWo-direkt-Bewertungen (5.10.2026) — reine Bausteine OHNE Seiteneffekte (nur 'crypto', kein
 * '@/'-Import), damit sie sich ohne Env und Datenbank testen lassen. Den Lauf selbst (Apify, Supabase)
 * steuert lib/reviews-sync.ts.
 *
 * Hintergrund: Expedia rendert die Bewertungen nicht mehr ins Seiten-HTML. Dort stehen nur noch Note,
 * Anzahl und die Expedia-Property-ID; die Texte kommen per POST /graphql (persistierte Abfrage).
 * Deshalb zwei Schritte in EINEM Lauf von apify~cheerio-scraper:
 *   1. GET Listing-Seite   → Note, Anzahl, Property-ID
 *   2. POST /graphql       → Bewertungen aus data.productReviewDetails.reviews.details
 *
 * Env-Übersteuerung (alle optional — ein Wechsel bei Expedia ist ohne Code-Änderung behebbar):
 *   FEWO_REVIEWS_QUERY_HASH   sha256 der persistierten Abfrage (ändert sich, wenn Expedia die Abfrage ändert)
 *   FEWO_REVIEWS_OPERATION    Name der Abfrage
 *   FEWO_REVIEWS_SORT_URN     Sortier-Wert „Neueste"; 'aus' = ohne Sortierung (Portal-Standard „Relevanteste")
 *   FEWO_GRAPHQL_URL · FEWO_CLIENT_INFO · FEWO_SITE_ID · FEWO_EAPID · FEWO_TPID · FEWO_LOCALE · FEWO_CURRENCY
 */
import { createHash, randomUUID } from 'crypto'

/* ── Konstanten ─────────────────────────────────────────── */

const env = (name: string, fallback: string): string => process.env[name]?.trim() || fallback
const envZahl = (name: string, fallback: number): number => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const FEWO_GRAPHQL_URL = env('FEWO_GRAPHQL_URL', 'https://www.fewo-direkt.de/graphql')
export const FEWO_REVIEWS_QUERY_HASH = env('FEWO_REVIEWS_QUERY_HASH', '5d801d9b6cd0a13885881999fe810b4e5b489aec8dfd7ab0fbe25278c2ef2279')
export const FEWO_REVIEWS_OPERATION = env('FEWO_REVIEWS_OPERATION', 'PWAReviewsSortingAndFiltersRevampQuery')
/** Ohne diesen Header antwortet Expedia mit 403 CLIENT_INFO_HEADER_NOT_PRESENT. */
export const FEWO_CLIENT_INFO = env('FEWO_CLIENT_INFO', 'landing-pwa')
/** „Neueste zuerst" — der Portal-Standard ist „Relevanteste". Wichtig, sobald eine Wohnung mehr Bewertungen
 *  hat, als ein Lauf holt. Der Wert steht in jeder Antwort unter sortAndFilter (Option „Neueste"). */
const SORT_ROH = env('FEWO_REVIEWS_SORT_URN', 'urn:expediagroup:taxonomies:core:#e9f32feb-5946-4b19-a6f2-8206edc7a130')
export const FEWO_REVIEWS_SORT_URN: string | null = /^(aus|off|0|-)$/i.test(SORT_ROH) ? null : SORT_ROH
export const FEWO_KONTEXT = {
  siteId: envZahl('FEWO_SITE_ID', 9003020),
  eapid: envZahl('FEWO_EAPID', 20),
  tpid: envZahl('FEWO_TPID', 9003),
  locale: env('FEWO_LOCALE', 'de_DE'),
  currency: env('FEWO_CURRENCY', 'EUR'),
}
/** Mehr als 50 je Antwort ist ungetestet (50 lieferte am 5.10. alle 26 der Sunrise Suite in einer Antwort). */
const FEWO_SEITE_MAX = 50
const FEWO_GQL_SEITEN_MAX = 4

/**
 * Such-Muster fürs Seiten-HTML als Regex-QUELLTEXT: dieselben Zeichenketten gehen per customData in den
 * Actor (dort `new RegExp(…, 'i')`) und werden hier von leseFewoSeite benutzt — eine Quelle, testbar.
 * Je Feld gewinnt der erste Treffer, Gruppe 1 ist der Wert.
 */
export const FEWO_MUSTER: Record<'score' | 'count' | 'propertyId', string[]> = {
  score: [
    '([0-9]+(?:,[0-9]+)?) von 10[.]',
    'itemprop="ratingValue"[^>]{0,40}content="([0-9]+(?:[.,][0-9]+)?)"',
  ],
  // reviewCount stimmt auch bei genau 1 Bewertung („1 Bewertung anzeigen" statt „Alle N Bewertungen anzeigen")
  count: [
    'itemprop="reviewCount"[^>]{0,40}content="([0-9]+)"',
    '(?:Alle )?([0-9]+) Bewertung(?:en)? anzeigen',
    '([0-9]+) gepr.{1,8}fte Bewertung',
  ],
  // Expedia-Property-ID — NICHT die Zahl aus der URL (p5399650 → 96767495)
  propertyId: [
    'itemprop="identifier"[^>]{0,40}content="([0-9]{5,12})"',
    'content="([0-9]{5,12})"[^>]{0,40}itemprop="identifier"',
    // bewusst KEIN Rückfall auf 'productId=…' aus Links: der könnte eine fremde Unterkunft treffen —
    // dann lieber der klare Fehler „Property-ID nicht gefunden" als fremde Bewertungen.
  ],
}

/* ── GraphQL-Anfrage ────────────────────────────────────── */

/** Der am 5.10.2026 real getestete Anfrage-Körper (ein Array mit EINER Operation). */
export function buildFewoGqlBody(
  propertyId: string,
  pageIndex: number,
  opts: { size: number; sortUrn?: string | null; duaid?: string; hash?: string },
): unknown[] {
  return [{
    operationName: FEWO_REVIEWS_OPERATION,
    variables: {
      productIdentifier: {
        id: String(propertyId),
        type: 'PROPERTY_ID',
        travelSearchCriteria: {
          property: {
            primary: { dateRange: null, rooms: [{ adults: 2 }], destination: {} },
            secondary: {
              selections: opts.sortUrn ? [{ id: 'sortBy', value: opts.sortUrn }] : [],
              counts: [{ id: 'pageIndex', value: pageIndex }, { id: 'size', value: opts.size }],
            },
          },
        },
      },
      context: {
        siteId: FEWO_KONTEXT.siteId,
        locale: FEWO_KONTEXT.locale,
        eapid: FEWO_KONTEXT.eapid,
        tpid: FEWO_KONTEXT.tpid,
        currency: FEWO_KONTEXT.currency,
        device: { type: 'DESKTOP' },
        identity: { duaid: opts.duaid ?? '00000000-0000-4000-8000-000000000000', authState: 'ANONYMOUS' },
        privacyTrackingState: 'CAN_NOT_TRACK',
      },
    },
    extensions: { persistedQuery: { version: 1, sha256Hash: opts.hash ?? FEWO_REVIEWS_QUERY_HASH } },
  }]
}

/* ── pageFunction (läuft als TEXT im Actor) ─────────────── */

/**
 * Läuft im Actor ohne Zugriff auf unseren Code — bewusst klein: Rohdaten + je Schritt ein Diagnose-Item
 * (__fewo: 'seite' | 'gql' | 'bewertung'); die Auswertung macht auswerteFewoLauf.
 * Absichtlich OHNE Backslashes, Backticks und Dollar-Klammern (Template-Literal), Muster und
 * Anfrage-Vorlage kommen über customData.
 *  - body ist bei HTML ein String, bei JSON ein Buffer; context.json liefert null bei anderem
 *    Content-Type und WIRFT bei kaputtem JSON — alles abgefangen.
 *  - 401/403/429 erreichen die Funktion nie: Crawlee wiederholt sie mit neuer Proxy-IP und legt am Ende
 *    nur ein Item mit '#error' ab (deshalb der Abruf OHNE clean=true).
 *  - Unbrauchbare Antworten ohne Fehlertext werden softRetries-mal neu versucht (neue IP), dann gemeldet.
 */
export const FEWO_PAGE_FUNCTION = `async function pageFunction(context) {
  var request = context.request || {};
  var ud = request.userData || {};
  var cfg = context.customData || {};
  var status = context.response ? context.response.status : null;
  var retryCount = request.retryCount || 0;
  var softRetries = typeof cfg.softRetries === 'number' ? cfg.softRetries : 2;
  if (typeof context.skipLinks === 'function') context.skipLinks();

  function short(e, n) { return String(e && e.message ? e.message : e).slice(0, n || 200); }
  function bodyText() {
    var b = context.body;
    if (typeof b === 'string') return b;
    if (b && typeof b.toString === 'function') return b.toString('utf8');
    return '';
  }
  // payload MUSS ein String sein; content-type setzt Crawlee nicht von selbst.
  function enqueueGql(propertyId, pageIndex, bisher, ohneSort, size, nr) {
    var body = JSON.parse(JSON.stringify(cfg.gqlVorlage));
    var pi = body[0].variables.productIdentifier;
    var sec = pi.travelSearchCriteria.property.secondary;
    pi.id = String(propertyId);
    sec.counts.forEach(function (c) { if (c.id === 'pageIndex') c.value = pageIndex; if (c.id === 'size') c.value = size; });
    if (ohneSort) sec.selections = [];
    return context.enqueueRequest({
      url: cfg.gqlUrl,
      method: 'POST',
      payload: JSON.stringify(body),
      // gleiche URL fuer jeden POST: eigener Schluessel, damit die Queue Folgeseiten nie als Dublette verwirft
      uniqueKey: 'gql-' + propertyId + '-' + pageIndex + '-' + size + (ohneSort ? '-ohne' : ''),
      headers: { 'content-type': 'application/json', 'client-info': cfg.clientInfo },
      userData: { label: 'gql', propertyId: String(propertyId), pageIndex: pageIndex, bisher: bisher, ohneSort: !!ohneSort, size: size, nr: nr },
    });
  }

  // ---------- Schritt 2: Antwort von POST /graphql ----------
  if (ud.label === 'gql') {
    var size = ud.size || cfg.size;
    var nr = ud.nr || 1;
    var info = {
      __fewo: 'gql', status: status, contentType: context.contentType ? context.contentType.type : null,
      propertyId: ud.propertyId || null, pageIndex: ud.pageIndex || 0, retryCount: retryCount,
      sortiert: !ud.ohneSort, size: size, nr: nr, anzahl: null, hasMore: false,
    };
    var data = null;
    try { data = context.json; } catch (e1) { info.jsonError = short(e1, 120); }
    if (data === null || data === undefined) {
      var raw = bodyText();
      info.len = raw.length;
      try { data = JSON.parse(raw); } catch (e2) { info.parseError = short(e2, 120); info.snippet = raw.slice(0, 200); }
    }
    var first = Array.isArray(data) ? data[0] : data;
    if (first && Array.isArray(first.errors) && first.errors.length) {
      info.errors = first.errors.slice(0, 4).map(function (er) {
        var code = er && er.extensions && er.extensions.code ? ' [' + er.extensions.code + ']' : '';
        return short(er && er.message ? er.message : JSON.stringify(er), 160) + code;
      });
    }
    var prd = first && first.data ? first.data.productReviewDetails : null;
    var reviews = prd ? prd.reviews : null;
    var details = reviews && Array.isArray(reviews.details) ? reviews.details : null;
    if (!details) {
      var hashWeg = info.errors && info.errors.join(' ').toLowerCase().indexOf('persistedquery') >= 0;
      // Sortier-Wert abgelehnt? Einmal ohne Sortierung nachfragen (Portal-Standard).
      if (info.errors && !hashWeg && !ud.ohneSort && cfg.sortiert && ud.propertyId) {
        try { await enqueueGql(ud.propertyId, info.pageIndex, ud.bisher || 0, true, size, nr); info.ohneSortEnqueued = true; } catch (e3) { info.enqueueError = short(e3); }
        return [info];
      }
      if (!info.errors && retryCount < softRetries) throw new Error('gql: unerwartete Antwort, HTTP ' + status);
      if (!info.snippet) { try { info.snippet = JSON.stringify(first).slice(0, 200); } catch (e4) { info.snippet = ''; } }
      return [info];
    }
    info.anzahl = details.length;
    info.hasMore = reviews.pagination !== null && reviews.pagination !== undefined;

    var texts = function (arr) {
      if (!Array.isArray(arr)) return [];
      return arr.map(function (m) { return m && m.text ? String(m.text) : ''; }).filter(Boolean);
    };
    var items = details.map(function (d) {
      var s = d && d.summary ? d.summary : {};
      var r = d && d.review ? d.review : {};
      return {
        __fewo: 'bewertung', pageIndex: info.pageIndex,
        id: d && d.id ? String(d.id) : null,
        primary: s.primary || null, label: s.accessibilityLabel || null, author: s.secondary || null,
        stay: texts(s.supportingMessages), title: r.title || null, text: r.text || null,
      };
    });
    // Nachladen, solange Expedia einen Weiter-Knopf meldet und die Obergrenze nicht erreicht ist.
    // Kam weniger als angefragt (Expedia deckelt die Seitengroesse), mit der GELIEFERTEN Groesse
    // weiterblaettern - sonst wuerde der naechste Seitenindex Bewertungen ueberspringen.
    var bisher = (ud.bisher || 0) + details.length;
    if (info.hasMore && details.length > 0 && bisher < cfg.maxReviews && nr < cfg.maxGqlPages && ud.propertyId) {
      var gedeckelt = details.length < size;
      var nSize = gedeckelt ? details.length : size;
      var nIndex = gedeckelt ? Math.floor(bisher / nSize) : info.pageIndex + 1;
      try { await enqueueGql(ud.propertyId, nIndex, bisher, ud.ohneSort, nSize, nr + 1); info.nextEnqueued = true; } catch (e5) { info.enqueueError = short(e5); }
    }
    return [info].concat(items);
  }

  // ---------- Schritt 1: Listing-Seite (GET, HTML) ----------
  var html = bodyText();
  var seite = {
    __fewo: 'seite', status: status, len: html.length, retryCount: retryCount,
    title: ((html.match(/<title[^>]*>([^<]*)/i) || [])[1] || '').slice(0, 120),
    roh: {}, gqlEnqueued: false,
  };
  Object.keys(cfg.muster || {}).forEach(function (key) {
    var liste = cfg.muster[key] || [];
    for (var i = 0; i < liste.length; i++) {
      var m = html.match(new RegExp(liste[i], 'i'));
      if (m) { seite.roh[key] = m[1]; break; }
    }
  });
  if (!seite.roh.propertyId) {
    // Weder ID noch Note: vermutlich Bot-Seite -> begrenzt neu versuchen, danach mit Ausschnitt melden.
    if (!seite.roh.score && status !== 404 && retryCount < softRetries) throw new Error('seite: weder Property-ID noch Note gefunden, HTTP ' + status);
    seite.snippet = html.slice(0, 200);
  } else if (!cfg.hashGesetzt) {
    seite.enqueueError = 'hash fehlt';
  } else {
    try { await enqueueGql(seite.roh.propertyId, 0, 0, false, cfg.size, 1); seite.gqlEnqueued = true; } catch (e6) { seite.enqueueError = short(e6); }
  }
  return [seite];
}`

/** Eingabe für apify~cheerio-scraper. `maxReviews` = Obergrenze je Lauf (MAX_REVIEWS_PER_RUN). */
export function buildFewoActorInput(url: string, maxReviews: number, duaid: string = randomUUID()): Record<string, unknown> {
  const max = Math.max(1, Math.floor(maxReviews))
  // So wenige POSTs wie möglich: /graphql drosselt nach wenigen Abrufen (HTTP 429) — im Normalfall genügt EINER.
  const size = Math.min(FEWO_SEITE_MAX, max)
  // Seitenbudget NICHT aus der angefragten Größe ableiten: liefert Expedia weniger als angefragt (Deckelung)
  // und meldet einen Weiter-Knopf, muss nachgeladen werden können. Schluss ist bei maxReviews bzw. ohne Knopf.
  const maxGqlPages = FEWO_GQL_SEITEN_MAX
  return {
    startUrls: [{ url }],
    pageFunction: FEWO_PAGE_FUNCTION,
    customData: {
      gqlUrl: FEWO_GRAPHQL_URL,
      clientInfo: FEWO_CLIENT_INFO,
      gqlVorlage: buildFewoGqlBody('0', 0, { size, sortUrn: FEWO_REVIEWS_SORT_URN, duaid }),
      hashGesetzt: !!FEWO_REVIEWS_QUERY_HASH,
      sortiert: !!FEWO_REVIEWS_SORT_URN,
      muster: FEWO_MUSTER,
      maxReviews: max,
      size,
      maxGqlPages,
      softRetries: 2,
    },
    // 1 Seite + GraphQL-Seiten + 1 Nachfrage ohne Sortierung. Mit dem früheren Wert 1 würde der POST
    // eingereiht, aber nie ausgeführt.
    maxPagesPerCrawl: maxGqlPages + 2,
    maxConcurrency: 1,
    // Expedia's bot protection blocks probabilistically — retry generously
    // with rotating German residential IPs (most natural for fewo-direkt.de).
    maxRequestRetries: 10,
    // Hängende Proxys früh aufgeben, damit beide Schritte ins Zeitlimit des Laufs passen
    pageLoadTimeoutSecs: 30,
    pageFunctionTimeoutSecs: 30,
    // Content-Type der 200-Antwort von /graphql ist nicht gemessen — unbekannte Typen würden sonst ohne Wiederholung scheitern
    additionalMimeTypes: ['application/graphql-response+json', 'text/plain'],
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: 'DE' },
  }
}

/* ── Auswertung ─────────────────────────────────────────── */

export interface FewoSeite {
  score: number | null       // Portal-Skala 0–10
  count: number | null
  propertyId: string | null
}

function deuteSeite(roh: Record<string, unknown> | null | undefined): FewoSeite {
  const score = roh?.score != null ? parseFloat(String(roh.score).replace(',', '.')) : NaN
  const count = roh?.count != null ? parseInt(String(roh.count), 10) : NaN
  const pid = roh?.propertyId != null ? String(roh.propertyId) : ''
  return {
    score: Number.isFinite(score) && score > 0 && score <= 10 ? score : null,
    count: Number.isFinite(count) && count >= 0 ? count : null,
    propertyId: /^\d{5,12}$/.test(pid) ? pid : null,
  }
}

/** Note, Anzahl und Property-ID aus dem rohen Seiten-HTML — dieselben Muster wie im Actor. */
export function leseFewoSeite(html: string): FewoSeite {
  const roh: Record<string, string> = {}
  for (const [key, liste] of Object.entries(FEWO_MUSTER)) {
    for (const quelle of liste) {
      const m = html.match(new RegExp(quelle, 'i'))
      if (m) { roh[key] = m[1]; break }
    }
  }
  return deuteSeite(roh)
}

/** Eine Bewertung in der Form, die normalizeScraperItem (lib/reviews-sync.ts) versteht. */
export interface FewoItem {
  id: string | null
  author: string | null
  rating: number             // schon auf 1–5 umgerechnet (Portal: N/10)
  reviewText: string | null
  reviewDate: string | null  // YYYY-MM-DD, 1. des Aufenthaltsmonats
}

const MONATE: Record<string, number> = { jan: 1, feb: 2, 'mär': 3, mar: 3, mrz: 3, apr: 4, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dez: 12 }

/** „Aufenthalt von 3 Nächten im Mai 2026" → 2026-05-01 (das Portal nennt kein Veröffentlichungsdatum). */
function datumAusAufenthalt(stay: unknown): string | null {
  for (const t of Array.isArray(stay) ? stay : []) {
    // NFC + normale Leerzeichen: „März" mit zerlegtem Umlaut oder geschütztes Leerzeichen träfe sonst nicht
    const m = String(t).normalize('NFC').replace(/[\u00a0\u202f]/g, ' ').match(/\bim ([A-Za-zÄÖÜäöü]{3,})\.? (\d{4})/)
    const mon = m ? MONATE[m[1].toLowerCase().slice(0, 3)] : undefined
    if (m && mon) return `${m[2]}-${String(mon).padStart(2, '0')}-01`
  }
  return null
}

/** Ersatz, falls der Aufenthaltstext fehlt: die Bewertungs-ID ist eine ObjectId, die ersten 8 Hex-Zeichen
 *  sind der Erstellzeitpunkt (belegt an einer Foto-Beschriftung „8. Aug. 2025"). */
function datumAusId(id: string | null): string | null {
  if (!id || !/^[0-9a-f]{24}$/i.test(id)) return null
  const ms = parseInt(id.slice(0, 8), 16) * 1000
  if (ms < Date.UTC(2005, 0, 1) || ms > Date.now()) return null
  return new Date(ms).toISOString().split('T')[0]
}

/** Roh-Item des Actors → FewoItem; null ohne lesbare Note. */
export function fewoItemAusRoh(roh: Record<string, unknown>): FewoItem | null {
  const m = String(roh.primary ?? '').match(/^\s*(\d+)\s*\/\s*10/) ?? String(roh.label ?? '').match(/^\s*(\d+) von 10/)
  const n = m ? parseInt(m[1], 10) : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  const id = typeof roh.id === 'string' && roh.id.trim() ? roh.id.trim() : null
  const title = typeof roh.title === 'string' ? roh.title.trim() : ''
  const body = typeof roh.text === 'string' ? roh.text.trim() : ''
  const text = title && body && !body.startsWith(title) ? `${title}\n\n${body}` : body || title
  return {
    id,
    author: typeof roh.author === 'string' && roh.author.trim() ? roh.author.trim() : null,
    rating: Math.min(5, Math.max(1, n / 2)),
    reviewText: text || null,
    reviewDate: datumAusAufenthalt(roh.stay) ?? datumAusId(id),
  }
}

/** Passt zu SyncErrorKind (lib/reviews-sync.ts): 'eingabe' und 'leer' sind harte Fehler (sofort rot). */
export type FewoFehlerArt = 'eingabe' | 'leer' | 'sonst'

export interface FewoAuswertung {
  seite: FewoSeite | null
  items: FewoItem[]
  /** Alle Bewertungen des Portals liegen vor (kein Weiter-Knopf, nichts gekürzt, kein Schritt gescheitert). */
  vollstaendig: boolean
  /** Anzahl laut Portal: Seiten-Angabe, ersatzweise die vollständige Liste. */
  portalCount: number | null
  /** Ein Schritt ist gescheitert — der Lauf darf NICHT als „ok" gelten, auch wenn Note/Anzahl gelesen wurden. */
  fehler: { art: FewoFehlerArt; text: string } | null
}

const kurz = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Item eines endgültig gescheiterten Requests (nur ohne clean=true sichtbar): Methode + letzter Fehlertext. */
function gescheitert(item: Record<string, unknown>): { post: boolean; text: string; status: number | null; versuche: number } | null {
  if (item['#error'] !== true) return null
  const d = (item['#debug'] && typeof item['#debug'] === 'object' ? item['#debug'] : {}) as Record<string, unknown>
  const msgs = Array.isArray(d.errorMessages) ? d.errorMessages.map((m) => String(m).split('\n')[0]) : []
  const text = kurz(msgs[msgs.length - 1] ?? '', 140)
  const st = msgs.join(' ').match(/received (\d{3}) status/i) ?? text.match(/\b([45]\d\d)\b/)
  return {
    post: String(d.method ?? '').toUpperCase() === 'POST' || /graphql/i.test(String(d.url ?? '')),
    text,
    status: st ? Number(st[1]) : typeof d.statusCode === 'number' ? d.statusCode : null,
    versuche: (Number(d.retryCount) || 0) + 1,
  }
}

const BLOCKIERT = [401, 403, 429]

/**
 * Macht aus den Dataset-Items EINES Actor-Laufs das Ergebnis: Seite (Note/Anzahl/ID), Bewertungen und —
 * falls ein Schritt gescheitert ist — einen Fehlertext, dessen Kernaussage in den ersten ~90 Zeichen steht
 * (so viel zeigt die Karte „Bewertungs-Abruf" ohne Aufklappen).
 */
export function auswerteFewoLauf(all: Record<string, unknown>[], maxReviews: number): FewoAuswertung {
  const seiteRoh = [...all].reverse().find((i) => i.__fewo === 'seite')
  const seite = seiteRoh ? deuteSeite(seiteRoh.roh as Record<string, unknown> | undefined) : null
  const gql = all.filter((i) => i.__fewo === 'gql')
  const fehlschlaege = all.map(gescheitert).filter((g): g is NonNullable<ReturnType<typeof gescheitert>> => g !== null)

  // Bewertungen in Portal-Reihenfolge (Seite für Seite), doppelte IDs nur einmal
  const gesehen = new Set<string>()
  const alle: FewoItem[] = []
  let verworfen = 0 // ohne lesbare Note — dürfen nicht still verschwinden
  const rohB = all.filter((i) => i.__fewo === 'bewertung').sort((a, b) => (Number(a.pageIndex) || 0) - (Number(b.pageIndex) || 0))
  for (const r of rohB) {
    const it = fewoItemAusRoh(r)
    if (!it) { verworfen++; continue }
    if (it.id && gesehen.has(it.id)) continue
    if (it.id) gesehen.add(it.id)
    alle.push(it)
  }
  const items = alle.slice(0, Math.max(1, maxReviews))

  const gqlGut = gql.filter((g) => typeof g.anzahl === 'number')
  const geliefert = Math.max(verworfen, gqlGut.reduce((s, g) => s + Number(g.anzahl), 0))
  const letzte = [...gqlGut].sort((a, b) => (Number(a.pageIndex) || 0) - (Number(b.pageIndex) || 0)).pop()
  // Schlechte Antwort = ohne Bewertungsliste und ohne eingereihte Nachfrage (Sortier-Rückfall)
  const gqlSchlecht = gql.find((g) => typeof g.anzahl !== 'number' && !g.ohneSortEnqueued)
  const postGescheitert = fehlschlaege.find((f) => f.post)
  const nennt = seite?.count != null && seite.count > 0 ? `, obwohl die Seite ${seite.count} nennt` : ''
  const rest = gqlGut.length > 0 ? ` — nur ${items.length} Bewertungen geholt` : ' — Texte nicht abrufbar'

  let fehler: FewoAuswertung['fehler'] = null
  if (!seite) {
    const g = fehlschlaege.find((f) => !f.post) ?? fehlschlaege[0]
    fehler = { art: 'sonst', text: g ? `FeWo: Seite nicht geladen (${g.versuche} Versuche) — ${g.text || 'ohne Fehlertext'}` : 'FeWo: Seite wurde nicht geladen (Bot-Schutz/Proxy?)' }
  } else if (!seite.propertyId) {
    const diag = `HTTP ${seiteRoh?.status ?? '?'}, ${seiteRoh?.len ?? '?'} Zeichen, Titel „${kurz(seiteRoh?.title, 60)}“`
    fehler = seite.score == null
      ? { art: 'sonst', text: `FeWo: Seite geladen, aber weder Note noch Property-ID gefunden (Bot-Seite?) — ${diag} ${kurz(seiteRoh?.snippet, 80)}` }
      : { art: 'leer', text: `FeWo: Expedia-Property-ID nicht im Seiten-HTML gefunden — Texte nicht abrufbar (Seitenaufbau geändert?) · ${diag}` }
  } else if (seiteRoh?.enqueueError) {
    fehler = seiteRoh.enqueueError === 'hash fehlt'
      ? { art: 'eingabe', text: 'FeWo: FEWO_REVIEWS_QUERY_HASH ist leer — Texte nicht abrufbar' }
      : { art: 'sonst', text: `FeWo: GraphQL-Abruf konnte nicht eingereiht werden — ${kurz(seiteRoh.enqueueError, 160)}` }
  } else if (gqlSchlecht) {
    const errs = Array.isArray(gqlSchlecht.errors) ? gqlSchlecht.errors.map(String) : []
    const st = Number(gqlSchlecht.status) || null
    if (/persisted.?query/i.test(errs.join(' '))) {
      fehler = { art: 'eingabe', text: `FeWo: Abfrage bei Expedia geändert (PersistedQueryNotFound) — Hash veraltet, neuen Wert als FEWO_REVIEWS_QUERY_HASH hinterlegen${rest}` }
    } else if (st && BLOCKIERT.includes(st)) {
      fehler = { art: 'sonst', text: `FeWo: GraphQL blockiert (HTTP ${st})${rest} · ${kurz(gqlSchlecht.snippet, 120)}` }
    } else if (errs.length) {
      fehler = { art: 'sonst', text: `FeWo: GraphQL-Fehler${rest} · ${kurz(errs.join(' | '), 180)}` }
    } else {
      fehler = { art: 'leer', text: `FeWo: leere GraphQL-Antwort ohne Bewertungsliste (HTTP ${st ?? '?'})${rest} · ${kurz(gqlSchlecht.parseError ?? gqlSchlecht.snippet, 120)}` }
    }
  } else if (postGescheitert) {
    fehler = {
      art: 'sonst',
      text: `FeWo: GraphQL blockiert (${postGescheitert.status ? `HTTP ${postGescheitert.status}` : 'ohne Antwort'}, ${postGescheitert.versuche} Versuche)${rest}${postGescheitert.text ? ` · ${postGescheitert.text}` : ''}`,
    }
  } else if (gqlGut.length === 0 || letzte?.nextEnqueued) {
    // eingereiht, aber weder Antwort noch Fehler-Item: Seitenbudget oder Zeitlimit des Laufs
    // (letzte = höchster Seitenindex mit Antwort; hat sie nachgeladen, fehlt die Folgeseite)
    fehler = { art: 'sonst', text: `FeWo: GraphQL-Schritt ohne Ergebnis (blockiert oder Zeitlimit des Laufs)${rest}` }
  } else if (alle.length === 0 && (nennt || seite.score != null || geliefert > 0)) {
    // Eine Note auf der Seite beweist, dass es Bewertungen gibt — auch wenn die Anzahl nicht lesbar war
    fehler = geliefert > 0
      ? { art: 'leer', text: `FeWo: ${geliefert} Bewertungen geliefert, aber keine mit lesbarer Note — Antwortformat geändert?` }
      : { art: 'leer', text: `FeWo: leere GraphQL-Antwort — 0 Bewertungen geliefert${nennt || ', obwohl die Seite eine Note zeigt'}` }
  } else if (verworfen > 0) {
    fehler = { art: 'sonst', text: `FeWo: ${verworfen} von ${alle.length + verworfen} Bewertungen ohne lesbare Note verworfen — Antwortformat geändert?` }
  } else if (letzte?.hasMore === true && alle.length < Math.min(seite.count ?? Infinity, maxReviews)) {
    // Weiter-Knopf gemeldet, Obergrenze nicht erreicht, aber nichts mehr nachgeladen (Seitenbudget, Einreihen gescheitert)
    fehler = {
      art: 'sonst',
      text: `FeWo: nur ${alle.length} von ${seite.count ?? 'mehr'} Bewertungen geholt — Nachladen endete nach ${gqlGut.length} Abrufen${letzte.enqueueError ? ` · ${kurz(letzte.enqueueError, 120)}` : ''}`,
    }
  }

  // Vollständig heißt auch: nicht weniger, als die Seite nennt — Stufe 3 der Ablösung verlässt sich darauf
  const vollstaendig = !fehler && !!letzte && letzte.hasMore === false && alle.length <= items.length
    && (seite?.count == null || alle.length >= seite.count)
  return { seite, items, vollstaendig, portalCount: seite?.count ?? (vollstaendig ? items.length : null), fehler }
}

/* ── Ablösung der Alt-Zeilen (keine Dubletten) ──────────── */

/**
 * ID-Formel des alten HTML-Parsers (bis 5.10.2026, Items ohne id): 'vrbo_' + sha1(Autor|Datum|Text[0..80]).
 * EINGEFROREN — sie dient nur noch dazu, Alt-Zeilen wiederzuerkennen, und darf sich nie ändern.
 */
export function fewoAltId(author: string | null, date: string | null, text: string | null): string {
  const teile = [author, date, String(text ?? '').slice(0, 80)].filter(Boolean)
  return `vrbo_${createHash('sha1').update(teile.join('|')).digest('hex').slice(0, 24)}`
}

export interface FewoZeile {
  source_review_id: string | null
  author_name: string | null
  rating: number | string | null
  review_date: string | null
  review_text: string | null
}
export interface FewoBestandZeile extends FewoZeile { id: string }

const norm = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
const ANONYM = ['', 'gast', 'verifizierter reisender']

/**
 * Plant, welche gespeicherten Alt-Zeilen auf die stabile Portal-ID ('vrbo_<Bewertungs-ID>') umgehängt
 * werden — VOR countNew und Upsert, damit weder Dubletten entstehen noch created_at verloren geht.
 *
 * Alt-Zeile = ihre source_review_id lässt sich aus den EIGENEN Spalten nachrechnen (fewoAltId; Zeilen
 * werden nie nachträglich geändert) oder sie stammt aus dem Einfüge-Import ('vrbo_paste_…').
 * Partner-Suche unter den abgerufenen Bewertungen, deren ID noch nicht gespeichert ist:
 *   1. gleicher Aufenthaltsmonat + gleiche Note (bei mehreren: gleicher Autor, dann gleicher Textanfang)
 *   2. gleiche Note + gleicher (nicht anonymer) Autor oder gleicher Textanfang — fängt ein geratenes Datum ab
 *   3. nur bei VOLLSTÄNDIGEM Lauf und nur, solange sonst mehr Zeilen entstünden, als das Portal Bewertungen
 *      hat: gleiche Note genügt — aber nur für Alt-Zeilen, die sich gar nicht sicher wiedererkennen LASSEN
 *      (anonymer Autor, kein Text oder geratenes Datum = nicht der 1. eines Monats). Eine Alt-Zeile mit
 *      Namen, Text und Aufenthaltsmonat, die in Stufe 1/2 keinen Partner fand, ist eine vom Portal
 *      entfernte Bewertung und bleibt unverändert stehen (lieber eine Zeile mehr als ein verlorener Text).
 * Eine Verwechslung innerhalb einer Gruppe ist unschädlich: der Upsert überschreibt danach alle
 * Inhaltsspalten der umgehängten Zeile mit den Portal-Daten. Gelöscht wird nie.
 */
export function planFewoAbloesung(
  bestand: FewoBestandZeile[],
  neu: FewoZeile[],
  opts: { vollstaendig: boolean },
): { id: string; von: string; auf: string }[] {
  const vorhanden = new Set(bestand.map((r) => r.source_review_id))
  const frei = neu.filter((n) => n.source_review_id && !vorhanden.has(n.source_review_id))
  const paste = (r: FewoBestandZeile) => /^vrbo_paste_/.test(r.source_review_id ?? '')
  let alt = bestand.filter((r) => paste(r) || r.source_review_id === fewoAltId(r.author_name, r.review_date, r.review_text))
  const plan: { id: string; von: string; auf: string }[] = []

  const note = (a: FewoZeile, b: FewoZeile) => Number(a.rating) === Number(b.rating)
  const autor = (a: FewoZeile, b: FewoZeile) => !ANONYM.includes(norm(a.author_name)) && norm(a.author_name) === norm(b.author_name)
  const text = (a: FewoZeile, b: FewoZeile) => {
    const anfang = norm(a.review_text).slice(0, 40)
    return anfang.length >= 20 && norm(b.review_text).includes(anfang)
  }
  const nimm = (a: FewoBestandZeile, kandidaten: FewoZeile[]): boolean => {
    const n = kandidaten.find((k) => autor(a, k)) ?? kandidaten.find((k) => text(a, k)) ?? kandidaten[0]
    if (!n) return false
    plan.push({ id: a.id, von: a.source_review_id ?? '', auf: n.source_review_id as string })
    frei.splice(frei.indexOf(n), 1)
    return true
  }

  alt = alt.filter((a) => !nimm(a, frei.filter((n) => note(a, n) && !!a.review_date && n.review_date === a.review_date)))
  alt = alt.filter((a) => !nimm(a, frei.filter((n) => note(a, n) && (autor(a, n) || text(a, n)))))
  if (opts.vollstaendig) {
    let zuviel = bestand.length + frei.length - neu.length
    for (const a of alt) {
      if (zuviel <= 0) break
      const unsicher = ANONYM.includes(norm(a.author_name)) || !norm(a.review_text) || !/-01$/.test(a.review_date ?? '')
      if (!paste(a) && unsicher && nimm(a, frei.filter((n) => note(a, n)))) zuviel--
    }
  }
  return plan
}

/* ── Status-Karte ───────────────────────────────────────── */

/**
 * „Portal nennt 26 · gespeichert 0": Ist deutlich weniger gespeichert, als das Portal nennt?
 * Verglichen wird gegen min(Portal, Obergrenze je Lauf) — mehr holt ein Abruf nie. Eine einzelne
 * fehlende Bewertung zählt nicht (z. B. Bewertung kam zwischen Seiten- und Listen-Abruf dazu).
 */
export function fewoLuecke(portalAnzahl: number | null | undefined, gespeichert: number, maxProLauf: number): boolean {
  if (!portalAnzahl || portalAnzahl <= 0) return false
  const soll = Math.min(portalAnzahl, maxProLauf)
  const fehlt = soll - gespeichert
  return gespeichert === 0 || (fehlt >= 2 && fehlt / soll > 0.2)
}

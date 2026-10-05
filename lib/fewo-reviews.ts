/**
 * FeWo-direkt-Bewertungen (5.10.2026) — reine Bausteine OHNE Seiteneffekte (nur 'crypto', kein
 * '@/'-Import), damit sie sich ohne Env und Datenbank testen lassen. Den Lauf selbst (Apify, Supabase)
 * steuert lib/reviews-sync.ts.
 *
 * Hintergrund: Expedia rendert die Bewertungen nicht mehr ins Seiten-HTML. Dort stehen nur noch Note,
 * Anzahl und die Expedia-Property-ID; die Texte kommen per POST /graphql (persistierte Abfrage).
 * Deshalb zwei Schritte in EINEM Lauf von apify~cheerio-scraper (Stufe A, ohne Browser):
 *   1. GET Listing-Seite   → Note, Anzahl, Property-ID
 *   2. POST /graphql       → Bewertungen aus data.productReviewDetails.reviews.details
 * Stufe B (Browser, seit Runde 2 am 5.10.2026): /graphql drosselt den HTTP-Client des cheerio-scrapers nach
 * wenigen Abrufen (HTTP 429 — hängt am TLS-Fingerabdruck, nicht an IP oder Cookies; ein echter Chrome bekam
 * von derselben IP HTTP 200). Scheitert nur Schritt 2 und ist die Property-ID bekannt, startet ein zweiter
 * Lauf mit echtem Chrome (apify~puppeteer-scraper): Navigation zu /robots.txt (Textseite ohne Skripte) und
 * von dort ein in-page fetch POST /graphql. Der Browser dient nur als echter TLS-Client.
 *
 * Env-Übersteuerung (alle optional — ein Wechsel bei Expedia ist ohne Code-Änderung behebbar):
 *   FEWO_REVIEWS_QUERY_HASH   sha256 der persistierten Abfrage (ändert sich, wenn Expedia die Abfrage ändert)
 *   FEWO_REVIEWS_OPERATION    Name der Abfrage
 *   FEWO_REVIEWS_SORT_URN     Sortier-Wert „Neueste"; 'aus' = ohne Sortierung (Portal-Standard „Relevanteste")
 *   FEWO_GRAPHQL_URL · FEWO_CLIENT_INFO · FEWO_SITE_ID · FEWO_EAPID · FEWO_TPID · FEWO_LOCALE · FEWO_CURRENCY
 *   FEWO_BROWSER_STUFE        'aus' schaltet Stufe B ab (dann bleibt es beim Fehler aus Stufe A)
 *   FEWO_BROWSER_ACTOR        Actor der Stufe B (Standard apify~puppeteer-scraper; apify~playwright-scraper geht auch)
 *   FEWO_BROWSER_MEMORY_MB    Speicher des Browser-Laufs (Zweierpotenz 512–8192, Standard 2048)
 *   FEWO_BROWSER_START_URL    Startseite der Stufe B (Standard: /robots.txt auf dem Host von FEWO_GRAPHQL_URL)
 *   FEWO_SEITE_MEMORY_MB      Speicher des cheerio-Laufs (ohne Angabe: Standard des Actors, wie bisher)
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
/** Wiederholungen des GraphQL-POST in Stufe A (= 3 Versuche, rund 8 s). Gemessen am 5.10.: 11 Versuche mit
 *  wechselnder IP brachten nichts und kosteten rund 30 s — die Zeit braucht Stufe B. */
export const FEWO_GQL_WIEDERHOLUNGEN = 2

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
 *    nur ein Item mit '#error' ab (deshalb der Abruf OHNE clean=true). Der POST bekommt dafür nur
 *    cfg.gqlRetries Wiederholungen (Request-Feld maxRetries), die Seite das großzügige maxRequestRetries.
 *  - Unbrauchbare Antworten ohne Fehlertext werden softRetries-mal neu versucht (neue IP), dann gemeldet.
 */
export const FEWO_PAGE_FUNCTION = `async function pageFunction(context) {
  var request = context.request || {};
  var ud = request.userData || {};
  var cfg = context.customData || {};
  var status = context.response ? context.response.status : null;
  var retryCount = request.retryCount || 0;
  var softRetries = typeof cfg.softRetries === 'number' ? cfg.softRetries : 2;
  // weiche Wiederholungen des POST nie oefter als seine harte Grenze - sonst endete eine leere Antwort als '#error'
  var gqlSoft = typeof cfg.gqlRetries === 'number' ? Math.min(softRetries, cfg.gqlRetries) : softRetries;
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
    var bau = function (grenze) {
      var req = {
        url: cfg.gqlUrl,
        method: 'POST',
        payload: JSON.stringify(body),
        // gleiche URL fuer jeden POST: eigener Schluessel, damit die Queue Folgeseiten nie als Dublette verwirft
        uniqueKey: 'gql-' + propertyId + '-' + pageIndex + '-' + size + (ohneSort ? '-ohne' : ''),
        headers: { 'content-type': 'application/json', 'client-info': cfg.clientInfo },
        userData: { label: 'gql', propertyId: String(propertyId), pageIndex: pageIndex, bisher: bisher, ohneSort: !!ohneSort, size: size, nr: nr },
      };
      // Nur WENIGE Wiederholungen fuer den POST (Crawlee: maxRetries je Request): 11 schnelle Versuche mit
      // wechselnder IP halfen am 5.10. nicht und kosteten rund 30 s. Die Seite behaelt maxRequestRetries.
      if (grenze) req.maxRetries = cfg.gqlRetries;
      return req;
    };
    if (typeof cfg.gqlRetries !== 'number') return context.enqueueRequest(bau(false));
    // Lehnt ein aelterer Actor-Build das Feld ab, einmal ohne die Grenze einreihen (dann gilt maxRequestRetries).
    return Promise.resolve().then(function () { return context.enqueueRequest(bau(true)); })
      .catch(function () { return context.enqueueRequest(bau(false)); });
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
      if (!info.errors && retryCount < gqlSoft) throw new Error('gql: unerwartete Antwort, HTTP ' + status);
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
      gqlRetries: FEWO_GQL_WIEDERHOLUNGEN,
    },
    // 1 Seite + GraphQL-Seiten + 1 Nachfrage ohne Sortierung. Mit dem früheren Wert 1 würde der POST
    // eingereiht, aber nie ausgeführt.
    maxPagesPerCrawl: maxGqlPages + 2,
    maxConcurrency: 1,
    // Expedia's bot protection blocks probabilistically — retry generously
    // with rotating German residential IPs (most natural for fewo-direkt.de).
    // Gilt für die SEITE; der GraphQL-POST trägt seine eigene, kleine Grenze (customData.gqlRetries).
    maxRequestRetries: 10,
    // Hängende Proxys früh aufgeben, damit beide Schritte ins Zeitlimit des Laufs passen
    pageLoadTimeoutSecs: 30,
    pageFunctionTimeoutSecs: 30,
    // Content-Type der 200-Antwort von /graphql ist nicht gemessen — unbekannte Typen würden sonst ohne Wiederholung scheitern
    additionalMimeTypes: ['application/graphql-response+json', 'text/plain'],
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: 'DE' },
  }
}

/* ── Stufe B: Browser als echter TLS-Client ─────────────── */

/** 'aus' schaltet die Browser-Stufe ab — dann bleibt es beim Fehler aus Stufe A. */
export const FEWO_BROWSER_AN = !/^(aus|off|0|nein|false)$/i.test(env('FEWO_BROWSER_STUFE', 'an'))
/** Empfohlen: puppeteer-scraper — sein Image startet echtes Google Chrome (neuer Headless-Modus). */
export const FEWO_BROWSER_ACTOR = env('FEWO_BROWSER_ACTOR', 'apify~puppeteer-scraper').replace('/', '~')

/** Speicher eines Actor-Laufs in MB: Apify verlangt eine Zweierpotenz; alles andere → Rückfallwert. */
export function fewoSpeicherMb(roh: string | undefined, fallback: number | null, min = 512): number | null {
  const n = Number(roh)
  return Number.isInteger(n) && n >= min && n <= 8192 && (n & (n - 1)) === 0 ? n : fallback
}
/** 2048 MB = ½ CPU-Kern: genug für einen Chrome, halber Kontospeicher gegenüber dem üblichen Actor-Standard. */
export const FEWO_BROWSER_MEMORY_MB = fewoSpeicherMb(process.env.FEWO_BROWSER_MEMORY_MB, 2048) as number
/** Stufe A: ohne Angabe gilt der Standard des cheerio-scrapers (unverändert seit Runde 1). */
export const FEWO_SEITE_MEMORY_MB = fewoSpeicherMb(process.env.FEWO_SEITE_MEMORY_MB, null, 256)

/** Startseite der Stufe B: muss auf dem Host von /graphql liegen (der fetch ist nur same-origin frei von CORS). */
export function fewoBrowserStartUrl(gqlUrl: string = FEWO_GRAPHQL_URL, uebersteuert: string | undefined = process.env.FEWO_BROWSER_START_URL): string {
  const eigen = uebersteuert?.trim()
  try {
    if (eigen && new URL(eigen).origin === new URL(gqlUrl).origin) return eigen
    return new URL('/robots.txt', gqlUrl).toString()
  } catch {
    return 'https://www.fewo-direkt.de/robots.txt'
  }
}

/**
 * pageFunction der Stufe B (läuft als TEXT in Node.js beim Actor; nur `imBrowser` läuft im Browser — Puppeteer
 * überträgt den Funktionstext, deshalb dort keine Variablen von außen). Wieder OHNE Backslashes, Backticks und
 * Dollar-Klammern. Liefert dieselben Roh-Items wie Stufe A (__fewo 'gql' | 'bewertung', zusätzlich
 * stufe: 'browser') und je Versuch ein Diagnose-Item (__fewo: 'browser': Status, Dauer, User-Agent, echte
 * Browser-Version, navigator.webdriver).
 *  - Antwort ohne Liste und ohne GraphQL-Fehlertext (429, 403, HTML, Netzfehler): Session stilllegen
 *    (→ neuer Browser, neue Proxy-IP) und werfen. Ein bloßes throw ließe Browser und IP unverändert.
 *  - Im letzten Versuch (retryCount = wiederholungen) oder nach budgetMs wird NICHT geworfen, sondern die
 *    gql-Info mit Status zurückgegeben — so steht der Statuscode im Ergebnis statt in einem '#error'-Item.
 *  - context.response ist beim Actor nur { status, headers } (status ist eine Zahl).
 */
export const FEWO_BROWSER_PAGE_FUNCTION = `async function pageFunction(context) {
  // Stufe B (Browser): der Browser dient nur als echter TLS-Client. Die Seite ist robots.txt (keine Skripte),
  // von dort geht per fetch der POST an /graphql. Bewusst OHNE Backslashes, Backticks und Dollar-Klammern.
  var request = context.request || {};
  var cfg = context.customData || {};
  var page = context.page;
  var t0 = Date.now();
  var retryCount = request.retryCount || 0;
  var wiederholungen = typeof cfg.wiederholungen === 'number' ? cfg.wiederholungen : 2;
  var fetchTimeoutMs = cfg.fetchTimeoutMs || 15000;
  var budgetMs = typeof cfg.budgetMs === 'number' ? cfg.budgetMs : 0;
  // Nach so vielen ms in DIESEM Versuch wird nicht mehr nachgeladen (sonst risse die Funktion ihr eigenes Zeitlimit)
  var pfBudgetMs = typeof cfg.pfBudgetMs === 'number' ? cfg.pfBudgetMs : 25000;
  var maxSeiten = cfg.maxGqlPages || 4;
  var maxReviews = cfg.maxReviews || 40;
  var propertyId = cfg.propertyId ? String(cfg.propertyId) : '';
  // Der Actor reicht von der Navigations-Antwort nur { status, headers } durch: status ist eine ZAHL, kein Aufruf.
  var nav = context.response || {};
  var navStatus = typeof nav.status === 'number' ? nav.status : null;
  if (typeof context.skipLinks === 'function') context.skipLinks();

  function short(e, n) { return String(e && e.message ? e.message : e).slice(0, n || 200); }
  // Millisekunden seit Start des Actor-Laufs (env.startedAt), null wenn unbekannt
  function laufMs() {
    try {
      var s = context.env && context.env.startedAt ? new Date(context.env.startedAt).getTime() : NaN;
      return isNaN(s) ? null : Date.now() - s;
    } catch (e) { return null; }
  }
  function gqlBody(pageIndex, size, ohneSort) {
    var body = JSON.parse(JSON.stringify(cfg.gqlVorlage));
    var pi = body[0].variables.productIdentifier;
    var sec = pi.travelSearchCriteria.property.secondary;
    pi.id = propertyId;
    sec.counts.forEach(function (c) { if (c.id === 'pageIndex') c.value = pageIndex; if (c.id === 'size') c.value = size; });
    if (ohneSort) sec.selections = [];
    return JSON.stringify(body);
  }

  // Laeuft IM BROWSER (Puppeteer uebertraegt den Funktionstext): keine Variablen von aussen, nur das Argument a.
  // Genau der am 5.10. im echten Chrome gemessene Abruf: ohne Cookies, nur content-type + client-info.
  function imBrowser(a) {
    var start = Date.now();
    var out = { status: 0, contentType: null, text: '', ms: 0, fehler: null, diag: null };
    try {
      var n = navigator;
      var d = {
        userAgent: String(n.userAgent || ''), webdriver: typeof n.webdriver === 'boolean' ? n.webdriver : null,
        sprache: n.language || null, plattform: n.platform || null, marken: null,
        ort: String(location.href), typ: document.contentType || null,
      };
      if (n.userAgentData && n.userAgentData.brands) {
        d.marken = n.userAgentData.brands.map(function (b) { return b.brand + ' ' + b.version; }).join(', ');
      }
      out.diag = d;
    } catch (e0) { out.diag = { fehler: String(e0) }; }
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, a.timeoutMs) : null;
    var opt = {
      method: 'POST', credentials: 'omit',
      headers: { 'content-type': 'application/json', 'client-info': a.clientInfo },
      body: a.body,
    };
    if (ctrl) opt.signal = ctrl.signal;
    return fetch(a.url, opt).then(function (res) {
      out.status = res.status;
      out.contentType = res.headers.get('content-type');
      return res.text();
    }).then(function (text) {
      out.text = text;
    }).catch(function (e1) {
      out.fehler = String(e1 && e1.message ? e1.message : e1).slice(0, 200);
    }).then(function () {
      if (timer) clearTimeout(timer);
      out.ms = Date.now() - start;
      return out;
    });
  }

  // Diagnose-Item: EINES je Versuch (auch bei gescheiterten Versuchen, siehe neuVersuchen)
  var diag = {
    __fewo: 'browser', versuch: retryCount + 1, status: null, navStatus: navStatus,
    navTyp: nav.headers ? (nav.headers['content-type'] || null) : null,
    propertyId: propertyId || null, abrufe: 0, dauerMs: 0, laufMs: null, wiederholt: false,
    userAgent: null, webdriver: null, marken: null, sprache: null, plattform: null, ort: null, typ: null,
    browser: null, session: null,
  };
  try { if (page && typeof page.browser === 'function') diag.browser = String(await page.browser().version()); } catch (e) { diag.browser = null; }
  try { diag.session = context.session && context.session.id ? String(context.session.id) : null; } catch (e) { diag.session = null; }
  function fertig(status) { diag.status = status; diag.dauerMs = Date.now() - t0; diag.laufMs = laufMs(); return diag; }

  // Wiederholung mit NEUER Proxy-IP: Session stilllegen (der Browser haengt an der Session und wird ersetzt), dann werfen.
  async function neuVersuchen(grund, status) {
    diag.wiederholt = true;
    fertig(status);
    try { if (typeof context.pushData === 'function') await context.pushData(diag); } catch (e) { diag.pushError = short(e, 80); }
    try { if (context.session && typeof context.session.retire === 'function') context.session.retire(); } catch (e) { diag.retireError = short(e, 80); }
    throw new Error('fewo-browser: ' + grund + ' (Versuch ' + (retryCount + 1) + ')');
  }
  function schluss(info) { return [fertig(info.status), info]; }

  var basis = { __fewo: 'gql', stufe: 'browser', status: null, contentType: null, propertyId: propertyId || null, pageIndex: 0, retryCount: retryCount, sortiert: !!cfg.sortiert, size: cfg.size || 50, nr: 1, anzahl: null, hasMore: false };
  if (!page || typeof page.evaluate !== 'function') { basis.errors = ['Eingabe: context.page fehlt (kein Browser-Actor?)']; return schluss(basis); }
  if (!propertyId || !cfg.gqlUrl || !cfg.clientInfo || !Array.isArray(cfg.gqlVorlage)) { basis.errors = ['Eingabe: propertyId, gqlUrl, clientInfo oder gqlVorlage fehlt']; return schluss(basis); }

  var infos = [];
  var items = [];
  var pageIndex = 0, size = cfg.size || 50, bisher = 0, nr = 1, ohneSort = !cfg.sortiert, letzterStatus = null;
  for (var abruf = 0; abruf < maxSeiten + 1; abruf++) {
    var r = null;
    try {
      r = await page.evaluate(imBrowser, { url: cfg.gqlUrl, clientInfo: cfg.clientInfo, body: gqlBody(pageIndex, size, ohneSort), timeoutMs: fetchTimeoutMs });
    } catch (e1) {
      r = { status: 0, contentType: null, text: '', ms: 0, fehler: 'evaluate: ' + short(e1, 160), diag: null };
    }
    if (!r || typeof r !== 'object') r = { status: 0, contentType: null, text: '', ms: 0, fehler: 'evaluate: keine Antwort', diag: null };
    diag.abrufe++;
    letzterStatus = r.status || null;
    if (r.diag && diag.userAgent === null) {
      diag.userAgent = r.diag.userAgent || null; diag.webdriver = typeof r.diag.webdriver === 'boolean' ? r.diag.webdriver : null;
      diag.marken = r.diag.marken || null; diag.sprache = r.diag.sprache || null; diag.plattform = r.diag.plattform || null;
      diag.ort = r.diag.ort || null; diag.typ = r.diag.typ || null;
      if (r.diag.fehler) diag.diagFehler = short(r.diag.fehler, 120);
    }
    var text = typeof r.text === 'string' ? r.text : '';
    var info = {
      __fewo: 'gql', stufe: 'browser', status: r.status || null, contentType: r.contentType || null,
      propertyId: propertyId, pageIndex: pageIndex, retryCount: retryCount,
      sortiert: !ohneSort, size: size, nr: nr, anzahl: null, hasMore: false, ms: r.ms || 0, len: text.length,
    };
    if (r.fehler) info.fetchError = short(r.fehler, 160);
    var data = null;
    if (text) { try { data = JSON.parse(text); } catch (e2) { info.parseError = short(e2, 120); info.snippet = text.slice(0, 200); } }
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
      // Sortier-Wert abgelehnt? Einmal ohne Sortierung nachfragen (gleiche Seite, gleicher Browser).
      if (info.errors && !hashWeg && !ohneSort) { info.ohneSortEnqueued = true; infos.push(info); ohneSort = true; continue; }
      // 403 wegen fehlendem client-info ist ein Eingabefehler, keine Sperre - nicht wiederholen
      var konfig = text.indexOf('CLIENT_INFO') >= 0;
      var seit = laufMs();
      var zeitUm = budgetMs > 0 && seit !== null && seit > budgetMs;
      if (!info.errors && !konfig && !zeitUm && retryCount < wiederholungen) {
        await neuVersuchen('GraphQL HTTP ' + (r.status || 0) + (r.fehler ? ' ' + short(r.fehler, 80) : ''), letzterStatus);
      }
      if (zeitUm) info.zeitUm = true;
      if (!info.snippet) {
        if (r.fehler) info.snippet = short(r.fehler, 200);
        else { try { info.snippet = String(JSON.stringify(first)).slice(0, 200); } catch (e3) { info.snippet = ''; } }
      }
      infos.push(info);
      break;
    }
    info.anzahl = details.length;
    info.hasMore = reviews.pagination !== null && reviews.pagination !== undefined;
    var texts = function (arr) {
      if (!Array.isArray(arr)) return [];
      return arr.map(function (m) { return m && m.text ? String(m.text) : ''; }).filter(Boolean);
    };
    for (var i = 0; i < details.length; i++) {
      var d = details[i];
      var s = d && d.summary ? d.summary : {};
      var rv = d && d.review ? d.review : {};
      items.push({
        __fewo: 'bewertung', pageIndex: pageIndex,
        id: d && d.id ? String(d.id) : null,
        primary: s.primary || null, label: s.accessibilityLabel || null, author: s.secondary || null,
        stay: texts(s.supportingMessages), title: rv.title || null, text: rv.text || null,
      });
    }
    bisher += details.length;
    infos.push(info);
    // Nachladen wie im cheerio-Weg: nur mit Weiter-Knopf, unter der Obergrenze; bei Deckelung mit der gelieferten Groesse.
    if (info.hasMore && details.length > 0 && bisher < maxReviews && nr < maxSeiten) {
      // Zeit dieses Versuchs verbraucht: mit dem Geholten enden (die Auswertung meldet den Rest als nicht nachgeladen)
      if (Date.now() - t0 > pfBudgetMs) { info.zeitUm = true; break; }
      var gedeckelt = details.length < size;
      var nSize = gedeckelt ? details.length : size;
      pageIndex = gedeckelt ? Math.floor(bisher / nSize) : pageIndex + 1;
      size = nSize;
      nr = nr + 1;
      info.nextEnqueued = true;
      continue;
    }
    break;
  }
  return [fertig(letzterStatus)].concat(infos, items);
}`

/** preNavigationHooks der Stufe B (Text, der zu einem Array von Funktionen auswertet). */
export const FEWO_BROWSER_HOOKS = `[
  async (crawlingContext, gotoOptions) => {
    // Zeitbudget: Ist es verbraucht, wird KEIN weiterer Versuch mehr begonnen (neuer Browser + Navigation + fetch
    // dauern laenger als der Puffer). Ein Lauf, der sein Zeitlimit reisst, liefert gar keine Items - so endet er
    // von selbst und die Diagnose der frueheren Versuche bleibt erhalten. Gilt auch fuer Wiederholungen, die
    // Crawlee selbst ausloest (Startseite 429/403, Proxy-Fehler). Der ERSTE Versuch laeuft immer.
    var request = crawlingContext.request || {};
    var cfg = crawlingContext.customData || {};
    var wiederholt = (request.retryCount || 0) > 0 || (request.sessionRotationCount || 0) > 0;
    var seit = null;
    try {
      var actor = crawlingContext.Actor;
      var env = actor && typeof actor.getEnv === 'function' ? actor.getEnv() : null;
      var s = env && env.startedAt ? new Date(env.startedAt).getTime() : NaN;
      if (!isNaN(s)) seit = Date.now() - s;
    } catch (e) { seit = null; }
    if (wiederholt && typeof cfg.budgetMs === 'number' && cfg.budgetMs > 0 && seit !== null && seit > cfg.budgetMs) {
      request.noRetry = true;
      throw new Error('fewo-browser: Zeitbudget verbraucht (' + Math.round(seit / 1000) + ' s) - kein weiterer Versuch');
    }
    // Nur das Dokument (robots.txt) und der spaetere fetch duerfen ins Netz: Bilder, Schriften, CSS und Skripte
    // im Browser sperren (CDP Network.setBlockedURLs, keine Request-Interception). Das Hauptdokument bleibt erlaubt.
    try {
      if (typeof crawlingContext.blockRequests === 'function') {
        await crawlingContext.blockRequests({
          urlPatterns: ['.css', '.jpg', '.jpeg', '.png', '.svg', '.gif', '.webp', '.webm', '.mp4', '.ico', '.woff', '.ttf', '.eot', '.js'],
        });
      }
    } catch (e) {
      crawlingContext.log.warning('fewo-browser: blockRequests fehlgeschlagen: ' + (e && e.message ? e.message : e));
    }
  },
]`

/**
 * Eingabe für den Browser-Actor. `laufSek` = Zeitlimit des Laufs (API-Parameter timeout): daraus entsteht
 * budgetMs — danach wird nicht mehr wiederholt, damit der Lauf von selbst endet und seine Items abliefert
 * (ein Lauf, der sein Zeitlimit reißt, liefert gar nichts). Geprüft wird an zwei Stellen: in der pageFunction
 * nach einem gescheiterten fetch und im preNavigationHook vor JEDEM weiteren Versuch.
 */
export function buildFewoBrowserInput(
  propertyId: string,
  maxReviews: number,
  opts: { laufSek: number; duaid?: string; actor?: string; startUrl?: string },
): Record<string, unknown> {
  const max = Math.max(1, Math.floor(maxReviews))
  const size = Math.min(FEWO_SEITE_MAX, max)
  const wiederholungen = 2
  const playwright = /playwright/i.test(opts.actor ?? FEWO_BROWSER_ACTOR)
  return {
    startUrls: [{ url: opts.startUrl ?? fewoBrowserStartUrl() }],
    pageFunction: FEWO_BROWSER_PAGE_FUNCTION,
    preNavigationHooks: FEWO_BROWSER_HOOKS,
    customData: {
      propertyId: String(propertyId),
      gqlUrl: FEWO_GRAPHQL_URL,
      clientInfo: FEWO_CLIENT_INFO,
      gqlVorlage: buildFewoGqlBody('0', 0, { size, sortUrn: FEWO_REVIEWS_SORT_URN, duaid: opts.duaid ?? randomUUID() }),
      sortiert: !!FEWO_REVIEWS_SORT_URN,
      maxReviews: max,
      size,
      maxGqlPages: FEWO_GQL_SEITEN_MAX,
      // MUSS gleich maxRequestRetries sein: im letzten Versuch liefert die Funktion den Status, statt zu werfen
      wiederholungen,
      // Ein neuer Versuch dauert im schlimmsten Fall Browser-Start (bis 15 s) + Navigation (12 s) + fetch (10 s)
      // = 37 s und bleibt damit unter bPufferMs (40 s)
      fetchTimeoutMs: 10_000,
      pfBudgetMs: 25_000, // danach kein Nachladen mehr: 25 s + ein fetch (10 s) < pageFunctionTimeoutSecs
      budgetMs: Math.max(5_000, Math.floor(opts.laufSek) * 1000 - FEWO_ZEIT.bPufferMs),
    },
    proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'], apifyProxyCountry: 'DE' },
    // jede Session nur einmal: ein neuer Versuch bekommt sicher einen neuen Browser und eine neue IP
    proxyRotation: 'PER_REQUEST',
    // nichts verfolgen, nichts von Plattform-Standardwerten abhängig machen
    linkSelector: '',
    globs: [],
    pseudoUrls: [],
    excludes: [],
    respectRobotsTxtFile: false,
    useChrome: false,
    headless: true,
    ignoreSslErrors: false,
    ignoreCorsAndCsp: false, // der fetch ist same-origin; --disable-web-security wäre nur eine Auffälligkeit
    // Actor-Standard (true) lassen: mit false sperrt der EINGEBAUTE Hook des Actors selbst — ungeschützt (ohne
    // try/catch) und vor unserem Hook; ein Fehler dort ließe jede Navigation scheitern. robots.txt lädt ohnehin
    // nichts nach; gesperrt wird nur im eigenen, abgesicherten Hook (FEWO_BROWSER_HOOKS).
    downloadMedia: true,
    downloadCss: true,
    maxRequestRetries: wiederholungen,
    maxPagesPerCrawl: 1,
    maxConcurrency: 1,
    pageLoadTimeoutSecs: 12,
    pageFunctionTimeoutSecs: 40,
    // puppeteer-scraper erwartet ein Array, playwright-scraper einen String
    waitUntil: playwright ? 'domcontentloaded' : ['domcontentloaded'],
    closeCookieModals: false,
    maxScrollHeightPixels: 0, // Standard 5000 würde vor der pageFunction scrollen und mindestens 4 s warten
    debugLog: false,
    browserLog: false,
  }
}

/* ── Zeitbudget ─────────────────────────────────────────── */

/**
 * Stufe A und B teilen sich EIN Fenster (timeoutMs je Wohnung: Handabruf 150 s, Cron 75–110 s) — der Zweig
 * dauert damit im schlimmsten Fall weiter timeoutMs + 15 s, die Rechnung des Crons bleibt gültig.
 *  - Stufe A darf das GANZE Fenster nutzen (wie vor Runde 2). Ein eigenes, kürzeres Limit brächte Stufe B
 *    nichts (sie bekommt ohnehin den Rest nach dem tatsächlichen Ende von A), ließe aber einen A-Lauf, der
 *    wegen Seiten-Wiederholungen länger braucht, als Zeitüberschreitung ganz ohne Ergebnis enden. Üblich
 *    braucht A 15–25 s (gemessen: 44 s mit 11 POST-Versuchen, davon rund 30 s Versuche).
 *  - Stufe B bekommt, was nach dem TATSÄCHLICHEN Ende von A übrig ist, höchstens bMaxMs. Unter bMinMs wird sie
 *    ausgelassen (Container- und Chrome-Start, Navigation über Residential-Proxy und fetch: geschätzt
 *    15–30 s, NICHT gemessen). Beispiele bei A = 22 s: Hand 128 → 90 s · Cron 110 → 88 s · Cron 75 → 53 s.
 *  - bPufferMs: so lange vor dem Zeitlimit des Browser-Laufs wird kein neuer Versuch mehr begonnen — mehr als
 *    ein Versuch im schlimmsten Fall dauert (37 s, siehe buildFewoBrowserInput). Bei einem knappen Fenster
 *    (unter rund 60 s) bleibt es deshalb praktisch bei EINEM Browser-Versuch.
 */
export const FEWO_ZEIT = { bMinMs: 45_000, bMaxMs: 90_000, bPufferMs: 40_000 }

/** Zeitlimit des cheerio-Laufs in Sekunden: das ganze Fenster. */
export function fewoZeitStufeA(timeoutMs: number): number {
  return Math.max(1, Math.floor(timeoutMs / 1000))
}

/** Zeitlimit des Browser-Laufs in Sekunden — null, wenn der Rest des Fensters nicht mehr reicht. */
export function fewoZeitStufeB(restMs: number): number | null {
  if (!Number.isFinite(restMs) || restMs < FEWO_ZEIT.bMinMs) return null
  return Math.floor(Math.min(restMs, FEWO_ZEIT.bMaxMs) / 1000)
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

/** Deckungsgleich mit SyncErrorKind (lib/reviews-sync.ts, hier nicht importierbar). Die Auswertung selbst
 *  vergibt nur 'eingabe', 'leer' (harte Fehler, sofort rot) und 'sonst'; die übrigen Arten entstehen, wenn
 *  der Apify-Lauf der Stufe B scheitert (Zeitlimit, Guthaben, Actor nicht gefunden). */
export type FewoFehlerArt = 'kontingent' | 'eingabe' | 'token' | 'actor' | 'timeout' | 'leer' | 'sonst'

/** Maschinenlesbarer Grund eines Fehlers — entscheidet, ob die Browser-Stufe helfen kann (fewoBrowserSinnvoll). */
export type FewoFehlerGrund =
  | 'seite' | 'keineId' | 'hashFehlt' | 'einreihen' | 'hashAlt' | 'blockiert' | 'gqlFehler'
  | 'leerAntwort' | 'ohneErgebnis' | 'leereListe' | 'verworfen' | 'nachladen' | 'stufeB'

export interface FewoFehler { art: FewoFehlerArt; text: string; grund?: FewoFehlerGrund }

export interface FewoAuswertung {
  seite: FewoSeite | null
  items: FewoItem[]
  /** Alle Bewertungen des Portals liegen vor (kein Weiter-Knopf, nichts gekürzt, kein Schritt gescheitert). */
  vollstaendig: boolean
  /** Anzahl laut Portal: Seiten-Angabe, ersatzweise die vollständige Liste. */
  portalCount: number | null
  /** Ein Schritt ist gescheitert — der Lauf darf NICHT als „ok" gelten, auch wenn Note/Anzahl gelesen wurden. */
  fehler: FewoFehler | null
  /** Über welche Stufe die Texte kamen ('B' = Browser) — nur gesetzt, wenn Stufe B gelaufen ist. */
  weg?: 'A' | 'B'
}

const STUFE_NAME = { A: 'Stufe A (ohne Browser)', B: 'Stufe B (Browser)' } as const

const kurz = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Item eines endgültig gescheiterten Requests (nur ohne clean=true sichtbar): Methode + letzter Fehlertext. */
function gescheitert(item: Record<string, unknown>): { post: boolean; text: string; alle: string; status: number | null; versuche: number } | null {
  if (item['#error'] !== true) return null
  const d = (item['#debug'] && typeof item['#debug'] === 'object' ? item['#debug'] : {}) as Record<string, unknown>
  const msgs = Array.isArray(d.errorMessages) ? d.errorMessages.map((m) => String(m).split('\n')[0]) : []
  const text = kurz(msgs[msgs.length - 1] ?? '', 140)
  const st = msgs.join(' ').match(/received (\d{3}) status/i) ?? text.match(/\b([45]\d\d)\b/)
  return {
    post: String(d.method ?? '').toUpperCase() === 'POST' || /graphql/i.test(String(d.url ?? '')),
    text,
    alle: msgs.join(' | '),
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
export function auswerteFewoLauf(all: Record<string, unknown>[], maxReviews: number, opts: { stufe?: 'A' | 'B' } = {}): FewoAuswertung {
  // Stufe B: `all` = Seiten-Item aus Stufe A + Items des Browser-Laufs (mischeFewoStufen). Dort gibt es nur
  // EINEN Request (GET Startseite) — scheitert er endgültig, ist das der Fehlschlag des GraphQL-Schritts.
  const istB = opts.stufe === 'B'
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
  const postGescheitert = istB ? fehlschlaege[0] : fehlschlaege.find((f) => f.post)
  const nennt = seite?.count != null && seite.count > 0 ? `, obwohl die Seite ${seite.count} nennt` : ''
  const rest = gqlGut.length > 0 ? ` — nur ${items.length} Bewertungen geholt` : ' — Texte nicht abrufbar'

  let fehler: FewoAuswertung['fehler'] = null
  if (!seite) {
    const g = fehlschlaege.find((f) => !f.post) ?? fehlschlaege[0]
    fehler = { art: 'sonst', grund: 'seite', text: g ? `FeWo: Seite nicht geladen (${g.versuche} Versuche) — ${g.text || 'ohne Fehlertext'}` : 'FeWo: Seite wurde nicht geladen (Bot-Schutz/Proxy?)' }
  } else if (!seite.propertyId) {
    const diag = `HTTP ${seiteRoh?.status ?? '?'}, ${seiteRoh?.len ?? '?'} Zeichen, Titel „${kurz(seiteRoh?.title, 60)}“`
    fehler = seite.score == null
      ? { art: 'sonst', grund: 'keineId', text: `FeWo: Seite geladen, aber weder Note noch Property-ID gefunden (Bot-Seite?) — ${diag} ${kurz(seiteRoh?.snippet, 80)}` }
      : { art: 'leer', grund: 'keineId', text: `FeWo: Expedia-Property-ID nicht im Seiten-HTML gefunden — Texte nicht abrufbar (Seitenaufbau geändert?) · ${diag}` }
  } else if (seiteRoh?.enqueueError) {
    fehler = seiteRoh.enqueueError === 'hash fehlt'
      ? { art: 'eingabe', grund: 'hashFehlt', text: 'FeWo: FEWO_REVIEWS_QUERY_HASH ist leer — Texte nicht abrufbar' }
      : { art: 'sonst', grund: 'einreihen', text: `FeWo: GraphQL-Abruf konnte nicht eingereiht werden — ${kurz(seiteRoh.enqueueError, 160)}` }
  } else if (gqlSchlecht) {
    const errs = Array.isArray(gqlSchlecht.errors) ? gqlSchlecht.errors.map(String) : []
    const st = Number(gqlSchlecht.status) || null
    // Stufe B meldet den letzten Versuch selbst (retryCount) — die Zahl der Versuche gehört in den Text
    const vers = istB ? `, ${(Number(gqlSchlecht.retryCount) || 0) + 1} Versuche` : ''
    if (/persisted.?query/i.test(errs.join(' '))) {
      fehler = { art: 'eingabe', grund: 'hashAlt', text: `FeWo: Abfrage bei Expedia geändert (PersistedQueryNotFound) — Hash veraltet, neuen Wert als FEWO_REVIEWS_QUERY_HASH hinterlegen${rest}` }
    } else if (st && BLOCKIERT.includes(st)) {
      fehler = { art: 'sonst', grund: 'blockiert', text: `FeWo: GraphQL blockiert (HTTP ${st}${vers})${rest} · ${kurz(gqlSchlecht.snippet, 120)}` }
    } else if (errs.length) {
      fehler = { art: 'sonst', grund: 'gqlFehler', text: `FeWo: GraphQL-Fehler${rest} · ${kurz(errs.join(' | '), 180)}` }
    } else if (istB && gqlSchlecht.parseError) {
      // nur Stufe B: Antwort ist kein JSON (Bot-Seite mit HTTP 200?) — eine Sperre, kein geändertes Format
      fehler = { art: 'sonst', grund: 'blockiert', text: `FeWo: GraphQL lieferte kein JSON (HTTP ${st ?? '?'}${vers})${rest} · ${kurz(gqlSchlecht.snippet, 120)}` }
    } else if (gqlSchlecht.fetchError) {
      // nur Stufe B: der fetch im Browser kam nicht durch (Proxy weg, Zeitüberschreitung, gesperrt)
      fehler = { art: 'sonst', grund: 'blockiert', text: `FeWo: GraphQL nicht erreichbar (ohne Antwort${vers})${rest} · ${kurz(gqlSchlecht.fetchError, 120)}` }
    } else {
      fehler = { art: 'leer', grund: 'leerAntwort', text: `FeWo: leere GraphQL-Antwort ohne Bewertungsliste (HTTP ${st ?? '?'})${rest} · ${kurz(gqlSchlecht.parseError ?? gqlSchlecht.snippet, 120)}` }
    }
  } else if (postGescheitert) {
    const p = postGescheitert
    const wie = (st: number | null) => `${st ? `HTTP ${st}` : 'ohne Antwort'}, ${p.versuche} Versuche`
    const ende = `${rest}${p.text ? ` · ${p.text}` : ''}`
    let text = `FeWo: GraphQL blockiert (${wie(p.status)})${ende}`
    if (istB) {
      // Woran die Versuche scheiterten, steht in den Meldungen: 'fewo-browser: GraphQL HTTP …' wirft die
      // pageFunction nach einem gescheiterten fetch (die Startseite WAR dann geladen); nur sonst war es die Navigation.
      const gqlSt = [...p.alle.matchAll(/fewo-browser: GraphQL HTTP (\d+)/g)].pop()
      const st = gqlSt ? Number(gqlSt[1]) || null : null
      const navBlock = /received \d{3} status/i.test(p.alle)
      text = gqlSt
        ? st && BLOCKIERT.includes(st) ? `FeWo: GraphQL blockiert (${wie(st)})${ende}` : `FeWo: GraphQL-Abruf im Browser gescheitert (${wie(st)})${ende}`
        : !navBlock && /requestHandler timed out|page ?function/i.test(p.alle) ? `FeWo: Browser-Abruf gescheitert (${p.versuche} Versuche)${ende}`
        : `FeWo: Startseite im Browser nicht geladen (${wie(p.status)})${ende}`
    }
    fehler = { art: 'sonst', grund: 'blockiert', text }
  } else if (gqlGut.length === 0 || letzte?.nextEnqueued) {
    // eingereiht, aber weder Antwort noch Fehler-Item: Seitenbudget oder Zeitlimit des Laufs
    // (letzte = höchster Seitenindex mit Antwort; hat sie nachgeladen, fehlt die Folgeseite)
    fehler = { art: 'sonst', grund: 'ohneErgebnis', text: `FeWo: GraphQL-Schritt ohne Ergebnis (blockiert oder Zeitlimit des Laufs)${rest}` }
  } else if (alle.length === 0 && (nennt || seite.score != null || geliefert > 0)) {
    // Eine Note auf der Seite beweist, dass es Bewertungen gibt — auch wenn die Anzahl nicht lesbar war
    fehler = geliefert > 0
      ? { art: 'leer', grund: 'verworfen', text: `FeWo: ${geliefert} Bewertungen geliefert, aber keine mit lesbarer Note — Antwortformat geändert?` }
      : { art: 'leer', grund: 'leereListe', text: `FeWo: leere GraphQL-Antwort — 0 Bewertungen geliefert${nennt || ', obwohl die Seite eine Note zeigt'}` }
  } else if (verworfen > 0) {
    fehler = { art: 'sonst', grund: 'verworfen', text: `FeWo: ${verworfen} von ${alle.length + verworfen} Bewertungen ohne lesbare Note verworfen — Antwortformat geändert?` }
  } else if (letzte?.hasMore === true && alle.length < Math.min(seite.count ?? Infinity, maxReviews)) {
    // Weiter-Knopf gemeldet, Obergrenze nicht erreicht, aber nichts mehr nachgeladen (Seitenbudget, Einreihen gescheitert)
    fehler = {
      art: 'sonst',
      grund: 'nachladen',
      text: `FeWo: nur ${alle.length} von ${seite.count ?? 'mehr'} Bewertungen geholt — Nachladen endete nach ${gqlGut.length} Abrufen${letzte.enqueueError ? ` · ${kurz(letzte.enqueueError, 120)}` : ''}`,
    }
  }

  // Vollständig heißt auch: nicht weniger, als die Seite nennt — Stufe 3 der Ablösung verlässt sich darauf
  const vollstaendig = !fehler && !!letzte && letzte.hasMore === false && alle.length <= items.length
    && (seite?.count == null || alle.length >= seite.count)
  // Mit Stufen-Angabe steht vorn, WELCHE Stufe gescheitert ist (Karte „Bewertungs-Abruf" zeigt ~90 Zeichen)
  if (fehler && opts.stufe) fehler.text = fehler.text.replace(/^FeWo: /, `FeWo ${STUFE_NAME[opts.stufe]}: `)
  return { seite, items, vollstaendig, portalCount: seite?.count ?? (vollstaendig ? items.length : null), fehler, ...(istB ? { weg: 'B' as const } : {}) }
}

/* ── Stufe A + B zusammenführen ─────────────────────────── */

/** Gründe, bei denen ein echter Browser helfen kann: der GraphQL-Schritt kam nicht durch. NICHT bei
 *  veraltetem Hash, echtem GraphQL-Fehler oder geändertem Antwortformat — das träfe den Browser genauso. */
const BROWSER_GRUENDE: FewoFehlerGrund[] = ['einreihen', 'blockiert', 'leerAntwort', 'ohneErgebnis']

/** Soll nach Stufe A die Browser-Stufe laufen? Nur mit bekannter Property-ID und gescheitertem GraphQL-Teil. */
export function fewoBrowserSinnvoll(a: FewoAuswertung): boolean {
  return !!a.seite?.propertyId && !!a.fehler?.grund && BROWSER_GRUENDE.includes(a.fehler.grund)
}

/**
 * Roh-Items für die Auswertung der Stufe B: das Seiten-Item aus Stufe A (Note, Anzahl, Property-ID) plus
 * ALLE Items des Browser-Laufs. Die gql-/bewertung-/'#error'-Items aus A und ein enqueueError am Seiten-Item
 * fallen weg — sonst meldete die Auswertung den Fehlschlag von A, obwohl B geliefert hat.
 */
export function mischeFewoStufen(rohA: Record<string, unknown>[], rohB: Record<string, unknown>[]): Record<string, unknown>[] {
  const seiteRoh = [...rohA].reverse().find((i) => i.__fewo === 'seite')
  const seite = seiteRoh ? [Object.fromEntries(Object.entries(seiteRoh).filter(([k]) => k !== 'enqueueError'))] : []
  return [...seite, ...rohB.filter((i) => i.__fewo !== 'seite')]
}

/** Kern eines Stufe-A-Fehlertexts für den Anhang: ohne Vorspann, ohne Antwort-Ausschnitt. */
function kernA(text: string): string {
  return kurz(text.replace(/^FeWo[^:]*: /, '').split(' · ')[0].replace(' — Texte nicht abrufbar', ''), 110)
}

/**
 * Ergebnis beider Stufen. `b` = Auswertung der Stufe B (null, wenn sie nicht lief); `ohneB` sagt dann, warum
 * (ausgelassen, abgeschaltet, Apify-Fehler). Regeln:
 *  - B ohne Fehler → B gilt.
 *  - B mit Fehler → es zählt, wer mehr Bewertungen hat (A kann eine Teilmenge geholt haben); der Text nennt
 *    zuerst Stufe B, dann den Kern von Stufe A. Die Fehlerart kommt von B (jüngster, echter Befund).
 *  - B nicht gelaufen → Ergebnis von A mit Hinweis; bleibt ein Fehler (nie „ok" ohne Texte).
 */
export function kombiniereFewoStufen(
  a: FewoAuswertung,
  b: FewoAuswertung | null,
  ohneB?: { text: string; art?: FewoFehlerArt },
): FewoAuswertung {
  if (!a.fehler) return a
  const anhang = ` · ${STUFE_NAME.A}: ${kernA(a.fehler.text)}`
  if (!b) {
    const hinweis = ohneB?.text ?? 'nicht gelaufen'
    return { ...a, fehler: { art: ohneB?.art ?? a.fehler.art, grund: a.fehler.grund, text: `FeWo ${STUFE_NAME.B} ${kurz(hinweis, 170)}${anhang}` } }
  }
  if (!b.fehler) return b
  const fehler: FewoFehler = { art: b.fehler.art, grund: b.fehler.grund, text: `${kurz(b.fehler.text, 180)}${anhang}` }
  return b.items.length > a.items.length ? { ...b, fehler } : { ...a, vollstaendig: false, fehler, weg: 'A' }
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
 * Handimport vom 12.07.2026 (nur City Home): IDs der Form 'vrbo_fewo_<autor-slug>_<JJJJ-MM>', z. B.
 * vrbo_fewo_silke-s_2026-05, anonym: vrbo_fewo_verified_2025-06. Der Code hat solche IDs nie erzeugt und die
 * Spalten dieser Zeilen sind nicht verlässlich — erkannt wird deshalb allein über die ID (Slug + Monat).
 */
const FEWO_HAND_ID = /^vrbo_fewo_(.+?)_(\d{4}-\d{2})(?:[-_]\d{1,2})?$/
const ANONYM_SLUGS = ['verified', 'verifizierter-reisender', 'gast', 'anonym', 'anonymous']

/** Mögliche Slugs eines Autorennamens: mit ae/oe/ue, nur ohne Akzente, ganz ohne Umlaut-Behandlung. */
export function fewoAutorSlugs(name: string | null): string[] {
  const roh = String(name ?? '').normalize('NFC').toLowerCase().trim()
  if (ANONYM.includes(norm(roh))) return ANONYM_SLUGS
  const binde = (t: string) => t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const ohneAkzent = (t: string) => t.replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const de = roh.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
  return [...new Set([binde(ohneAkzent(de)), binde(ohneAkzent(roh)), binde(roh)])].filter(Boolean)
}

/**
 * Plant, welche gespeicherten Alt-Zeilen auf die stabile Portal-ID ('vrbo_<Bewertungs-ID>') umgehängt
 * werden — VOR countNew und Upsert, damit weder Dubletten entstehen noch created_at verloren geht.
 *
 * Alt-Zeile = ihre source_review_id lässt sich aus den EIGENEN Spalten nachrechnen (fewoAltId; Zeilen
 * werden nie nachträglich geändert), sie stammt aus dem Einfüge-Import ('vrbo_paste_…') oder aus dem
 * Handimport ('vrbo_fewo_<slug>_<JJJJ-MM>').
 * Partner-Suche unter den abgerufenen Bewertungen, deren ID noch nicht gespeichert ist:
 *   0. nur Handimport-Zeilen, allein über die ID: gleicher Aufenthaltsmonat + Autoren-Slug. Liegt der Partner
 *      bereits als EIGENE Zeile vor (Ziel-ID existiert schon — Zustand nach dem Lauf vom 5.10.: 4 Alt- und
 *      4 neue Zeilen), ist die Alt-Zeile eine bekannte Dublette: sie wird NICHT umgehängt (Unique-Konflikt),
 *      nicht gelöscht und nimmt an den Stufen 1–3 nicht teil — sonst hinge sie sich an eine fremde Bewertung.
 *      Der gespeicherte Partner hat Vorrang vor einem freien (jede eigene Zeile „verbraucht" eine Dublette).
 *      Ohne Partner im Abruf geht die Zeile nur bei VOLLSTÄNDIGEM Lauf weiter in Stufe 1/2.
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
  const hand = (r: FewoBestandZeile) => (r.source_review_id ?? '').match(FEWO_HAND_ID)
  let alt = bestand.filter((r) => paste(r) || !!hand(r) || r.source_review_id === fewoAltId(r.author_name, r.review_date, r.review_text))
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

  // Stufe 0: Handimport-Zeilen über Slug + Monat aus der ID
  let dubletten = 0
  const belegt = new Set<string>() // gespeicherte Partner, denen schon eine Dublette zugeordnet ist
  alt = alt.filter((a) => {
    const m = hand(a)
    if (!m) return true
    const passt = (n: FewoZeile) => (n.review_date ?? '').slice(0, 7) === m[2] && fewoAutorSlugs(n.author_name).includes(m[1])
    // Zuerst: liegt ein Partner schon als EIGENE Zeile vor? Dann ist die Alt-Zeile dessen Dublette und bleibt
    // stehen — sonst hinge sie sich an eine NEUE Bewertung mit gleichem Slug und Monat (zweite anonyme
    // Bewertung im selben Monat), die dann nicht als neu gezählt würde.
    const eigene = neu.filter((k) => passt(k) && !!k.source_review_id && vorhanden.has(k.source_review_id) && !belegt.has(k.source_review_id))
    const e = eigene.find((k) => note(a, k)) ?? eigene[0]
    if (e) { belegt.add(e.source_review_id as string); dubletten++; return false }
    const kandidaten = frei.filter(passt)
    const n = kandidaten.find((k) => note(a, k)) ?? kandidaten[0]
    if (n) {
      plan.push({ id: a.id, von: a.source_review_id ?? '', auf: n.source_review_id as string })
      frei.splice(frei.indexOf(n), 1)
      return false
    }
    // Partner abgerufen, aber seine ID ist schon vergeben (eigene Zeile oder eben verplant) → bekannte Dublette
    if (neu.some(passt)) { dubletten++; return false }
    // Kein Partner im Abruf. Vollständiger Lauf: wie jede andere Alt-Zeile weiter in Stufe 1/2. Unvollständiger
    // Lauf: der Partner kann schlicht fehlen — mit ihren unzuverlässigen Spalten bliebe sonst nur eine fremde
    // Bewertung mit gleicher Note und gleichem Monat; die Zeile bleibt deshalb unverändert stehen.
    return opts.vollstaendig
  })

  alt = alt.filter((a) => !nimm(a, frei.filter((n) => note(a, n) && !!a.review_date && n.review_date === a.review_date)))
  alt = alt.filter((a) => !nimm(a, frei.filter((n) => note(a, n) && (autor(a, n) || text(a, n)))))
  if (opts.vollstaendig) {
    // bekannte Dubletten zählen nicht als „zu viel" — ihretwegen darf keine fremde Zeile umgehängt werden
    let zuviel = bestand.length - dubletten + frei.length - neu.length
    for (const a of alt) {
      if (zuviel <= 0) break
      // Handimport: die Spalten sind unbekannt — „unsicher" ist dort nur die anonyme Zeile (laut ID)
      const m = hand(a)
      const unsicher = m
        ? ANONYM_SLUGS.includes(m[1])
        : ANONYM.includes(norm(a.author_name)) || !norm(a.review_text) || !/-01$/.test(a.review_date ?? '')
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

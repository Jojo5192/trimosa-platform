/**
 * Curated content for the region landing pages (/region/[slug]) and the
 * per-destination detail pages (/erlebnis/[slug]).
 * POI coordinates are approximate map positions for well-known destinations.
 * Texts stay deliberately timeless — no opening hours or prices.
 */

export type PoiCategory = 'sehenswert' | 'aktiv' | 'familie'

/**
 * Photo from Wikimedia Commons (curated + license-checked). `src` is a
 * 1280px thumb on upload.wikimedia.org — always render it through
 * next/image (or /_next/image) so visitors' browsers only talk to our
 * own domain. Full attribution is shown on the /erlebnis detail pages.
 */
export interface PoiImage {
  src: string
  author: string
  license: string
  licenseUrl?: string
  fileUrl: string
}

export interface KomootTour {
  title: string
  embedUrl: string
}

export type KulinarikKategorie = 'fein' | 'gasthaus' | 'wein' | 'cafe' | 'bar'

export const KULINARIK_KATEGORIEN: Record<KulinarikKategorie, { label: string; color: string; emoji: string }> = {
  fein:     { label: 'Fine Dining', color: '#E6C15A', emoji: '✨' },
  gasthaus: { label: 'Restaurants & Gasthäuser', color: '#E8956B', emoji: '🍽️' },
  wein:     { label: 'Wein & Vinotheken', color: '#D98CA6', emoji: '🍷' },
  cafe:     { label: 'Cafés & Einkehr', color: '#8FB8E8', emoji: '☕' },
  bar:      { label: 'Bier & Bars', color: '#7FD8A4', emoji: '🍺' },
}

/**
 * A curated food & drink recommendation ("Essen & Trinken" section, with map).
 * Selection favours long-established, top-reviewed places; texts stay
 * timeless (no opening hours, no prices, no hard rating numbers).
 */
export interface KulinarikTipp {
  emoji: string
  name: string
  /** Fine-grained badge label, e.g. "Weinstube", "Brauerlebnis" */
  art: string
  ort: string
  text: string
  kategorie: KulinarikKategorie
  lat: number
  lon: number
  /** Hosts' personal favourite — gets the gold "Unser Tipp" badge + bigger marker */
  top?: boolean
  /**
   * Exact Google Places text query for live rating lookup (server-side,
   * cached). Only for concrete businesses — collective tips (e.g.
   * "Straußwirtschaften in Olewig") stay without a rating badge.
   */
  googleQuery?: string
  /**
   * Curated Google place id — lets the rating lookup skip the quota-heavy
   * text search entirely (details call only). Resolved once via the admin
   * places-resolve diagnosis and pasted here.
   */
  googlePlaceId?: string
  /** Optional Wikimedia Commons photo (license-checked, proxied via next/image) */
  image?: PoiImage
}

export interface Poi {
  slug: string
  name: string
  category: PoiCategory
  lat: number
  lon: number
  emoji: string
  /** Short teaser (map popup + cards) */
  text: string
  /** Detail-page paragraphs */
  long: string[]
  image?: PoiImage
  /** Curated Komoot tours matching this destination (shown on its /erlebnis page) */
  komootTours?: KomootTour[]
}

export interface Region {
  slug: string
  name: string
  claim: string
  metaTitle: string
  metaDescription: string
  intro: string[]
  highlights: { emoji: string; title: string; text: string }[]
  pois: Poi[]
  center: [number, number]
  zoom: number
  /** Substring matched against listings.location to find the region's apartments */
  locationMatch: string
  /**
   * Curated POI slugs whose photos form the region's hero collage (region
   * page + homepage card, first slug = signature image). Falls back to the
   * first POIs with an image if a slug has none.
   */
  heroSlugs: string[]
  /** Optional "coming soon" teaser shown on the region page */
  comingSoon?: { title: string; text: string }
  /** Emoji used where no photo is available (homepage strip, Saar hero) */
  emoji: string
  /**
   * Curated Komoot tours (owner pastes the iframe src from Komoot's
   * "Einbetten" dialog). Shown as click-to-load embeds on the region page —
   * nothing is requested from komoot.com until the visitor opts in.
   */
  komootTours?: KomootTour[]
  /**
   * Curated food & drink recommendations ("Essen & Trinken") — hand-picked by
   * the hosts, deliberately timeless (no opening hours/prices), never paid.
   */
  kulinarik?: KulinarikTipp[]
}

export const POI_CATEGORIES: Record<PoiCategory, { label: string; color: string }> = {
  sehenswert: { label: 'Sehenswertes', color: '#B4552D' },
  aktiv: { label: 'Rad & Aktiv', color: '#2E7D4F' },
  familie: { label: 'Familie', color: '#2E6DB4' },
}

export const REGIONS: Record<string, Region> = {
  trier: {
    slug: 'trier',
    name: 'Trier & Umgebung',
    emoji: '🏛️',
    claim: 'Deutschlands älteste Stadt — Römer, Mosel und Weinberge',
    metaTitle: 'Ferienwohnungen in Trier & Umgebung',
    metaDescription:
      'Moderne Ferienwohnungen in Trier & Umgebung — direkt buchen bei TRIMOSA. Porta Nigra, Mosel-Radweg und Weinkultur vor der Tür.',
    intro: [
      'Über 2.000 Jahre Geschichte auf Schritt und Tritt: Trier ist Deutschlands älteste Stadt, und nirgendwo sonst nördlich der Alpen stehen so viele römische Baudenkmäler — von der Porta Nigra über die Kaiserthermen bis zum Amphitheater, allesamt UNESCO-Welterbe.',
      'Zwischen Altstadtgassen, Moselufer und Weinbergen liegt unser Zuhause: Unsere Apartments in und um Trier verbinden urbanes Leben mit schneller Flucht ins Grüne — morgens Cappuccino am Hauptmarkt, nachmittags Radtour an der Mosel, abends Riesling beim Winzer.',
    ],
    highlights: [
      { emoji: '🏛️', title: 'UNESCO-Welterbe', text: 'Porta Nigra, Dom, Kaiserthermen und Amphitheater — römische Geschichte im Original.' },
      { emoji: '🚴', title: 'Mosel-Radweg', text: 'Einer der schönsten Flussradwege Europas startet direkt vor der Haustür.' },
      { emoji: '🍷', title: 'Weinkultur', text: 'Weingüter und Vinotheken in Olewig und entlang der Mosel — Riesling, wo er herkommt.' },
      { emoji: '🇱🇺', title: 'Luxemburg nebenan', text: 'Die Hauptstadt Luxemburg erreicht ihr in rund 45 Minuten.' },
    ],
    pois: [
      {
        slug: 'porta-nigra', name: 'Porta Nigra', category: 'sehenswert', lat: 49.7596, lon: 6.6439, emoji: '🏛️',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Porta_Nigra_morgens_%28100MP%29.jpg/1280px-Porta_Nigra_morgens_%28100MP%29.jpg',
          author: 'Thomas Wolf, www.foto-tw.de',
          license: 'CC BY-SA 3.0 de',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/de/deed.en',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Porta_Nigra_morgens_(100MP).jpg',
        },
        text: 'Das besterhaltene römische Stadttor nördlich der Alpen — Wahrzeichen Triers und UNESCO-Welterbe.',
        long: [
          'Um 170 n. Chr. errichteten die Römer das gewaltige Stadttor aus grauen Sandsteinquadern — ganz ohne Mörtel, nur mit Eisenklammern verbunden. Dass die Porta Nigra als einziges der vier Trierer Stadttore die Jahrhunderte überstand, verdankt sie einem Umweg über die Kirche: Im Mittelalter wurde sie zur Doppelkirche umgebaut, erst Napoleon ließ den römischen Zustand wiederherstellen.',
          'Heute ist das „Schwarze Tor" der ikonische Startpunkt für jeden Trier-Besuch: Wer die Wendeltreppen hinaufsteigt, blickt über Dächer, Dom und Moseltal. Direkt dahinter beginnt die Fußgängerzone — perfekt, um den Stadtbummel zu starten.',
        ],
      },
      {
        slug: 'trierer-dom', name: 'Trierer Dom', category: 'sehenswert', lat: 49.7566, lon: 6.6431, emoji: '⛪',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Trier_BW_2013-04-14_15-59-54.JPG/1280px-Trier_BW_2013-04-14_15-59-54.JPG',
          author: 'Berthold Werner',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Trier_BW_2013-04-14_15-59-54.JPG',
        },
        text: 'Deutschlands älteste Bischofskirche, direkt neben der gotischen Liebfrauenkirche.',
        long: [
          'Der Dom St. Peter ist die älteste Bischofskirche Deutschlands — seine Ursprünge reichen bis in eine römische Palastanlage aus dem 4. Jahrhundert zurück. Wer genau hinsieht, erkennt in den Mauern noch antikes Mauerwerk; im Inneren wechseln sich Romanik, Gotik und Barock ab.',
          'Gleich nebenan steht die Liebfrauenkirche, eine der frühesten gotischen Kirchen Deutschlands — beide zusammen gehören zum UNESCO-Welterbe. Der Kreuzgang zwischen den Kirchen ist eine ruhige Oase mitten in der Altstadt.',
        ],
      },
      {
        slug: 'hauptmarkt-trier', name: 'Hauptmarkt', category: 'sehenswert', lat: 49.7573, lon: 6.6413, emoji: '⛲',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/2018_Trier%2C_Hauptmarkt_2.jpg/1280px-2018_Trier%2C_Hauptmarkt_2.jpg',
          author: 'Kleon3',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:2018_Trier,_Hauptmarkt_2.jpg',
        },
        text: 'Einer der schönsten Marktplätze Deutschlands — Cafés, Marktstände, Fachwerk.',
        long: [
          'Zwischen Marktkreuz und Petrusbrunnen schlägt das Herz der Trierer Altstadt: Der Hauptmarkt gilt als einer der schönsten Marktplätze Deutschlands, gesäumt von Renaissance-, Barock- und Fachwerkfassaden.',
          'Werktags füllen Blumen- und Obststände den Platz, drumherum reihen sich Cafés und Weinstuben. Von hier aus liegt alles in Gehweite: Porta Nigra, Dom und die Gassen der Fußgängerzone.',
        ],
      },
      {
        slug: 'kaiserthermen', name: 'Kaiserthermen', category: 'sehenswert', lat: 49.7519, lon: 6.6488, emoji: '🏺',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Trier_Kaiserthermen_BW_4.JPG/1280px-Trier_Kaiserthermen_BW_4.JPG',
          author: 'Berthold Werner',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Trier_Kaiserthermen_BW_4.JPG',
        },
        text: 'Römische Badruinen mit begehbaren unterirdischen Gängen.',
        long: [
          'Die Kaiserthermen gehörten zu den größten Badeanlagen des Römischen Reichs — geplant als kaiserliches Prestigeprojekt mit raffinierter Fußboden- und Wandheizung. Vollendet wurden sie nie als Bad, doch die Dimensionen beeindrucken bis heute.',
          'Das Besondere: Unter der Anlage könnt ihr durch die original erhaltenen Bediengänge laufen — ein unterirdisches Labyrinth, das die Technik hinter dem römischen Badeluxus zeigt. Für Kinder ein Abenteuer, für Erwachsene eine Zeitreise.',
        ],
      },
      {
        slug: 'amphitheater-trier', name: 'Amphitheater', category: 'sehenswert', lat: 49.7481, lon: 6.6543, emoji: '🎭',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fe/Trier_Roman_amphitheatre_in_October_2011.JPG/1280px-Trier_Roman_amphitheatre_in_October_2011.JPG',
          author: 'Nick-D',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Trier_Roman_amphitheatre_in_October_2011.JPG',
        },
        text: 'Römische Arena für 20.000 Zuschauer — im Sommer Kulisse für Festspiele.',
        long: [
          'Am Fuß des Petrisbergs liegt das römische Amphitheater, in dem einst bis zu 20.000 Zuschauer Gladiatorenkämpfe verfolgten. Der Kellerbereich unter der Arena — einst Aufzugstechnik für Kulissen und Käfige — ist begehbar.',
          'Im Sommer wird die Arena wieder bespielt: Konzerte und die Antikenfestspiele nutzen die einmalige Kulisse. Und vom Hang darüber habt ihr einen der besten Blicke über Trier — die Weinberge des Petrisbergs beginnen direkt hinter dem Ausgang.',
        ],
      },
      {
        slug: 'konstantin-basilika', name: 'Konstantin-Basilika', category: 'sehenswert', lat: 49.7532, lon: 6.6437, emoji: '👑',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/77/Trier-Konstantin-Basilika-04-2013-gje.jpg/1280px-Trier-Konstantin-Basilika-04-2013-gje.jpg',
          author: 'Gerd Eichmann',
          license: 'CC BY 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Trier-Konstantin-Basilika-04-2013-gje.jpg',
        },
        text: 'Der größte erhaltene Einzelraum der Antike — Thronsaal Kaiser Konstantins, heute Kirche.',
        long: [
          'Die Konstantin-Basilika war der Thronsaal des römischen Kaisers — ein Raum von 67 Metern Länge und 33 Metern Höhe, ganz ohne Stützen. Kein anderer Einzelraum der Antike hat sich in dieser Größe erhalten; die schiere Dimension sollte Besucher damals wie heute ehrfürchtig machen.',
          'Heute dient die Basilika als evangelische Kirche und gehört zum UNESCO-Welterbe. Direkt daneben schließt das Kurfürstliche Palais mit seiner Rokoko-Fassade an — der Palastgarten dahinter ist im Sommer das Wohnzimmer der Trierer und der schönste Fußweg zu Kaiserthermen und Amphitheater.',
        ],
      },
      {
        slug: 'roemerbruecke-trier', name: 'Römerbrücke', category: 'sehenswert', lat: 49.7513, lon: 6.6266, emoji: '🌉',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/R%C3%B6merbr%C3%BCcke_trier_spiegelt_sich_in_der_mosel.jpg/1280px-R%C3%B6merbr%C3%BCcke_trier_spiegelt_sich_in_der_mosel.jpg',
          author: 'HPL PICTURES',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:R%C3%B6merbr%C3%BCcke_trier_spiegelt_sich_in_der_mosel.jpg',
        },
        text: 'Die älteste Brücke Deutschlands — auf römischen Pfeilern aus dem 2. Jahrhundert rollt bis heute der Verkehr.',
        long: [
          'Ihre Basaltpfeiler stehen seit dem 2. Jahrhundert in der Mosel: Die Römerbrücke ist die älteste Brücke Deutschlands — und wird bis heute ganz alltäglich befahren. Römische Ingenieurskunst, die fast 1.900 Jahre Hochwasser, Kriege und Verkehr überstanden hat, UNESCO-Welterbe inklusive.',
          'Am schönsten wirkt die Brücke vom Moselufer aus, wenn sich die Bögen im Wasser spiegeln — besonders zur blauen Stunde. Wer auf dem Mosel-Radweg unterwegs ist, rollt direkt an ihr vorbei.',
        ],
      },
      {
        slug: 'karl-marx-haus', name: 'Karl-Marx-Haus', category: 'sehenswert', lat: 49.7526, lon: 6.6355, emoji: '📖',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/Karl-Marx-Haus_Trier_01.jpg/1280px-Karl-Marx-Haus_Trier_01.jpg',
          author: 'FrDr',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Karl-Marx-Haus_Trier_01.jpg',
        },
        text: 'Das barocke Geburtshaus von Karl Marx — Museum über Leben und Wirkung des berühmtesten Sohns der Stadt.',
        long: [
          'Im barocken Bürgerhaus in der Brückenstraße wurde 1818 Karl Marx geboren — heute ist es ein Museum, das Leben, Werk und die weltweite Wirkungsgeschichte des Philosophen zeigt, modern aufbereitet und kritisch eingeordnet.',
          'Der Besuch lässt sich perfekt mit der Altstadt verbinden: Hauptmarkt und Dom liegen nur wenige Gehminuten entfernt. Auch wer mit Marx wenig anfangen kann, bekommt hier ein Stück Weltgeschichte im Trierer Maßstab.',
        ],
      },
      {
        slug: 'mariensaeule-trier', name: 'Mariensäule & Markusberg', category: 'aktiv', lat: 49.7602, lon: 6.6199, emoji: '🌄',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Mariens%C3%A4ule_Trier.JPG/1280px-Mariens%C3%A4ule_Trier.JPG',
          author: 'Gerdle Knühl',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Mariens%C3%A4ule_Trier.JPG',
        },
        text: 'Der Panorama-Spot: 40 Meter hohe Säule auf dem Markusberg mit dem besten Blick über Trier.',
        long: [
          'Hoch über dem Moselufer steht auf dem Markusberg die Mariensäule, 1866 errichtet und weithin sichtbar. Zu ihren Füßen liegt der beste kostenlose Aussichtspunkt der Stadt: ganz Trier, das Moseltal und die Weinberge in einem einzigen Blick.',
          'Der Aufstieg von der Römerbrücke dauert zu Fuß eine gute halbe Stunde durch den Wald — oben belohnt die Aussicht, abends das Lichtermeer der Stadt. Wer es bequem mag, fährt mit dem Auto bis kurz unter die Kuppe.',
        ],
      },
      {
        slug: 'igeler-saeule', name: 'Igeler Säule', category: 'sehenswert', lat: 49.7093, lon: 6.5486, emoji: '🗿',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Igel_S%C3%A4ule_3%2B.jpg/1280px-Igel_S%C3%A4ule_3%2B.jpg',
          author: 'Michael Fiegle',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Igel_S%C3%A4ule_3%2B.jpg',
        },
        text: 'Das höchste römische Pfeilergrabmal nördlich der Alpen — UNESCO-Welterbe im Nachbarort.',
        long: [
          'Mitten im Ortskern von Igel, nur wenige Minuten von unseren Apartments bei Trier, steht ein 23 Meter hohes römisches Grabmal aus dem 3. Jahrhundert — das besterhaltene seiner Art nördlich der Alpen und Teil des Trierer UNESCO-Welterbes.',
          'Die Reliefs erzählen vom Alltag der Tuchhändlerfamilie Secundinier, die das Monument errichten ließ — Alltagsszenen, Handelsgeschäfte, Mythologie. Schon Goethe war beeindruckt. Ideal als Zwischenstopp auf der Radtour Richtung Luxemburg oder Wasserbillig.',
        ],
      },
      {
        slug: 'mosel-radweg', name: 'Mosel-Radweg', category: 'aktiv', lat: 49.7669, lon: 6.6277, emoji: '🚴',
        komootTours: [
          { title: 'Mosel-Weinberge & Römerstadt — Runde ab Trier (45,5 km · ~2:45 h)', embedUrl: 'https://www.komoot.com/de-de/smarttour/18050087/embed?profile=1' },
          { title: 'Moselschleuse & Mosel-Radweg — Runde ab Trier (30,9 km · ~2:00 h)', embedUrl: 'https://www.komoot.com/de-de/smarttour/43179718/embed?profile=1' },
        ],
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Zurlaubener_Ufer%2C_Trier_%28Germany%29%2C_6_April_2020.jpg/1280px-Zurlaubener_Ufer%2C_Trier_%28Germany%29%2C_6_April_2020.jpg',
          author: 'Cobatfor',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Zurlaubener_Ufer,_Trier_(Germany),_6_April_2020.jpg',
        },
        text: 'Einstieg in den Mosel-Radweg am alten Fischerviertel Zurlauben mit Biergärten am Wasser.',
        long: [
          'Der Mosel-Radweg gehört zu den beliebtesten Flussradwegen Europas: überwiegend flach, bestens ausgebaut und immer am Wasser entlang, vorbei an Weinbergen, Fachwerkdörfern und Fähranlegern. In Trier steigt ihr am Zurlaubener Ufer ein — dem alten Fischerviertel mit Biergärten direkt am Fluss.',
          'Flussabwärts erreicht ihr Schweich und die Weinorte der Mittelmosel, flussaufwärts geht es Richtung Konz, wo die Saar mündet — und weiter ins Dreiländereck nach Luxemburg. Tagesetappen lassen sich beliebig kombinieren, zurück geht es bequem mit der Bahn.',
        ],
      },
      {
        slug: 'weinlage-olewig', name: 'Weinlage Olewig', category: 'aktiv', lat: 49.742, lon: 6.665, emoji: '🍷',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Trier-Olewig_-_Luftaufnahme-0575.jpg/1280px-Trier-Olewig_-_Luftaufnahme-0575.jpg',
          author: 'Raimond Spekking',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Trier-Olewig_-_Luftaufnahme-0575.jpg',
        },
        text: 'Weingüter, Straußwirtschaften und Weinlehrpfad am Stadtrand.',
        long: [
          'Olewig ist Triers Winzerviertel: Ein Dorf in der Stadt, umgeben von Rebhängen, mit traditionsreichen Weingütern und gemütlichen Straußwirtschaften, in denen der eigene Wein ausgeschenkt wird.',
          'Der Weinlehrpfad führt durch die Lagen oberhalb des Orts — mit Blick über Trier und das Moseltal. Im Spätsommer lohnt das Olewiger Weinfest, eines der ältesten der Region. Zu Fuß oder mit dem Rad seid ihr vom Zentrum in einer Viertelstunde da.',
        ],
      },
      {
        slug: 'ruwer-hochwald-radweg', name: 'Ruwer-Hochwald-Radweg', category: 'aktiv', lat: 49.753, lon: 6.705, emoji: '🚵',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ruwer-Radweg_bei_Ruwer.jpg/1280px-Ruwer-Radweg_bei_Ruwer.jpg',
          author: 'LoKiLeCh',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Ruwer-Radweg_bei_Ruwer.jpg',
        },
        text: 'Autofreier Bahntrassen-Radweg von der Mosel bis in den Hunsrück.',
        long: [
          'Auf der Trasse der alten Hochwaldbahn führt der Ruwer-Hochwald-Radweg von der Moselmündung bei Ruwer knapp 50 Kilometer hinauf in den Hunsrück — komplett autofrei und mit sanfter, gleichmäßiger Bahntrassen-Steigung.',
          'Unterwegs: Viadukte, Tunnel, das Ruwertal mit seinen Rieslinglagen und viel Wald. Wer es entspannt mag, rollt bergab zurück Richtung Mosel — oder nutzt die Radbusse in der Saison.',
        ],
      },
      {
        slug: 'weisshauswald', name: 'Weisshauswald & Wildgehege', category: 'familie', lat: 49.7687, lon: 6.6341, emoji: '🌳',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Trier_Villa_Wei%C3%9Fhaus_BW_2013-07-19_12-25-40.jpg/1280px-Trier_Villa_Wei%C3%9Fhaus_BW_2013-07-19_12-25-40.jpg',
          author: 'Berthold Werner',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Trier_Villa_Wei%C3%9Fhaus_BW_2013-07-19_12-25-40.jpg',
        },
        text: 'Wildgehege, Spielplätze und Waldwege hoch über der Stadt.',
        long: [
          'Hoch über dem Moselufer liegt der Weisshauswald — Triers Hauswald mit kostenlosem Wildgehege: Damwild, Wildschweine und Rotwild lassen sich das ganze Jahr beobachten, dazu Spielplätze und Grillhütten zwischen alten Buchen.',
          'Vom Aussichtspunkt am Weisshaus habt ihr den Postkartenblick über Trier und die Mosel. Mit dem Auto oder Bus in wenigen Minuten erreichbar — sportliche laufen den Hang von den Kaiserthermen hinauf.',
        ],
      },
      {
        slug: 'luxemburg-stadt', name: 'Luxemburg-Stadt', category: 'sehenswert', lat: 49.6116, lon: 6.1319, emoji: '🇱🇺',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Luxembourg-ville_%E2%80%93Corniche.jpg/1280px-Luxembourg-ville_%E2%80%93Corniche.jpg',
          author: 'Cayambe',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Luxembourg-ville_%E2%80%93Corniche.jpg',
        },
        text: 'UNESCO-Altstadt, Kasematten und Kirchberg — Europas kleinste Hauptstadt, 45 Minuten entfernt.',
        long: [
          'Die Altstadt von Luxemburg thront spektakulär über den Tälern von Alzette und Pétrusse — Festungsmauern, der Chemin de la Corniche („schönster Balkon Europas") und die in den Fels gehauenen Kasematten gehören zum UNESCO-Welterbe.',
          'Dazu kommen Museen von Weltrang, die Kathedrale und das moderne Europaviertel auf dem Kirchberg. Praktisch für den Tagesausflug: Der gesamte öffentliche Nahverkehr in Luxemburg ist kostenlos — Park+Ride am Stadtrand und entspannt hineinfahren.',
        ],
      },
    ],
    center: [49.756, 6.641],
    zoom: 13,
    locationMatch: 'Trier',
    kulinarik: [
      {
        emoji: '✨', name: "BECKER'S", art: 'Fine Dining', ort: 'Trier-Olewig',
        kategorie: 'fein', lat: 49.742, lon: 6.6679, top: true, googleQuery: "BECKER'S Hotel Restaurant Olewiger Straße Trier", googlePlaceId: 'ChIJ1Q4j0od7lUcRsRbhCgdJ3k4',
        text: 'Triers erste Gourmet-Adresse: Fine Dining im Designhotel mitten im Weinort Olewig — langjährig sternedekoriert und im Guide Michelin geführt, dazu Weine vom eigenen Gut.',
      },
      {
        emoji: '🦢', name: 'Bagatelle', art: 'Fine Dining', ort: 'Zurlaubener Ufer, Trier',
        kategorie: 'fein', lat: 49.7647, lon: 6.635, googleQuery: 'Bagatelle Restaurant Zurlaubener Ufer Trier', googlePlaceId: 'ChIJ6Tmh3bx9lUcRogoGH2j1bnQ',
        text: 'Kreative Küche im alten Fischerviertel Zurlauben, direkt am Moselufer — im Guide Michelin empfohlen, im Sommer mit Terrasse zum Fluss.',
      },
      {
        emoji: '🦉', name: 'Schlemmereule', art: 'Fine Dining', ort: 'Domfreihof, Trier',
        kategorie: 'fein', lat: 49.7569, lon: 6.6422, googleQuery: 'Schlemmereule Trier Domfreihof', googlePlaceId: 'ChIJZygDdZB8lUcR6e2De5RZDAk',
        text: 'Gehobene Küche im Palais Walderdorff direkt am Dom — seit Jahren eine feste Größe der Trierer Gastronomie.',
      },
      {
        emoji: '🏰', name: 'Schloss Monaise', art: 'Schloss-Restaurant', ort: 'Trier-Euren, an der Mosel',
        kategorie: 'fein', lat: 49.7173, lon: 6.5997, googleQuery: 'Restaurant Schloss Monaise Trier', googlePlaceId: 'ChIJEW9JtNJklUcRDg8XRBS3D3w',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Trier_Schloss_Monaise_BW_2017-09-10_15-22-54.jpg/1280px-Trier_Schloss_Monaise_BW_2017-09-10_15-22-54.jpg',
          author: 'Berthold Werner',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Trier_Schloss_Monaise_BW_2017-09-10_15-22-54.jpg',
        },
        text: 'Speisen im klassizistischen Schlösschen direkt am Moselufer — feine Küche, große Terrasse unter alten Bäumen, im Guide Michelin empfohlen.',
      },
      {
        emoji: '🏛️', name: 'Zum Domstein', art: 'Römische Küche', ort: 'Hauptmarkt, Trier',
        kategorie: 'gasthaus', lat: 49.7571, lon: 6.641, googleQuery: 'Zum Domstein Hauptmarkt Trier', googlePlaceId: 'ChIJiZHrgJp8lUcRTBRpV-AH9gk',
        text: 'Institution am Hauptmarkt — neben regionaler Küche gibt es Gerichte nach altrömischen Rezepten, serviert über einem originalen römischen Gewölbekeller.',
      },
      {
        emoji: '🍽️', name: 'Weinwirtschaft Friedrich-Wilhelm', art: 'Weinrestaurant', ort: 'Weberbach, Trier',
        kategorie: 'gasthaus', lat: 49.7536, lon: 6.6415, googleQuery: 'Weinwirtschaft Friedrich-Wilhelm Trier', googlePlaceId: 'ChIJiWFdEJt8lUcRR_H5FBHJgrY',
        text: 'Regionale Küche und eine große Auswahl an Mosel-, Saar- und Ruwerweinen im historischen Ambiente an der Weberbach.',
      },
      {
        emoji: '🌿', name: 'Herrlich Ehrlich', art: 'Fusion-Küche', ort: 'Trier-West',
        kategorie: 'gasthaus', lat: 49.7553, lon: 6.6257, googleQuery: 'Herrlich Ehrlich Trier', googlePlaceId: 'ChIJ-8r7eKN8lUcRQIL__sRClGg',
        text: 'Hipper Genuss-Spot in Trier-West: europäisch-arabische Fusion-Küche — im Sommer große Terrasse unter Bäumen und Lichterketten.',
      },
      {
        emoji: '🍔', name: 'Der Daddy', art: 'Burger', ort: 'Neustraße, Trier',
        kategorie: 'gasthaus', lat: 49.7502, lon: 6.6374, googleQuery: 'Der Daddy Burger Trier Neustraße', googlePlaceId: 'ChIJb2zaJJx8lUcRnkL9v_We0Xw',
        text: 'Beef, Buns & Burgers: Der Kult-Laden in der Neustraße wird von vielen als die beste Burger-Adresse der Stadt gehandelt.',
      },
      {
        emoji: '🍔', name: 'Burgeramt Trier', art: 'Burger', ort: 'Nagelstraße, Trier',
        kategorie: 'gasthaus', lat: 49.7536, lon: 6.6384, googleQuery: 'Burgeramt Trier Nagelstraße',
        googlePlaceId: 'ChIJGShfxJt8lUcRYD8XB1Jq2Kg',
        text: 'Burger-Institution in der Fußgängerzone: Alles hausgemacht von A bis Z — von den Buns bis zu den Saucen, auch vegetarisch und vegan.',
      },
      {
        emoji: '🍷', name: 'Weinstube Kesselstatt', art: 'Weinstube', ort: 'An der Liebfrauenkirche, Trier',
        kategorie: 'wein', lat: 49.7557, lon: 6.6423, googleQuery: 'Weinstube Kesselstatt Trier', googlePlaceId: 'ChIJET6Ul5p8lUcRobVMexznOJc',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Trier_Palais_Kesselstadt_BW_1.JPG/1280px-Trier_Palais_Kesselstadt_BW_1.JPG',
          author: 'Berthold Werner',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Trier_Palais_Kesselstadt_BW_1.JPG',
        },
        text: 'Rustikale Weinstube im Palais Kesselstatt im Schatten des Doms — Rieslinge von Mosel, Saar und Ruwer, dazu Winzervesper und regionale Kleinigkeiten.',
      },
      {
        emoji: '⛱️', name: 'Weinstand am Hauptmarkt', art: 'Sommer-Highlight', ort: 'Hauptmarkt, Trier',
        kategorie: 'wein', lat: 49.7575, lon: 6.6416, top: true, googleQuery: 'Weinstand Trier Hauptmarkt', googlePlaceId: 'ChIJ95sfaIh9lUcRv_iYpPa9-yY',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4b/2018_Trier%2C_Hauptmarkt_2.jpg/1280px-2018_Trier%2C_Hauptmarkt_2.jpg',
          author: 'Kleon3',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:2018_Trier,_Hauptmarkt_2.jpg',
        },
        text: 'Das Sommer-Ritual der Trierer: Bei schönem Wetter schenken wechselnde Winzer mitten auf dem Hauptmarkt aus — Riesling unter freiem Himmel.',
      },
      {
        emoji: '🥂', name: 'La Rochelle', art: 'Weinlokal', ort: 'Johann-Philipp-Straße, Trier',
        kategorie: 'wein', lat: 49.7547, lon: 6.6396, googleQuery: 'La Rochelle Trier', googlePlaceId: 'ChIJZ1ZkSZp8lUcRiHtLzFCqfNk',
        text: 'Charmantes Weinlokal in der Altstadt — gepflegte Auswahl regionaler und internationaler Weine, perfekt für den Abend in der Stadt.',
      },
      {
        emoji: '🍇', name: 'Straußwirtschaften in Olewig', art: 'Weinviertel', ort: 'Trier-Olewig',
        kategorie: 'wein', lat: 49.7422, lon: 6.6628,
        text: 'Das Winzerviertel der Stadt: In der Saison öffnen Weingüter ihre Höfe und schenken den eigenen Wein direkt an den Weinbergen aus.',
      },
      {
        emoji: '🍰', name: 'Café Razen', art: 'Konditorei seit 1953', ort: 'Sichelstraße, Trier',
        kategorie: 'cafe', lat: 49.7578, lon: 6.645, googleQuery: 'Café Razen Sichelstraße Trier', googlePlaceId: 'ChIJ1V694I98lUcRRD3RF9luwwU',
        text: 'Konditorei-Institution in dritter Generation: handgemachte Torten, Croissants und eigenes Eis — wenige Schritte vom Hauptmarkt.',
      },
      {
        emoji: '🎂', name: 'Café-Konditorei Raab', art: 'Konditorei', ort: 'Karl-Marx-Straße, Trier',
        kategorie: 'cafe', lat: 49.7531, lon: 6.634, googleQuery: 'Café Konditorei Raab Trier', googlePlaceId: 'ChIJ_6pM35h8lUcRG9MLPJ7iyfs',
        text: 'Konditor-Handwerk in vierter Generation: Torten, Pralinen und Kaffee wie früher — ein Klassiker an der Karl-Marx-Straße.',
      },
      {
        emoji: '🍺', name: 'Craftprotz', art: 'Kreativbierbar', ort: 'Palaststraße, Trier',
        kategorie: 'bar', lat: 49.7551, lon: 6.6413, top: true, googleQuery: 'Craftprotz Trier', googlePlaceId: 'ChIJ-YZRcQR9lUcRO7cKMBi9Kew',
        text: 'Kreativbierbar mit ständig wechselnden Craft-Bieren — gegründet von einem guten Freund des Hauses. Top, wenn du über den Bier-Tellerrand schauen willst.',
      },
    ],
    heroSlugs: ['porta-nigra', 'hauptmarkt-trier', 'kaiserthermen'],
    komootTours: [
      { title: 'Mosel-Weinberge & Römerstadt — Runde ab Trier (45,5 km · ~2:45 h)', embedUrl: 'https://www.komoot.com/de-de/smarttour/18050087/embed?profile=1' },
      { title: 'Moselschleuse & Mosel-Radweg — Runde ab Trier (30,9 km · ~2:00 h)', embedUrl: 'https://www.komoot.com/de-de/smarttour/43179718/embed?profile=1' },
    ],
  },

  bitburg: {
    slug: 'bitburg',
    name: 'Bitburg',
    emoji: '🍺',
    claim: 'Bierstadt im Herzen der Eifel — Genuss, Natur und kurze Wege',
    metaTitle: 'Ferienwohnungen in Bitburg',
    metaDescription:
      'Moderne Ferienwohnungen in Bitburg — direkt buchen bei TRIMOSA. Bitburger Erlebniswelt, Stausee und Eifel-Radwege vor der Tür.',
    intro: [
      'Bitte ein Bit: Bitburg ist weit über die Eifel hinaus für seine Brauerei bekannt — und überrascht mit einer gemütlichen Innenstadt, kurzen Wegen und viel Natur ringsum.',
      'Von hier aus seid ihr in wenigen Minuten am Stausee, auf den Bahntrassen-Radwegen durchs Kyll- und Nimstal oder in der Südeifel. Unsere Apartments liegen zentral: Bäcker, Cafés und die Fußgängerzone erreicht ihr zu Fuß.',
    ],
    highlights: [
      { emoji: '🍺', title: 'Bitburger Erlebniswelt', text: 'Die Marken-Erlebniswelt der Brauerei — Führung inklusive frisch gezapfter Verkostung.' },
      { emoji: '🏞️', title: 'Stausee Bitburg', text: 'Baden, Tretboot und Rundweg — das Naherholungsgebiet der Stadt, 10 Minuten entfernt.' },
      { emoji: '🚴', title: 'Radwege-Knoten', text: 'Kylltal-, Nims- und Enztal-Radweg: autofreie Bahntrassen in alle Richtungen.' },
      { emoji: '🎢', title: 'Familien-Ausflüge', text: 'Cascade Erlebnisbad und Eifelpark Gondorf — Regen- wie Sonnenprogramm.' },
    ],
    pois: [
      {
        slug: 'bitburger-erlebniswelt', name: 'Bitburger Marken-Erlebniswelt', category: 'sehenswert', lat: 49.9664, lon: 6.5227, emoji: '🍺',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Bitburg_%28Eifel%29%3B_Bitburger_Brauerei_f.jpg/1280px-Bitburg_%28Eifel%29%3B_Bitburger_Brauerei_f.jpg',
          author: 'Colling-architektur',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Bitburg_(Eifel);_Bitburger_Brauerei_f.jpg',
        },
        text: 'Interaktive Brauerei-Erlebniswelt mit Verkostung — das Aushängeschild der Stadt.',
        long: [
          'Seit 1817 wird in Bitburg gebraut — heute ist Bitburger eine der bekanntesten Biermarken Deutschlands. In der Marken-Erlebniswelt mitten in der Stadt erlebt ihr die Geschichte und Braukunst interaktiv: vom Rohstoff bis zur Abfüllung.',
          'Das Finale ist verdient: frisch gezapftes Bitburger direkt an der Quelle. Wer mag, kombiniert den Besuch mit einem Bummel durch die angrenzende Fußgängerzone — die Erlebniswelt liegt nur wenige Gehminuten von unseren Apartments.',
        ],
      },
      {
        slug: 'bitburg-innenstadt', name: 'Innenstadt & Bedaplatz', category: 'sehenswert', lat: 49.9736, lon: 6.5253, emoji: '🛍️',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Fu%C3%9Fg%C3%A4ngerzone_in_Bitburg_-_panoramio.jpg/1280px-Fu%C3%9Fg%C3%A4ngerzone_in_Bitburg_-_panoramio.jpg',
          author: 'Tourist-Information …',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Fu%C3%9Fg%C3%A4ngerzone_in_Bitburg_-_panoramio.jpg',
        },
        text: 'Gemütliche Innenstadt mit Cafés, Eisdielen und Wochenmarkt.',
        long: [
          'Bitburgs Fußgängerzone rund um den Bedaplatz ist das Wohnzimmer der Stadt: Cafés und Eisdielen mit Außenterrassen, inhabergeführte Geschäfte und mittwochs wie samstags der Wochenmarkt mit regionalen Erzeugern.',
          'Die kurzen Wege sind der Luxus: Vom Apartment zum Bäcker, vom Markt zur Eisdiele — alles fußläufig. Im Sommer beleben Stadtfeste und das Bitburger Folklore-Festival die Plätze.',
        ],
      },
      {
        slug: 'stausee-bitburg', name: 'Stausee Bitburg', category: 'aktiv', lat: 49.9931, lon: 6.4429, emoji: '🏞️',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/61/StauseeBitburg01.JPG/1280px-StauseeBitburg01.JPG',
          author: 'Helfmann',
          license: 'CC BY-SA 3.0 de',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/de/deed.en',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:StauseeBitburg01.JPG',
        },
        text: 'Naherholungsgebiet mit Badestelle, Tretbooten, Minigolf und Seerundweg.',
        long: [
          'Zehn Autominuten von Bitburg staut die Prüm den Stausee Biersdorf — das Naherholungsgebiet der Region. Der Rundweg um den See ist flach und kinderwagentauglich, unterwegs warten Badestelle, Tretbootverleih, Minigolf und Seeterrassen.',
          'Angler schätzen die ruhigen Buchten, Familien den Spielplatz am Ufer. Wer mehr will: Der Prümtal-Radweg führt direkt am See vorbei — ideal für eine Feierabendrunde.',
        ],
      },
      {
        slug: 'kylltal-radweg', name: 'Kylltal-Radweg', category: 'aktiv', lat: 50.0392, lon: 6.5911, emoji: '🚴',
        komootTours: [
          { title: 'Kyll-Ufer-Radweg & Bitburger Radweg — Runde ab Bitburg (31,7 km · ~2:00 h)', embedUrl: 'https://www.komoot.com/de-de/smarttour/17647796/embed?profile=1' },
        ],
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Kylltal-Radweg%2C_Kyller_Tunnel%2C_Westportal.jpg/1280px-Kylltal-Radweg%2C_Kyller_Tunnel%2C_Westportal.jpg',
          author: 'Zv0486~commonswiki',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Kylltal-Radweg,_Kyller_Tunnel,_Westportal.jpg',
        },
        text: 'Einer der schönsten Bahntrassen-Radwege der Eifel — von Kyllburg bis Trier.',
        long: [
          'Der Kylltal-Radweg folgt der Kyll von der Hocheifel bis zur Mündung in die Mosel bei Trier — große Teile verlaufen auf ehemaligen Bahntrassen oder ruhigen Talstraßen, vorbei an Burgen, Felsen und Eifeldörfern.',
          'Besonders reizvoll ist der Abschnitt um Kyllburg mit seiner Stiftskirche hoch über dem Fluss. Praktisch: Die Eifelbahn fährt parallel — einfach bergauf mit dem Zug, bergab mit dem Rad.',
        ],
      },
      {
        slug: 'nims-radweg', name: 'Nims-Radweg', category: 'aktiv', lat: 49.9887, lon: 6.4956, emoji: '🚵',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/1/18/Nims.jpg',
          author: 'Rossi57 in der Wikipedia auf Deutsch',
          license: 'Public domain',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Nims.jpg',
        },
        text: 'Idyllischer Flussradweg durchs Nimstal, vorbei an Burg Rittersdorf.',
        long: [
          'Die Nims ist der stille Star unter den Eifelflüssen: Ihr Radweg schlängelt sich durch ein ruhiges Wiesental von der Quelle bei Neuerburg bis zur Mündung in die Prüm — ohne nennenswerten Verkehr, dafür mit viel Natur.',
          'Ab Bitburg erreicht ihr das Tal in wenigen Minuten; die Wasserburg Rittersdorf ist ein lohnender Zwischenstopp. Wer Strecke machen will, kombiniert Nims- und Prümtal-Radweg zu einer großen Runde.',
        ],
      },
      {
        slug: 'cascade-erlebnisbad', name: 'Cascade Erlebnisbad', category: 'familie', lat: 49.9702, lon: 6.5341, emoji: '💦',
        text: 'Erlebnisbad mit Rutschen, Sauna und Außenbecken — 15 Gehminuten vom Zentrum.',
        long: [
          'Das Cascade ist Bitburgs Schlechtwetter-Joker und Sommer-Klassiker zugleich: Erlebnisbecken mit Strömungskanal, Riesenrutsche, Kinderbereich und ganzjährig beheiztes Außenbecken — dazu eine Saunalandschaft für die Erwachsenen.',
          'Vom Stadtzentrum lauft ihr eine Viertelstunde, mit dem Auto sind es drei Minuten. An Regentagen entsprechend beliebt — früh kommen lohnt sich.',
        ],
      },
      {
        slug: 'eifelpark-gondorf', name: 'Eifelpark Gondorf', category: 'familie', lat: 49.935, lon: 6.447, emoji: '🎢',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Eifelpark_Petz_auf_Rutsche.jpg/1280px-Eifelpark_Petz_auf_Rutsche.jpg',
          author: 'Diebine, Eifelpark GmbH',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'http://creativecommons.org/licenses/by-sa/3.0/',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Eifelpark_Petz_auf_Rutsche.jpg',
        },
        text: 'Freizeit- und Wildpark mit Sommerrodelbahn — 10 Autominuten.',
        long: [
          'Der Eifelpark verbindet Wildpark und Freizeitpark: Bären, Wölfe und Hirsche im weitläufigen Waldgelände, dazu Fahrgeschäfte, Shows und die lange Sommerrodelbahn den Eifelhang hinunter.',
          'Für Familien mit Kindern zwischen 3 und 12 der verlässlichste Ganztagesausflug der Gegend — und von Bitburg in zehn Minuten erreicht.',
        ],
      },
      {
        slug: 'burg-rittersdorf', name: 'Burg Rittersdorf', category: 'sehenswert', lat: 49.9899, lon: 6.4939, emoji: '🏰',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Burg_Rittersdorf_-_panoramio.jpg/1280px-Burg_Rittersdorf_-_panoramio.jpg',
          author: 'Tourist-Information …',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Burg_Rittersdorf_-_panoramio.jpg',
        },
        text: 'Wasserburg aus dem 12. Jahrhundert mit Restaurant im Burghof.',
        long: [
          'Von Wasser umgeben und über eine Steinbrücke erreichbar: Die Burg Rittersdorf aus dem 12. Jahrhundert ist eine der besterhaltenen Wasserburgen der Eifel — mit Burghof, kleinem Museum und standesamtlichem Trauzimmer im Turm.',
          'Im Burgrestaurant sitzt ihr im Sommer im Innenhof. Die Burg liegt direkt am Nims-Radweg — perfekter Etappenstopp bei der Tour durchs Tal.',
        ],
      },
      {
        slug: 'villa-otrang', name: 'Römische Villa Otrang', category: 'sehenswert', lat: 50.0075, lon: 6.5586, emoji: '🏺',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/0/0a/R%C3%B6mische_Villa_Otrang_Panorama.jpg',
          author: 'Tourist-Information Bitburger Land',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:R%C3%B6mische_Villa_Otrang_Panorama.jpg',
        },
        text: 'Eine der besterhaltenen römischen Villenanlagen nördlich der Alpen — mit originalen Mosaiken.',
        long: [
          'Vor den Toren Bitburgs bei Fließem liegt die Villa Otrang: ein römisches Landgut mit über 60 Räumen, dessen Ausmaße noch heute beeindrucken. Vier prächtige Mosaikböden sind im Original erhalten — geschützt in Pavillons aus dem 19. Jahrhundert.',
          'Fußbodenheizung, Badetrakt, Wirtschaftsgebäude: Die Anlage zeigt, wie komfortabel römisches Landleben war. Zusammen mit Triers Bauwerken ergibt das den perfekten Römer-Doppeltag.',
        ],
      },
    ],
    center: [49.9725, 6.523],
    zoom: 13,
    locationMatch: 'Bitburg',
    kulinarik: [
      {
        emoji: '🍺', name: 'Zum Simonbräu', art: 'Brauhaus', ort: 'Am Markt, Bitburg',
        kategorie: 'gasthaus', lat: 49.9739, lon: 6.522, top: true, googleQuery: 'Zum Simonbräu Bitburg', googlePlaceId: 'ChIJAcu7z-7cv0cR0FshUNqTPfs',
        text: 'Im Stammhaus der Bitburger-Brauerei: regionale Küche mit französischem Einschlag und frisch Gezapftes — mitten in der Stadt.',
      },
      {
        emoji: '🍽️', name: 'Torschänke Dudeldorf', art: 'Gasthaus', ort: 'Dudeldorf',
        kategorie: 'gasthaus', lat: 49.9738, lon: 6.6364, googleQuery: 'Restaurant Torschänke Dudeldorf', googlePlaceId: 'ChIJUXc4ML7av0cRiOQkpL-iX7Y',
        text: 'Die „gute Stube" des historischen Torbogen-Dorfs Dudeldorf — herzlich, familiär und verlässlich gut, ein Liebling der Region.',
      },
      {
        emoji: '🍻', name: 'Bitburger Marken-Erlebniswelt', art: 'Brauerlebnis', ort: 'Bitburg',
        kategorie: 'gasthaus', lat: 49.9664, lon: 6.5227, googleQuery: 'Bitburger Marken-Erlebniswelt Bitburg', googlePlaceId: 'ChIJoUuQ0ejcv0cR0YxjMbYdlCw',
        text: 'Führung durch die Markenwelt der berühmten Brauerei — am Ende wartet ein frisch gezapftes Pils direkt an der Quelle.',
      },
      {
        emoji: '🏞️', name: 'Einkehr am Stausee', art: 'Café & Biergarten', ort: 'Biersdorf am See',
        kategorie: 'cafe', lat: 49.9931, lon: 6.4429,
        text: 'Nach der Runde um den See auf die Terrasse: Kaffee und Kuchen oder ein kühles Bit mit Blick übers Wasser.',
      },
    ],
    heroSlugs: ['burg-rittersdorf', 'stausee-bitburg', 'villa-otrang'],
    komootTours: [
      { title: 'Kyll-Ufer-Radweg & Bitburger Radweg — Runde ab Bitburg (31,7 km · ~2:00 h)', embedUrl: 'https://www.komoot.com/de-de/smarttour/17647796/embed?profile=1' },
      { title: 'Prümtal & Bitburger Radweg — Runde ab Bitburg (37,7 km · ~2:30 h)', embedUrl: 'https://www.komoot.com/de-de/smarttour/17648381/embed?profile=1' },
    ],
  },

  suedeifel: {
    slug: 'suedeifel',
    name: 'Südeifel & Sauertal',
    emoji: '🪨',
    claim: 'Felsen, Flüsse und Luxemburg vor der Tür — Natur pur',
    metaTitle: 'Ferienwohnungen in der Südeifel & im Sauertal',
    metaDescription:
      'Moderne Ferienwohnungen in der Südeifel — direkt buchen bei TRIMOSA. Teufelsschlucht, Sauertal-Radweg und Müllerthal direkt vor der Tür.',
    intro: [
      'Bizarre Felsformationen, tief eingeschnittene Täler und die Sauer als Grenzfluss zu Luxemburg: Die Südeifel ist das Wander- und Outdoor-Paradies der Region — wild, grün und angenehm unaufgeregt.',
      'Unsere Apartments im Sauertal sind der perfekte Ausgangspunkt: Teufelsschlucht und Irreler Wasserfälle in Wanderdistanz, der Sauertal-Radweg direkt am Haus, und für den Abstecher ins Nachbarland liegen Echternach und das Müllerthal — die „Kleine Luxemburger Schweiz" — nur ein paar Minuten entfernt.',
    ],
    highlights: [
      { emoji: '🪨', title: 'Teufelsschlucht', text: 'Spektakuläre Felsenschlucht mit Wanderwegen zwischen meterhohen Sandsteinwänden.' },
      { emoji: '🥾', title: 'Müllerthal Trail', text: 'Luxemburgs Premium-Wanderweg durch die „Kleine Luxemburger Schweiz" — direkt drüben.' },
      { emoji: '🚴', title: 'Sauertal-Radweg', text: 'Flach, autofrei und grenzüberschreitend — an der Sauer entlang bis zur Mosel.' },
      { emoji: '🦕', title: 'Dinopark', text: 'Über 100 lebensgroße Urzeit-Modelle plus Forscherpfade — das Familien-Highlight.' },
    ],
    comingSoon: {
      title: 'Bald neu: dritte Wohnung in Minden an der Sauer',
      text: 'Unsere kleine TRIMOSA-Familie im Sauertal wächst — aktuell entsteht in Minden die dritte Ferienwohnung. Sunrise Suite und Panorama Home bekommen Verstärkung.',
    },
    pois: [
      {
        slug: 'teufelsschlucht', name: 'Teufelsschlucht', category: 'aktiv', lat: 49.8283, lon: 6.4443, emoji: '🪨',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/23/Teufelsschlucht_%28Eifel%29.jpg/1280px-Teufelsschlucht_%28Eifel%29.jpg',
          author: 'Euku',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Teufelsschlucht_(Eifel).jpg',
        },
        text: 'Enge Felsenschlucht mit Rundwegen — eines der Naturwunder der Eifel.',
        long: [
          'Am Ende der letzten Eiszeit brachen hier gewaltige Sandsteinpakete auseinander — zurück blieb ein Labyrinth aus meterhohen Felswänden, engen Spalten und moosgrünen Treppenpfaden. Die Teufelsschlucht bei Ernzen ist das Naturwunder der Südeifel.',
          'Vom Naturparkzentrum führen Rundwege verschiedener Längen durch die Schlucht und über die Felsplateaus — inklusive Aussichtskanzel über das Sauertal. Festes Schuhwerk mitbringen; direkt nebenan liegt der Dinosaurierpark für den Familien-Kombitag.',
        ],
      },
      {
        slug: 'dinopark-teufelsschlucht', name: 'Dinosaurierpark Teufelsschlucht', category: 'familie', lat: 49.8281, lon: 6.439, emoji: '🦕',
        text: 'Lebensgroße Dino-Modelle, Forscherpfad und Fossilien-Werkstatt.',
        long: [
          'Über 170 lebensgroße Modelle säumen den Rundweg durch den Wald — vom handtaschengroßen Urvogel bis zum haushohen T-Rex, wissenschaftlich fundiert und immer wieder aktualisiert. Der Dinosaurierpark an der Teufelsschlucht ist das Familienziel der Südeifel.',
          'Im Forscher-Camp legen Kinder eigene Fossilien frei, die Ausgrabungsstellen und Mitmachstationen machen aus dem Spaziergang eine Expedition. Kombiniert den Besuch mit der benachbarten Teufelsschlucht — beide teilen sich den Parkplatz.',
        ],
      },
      {
        slug: 'irreler-wasserfaelle', name: 'Irreler Wasserfälle', category: 'aktiv', lat: 49.8422, lon: 6.455, emoji: '🌊',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Irrel_Wasserf%C3%A4lle_19%2B_Erle.jpg/1280px-Irrel_Wasserf%C3%A4lle_19%2B_Erle.jpg',
          author: 'Michael Fiegle',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Irrel_Wasserf%C3%A4lle_19%2B_Erle.jpg',
        },
        text: 'Stromschnellen der Prüm mit spektakulärer Hängebrücke.',
        long: [
          'Zwischen mächtigen Felsblöcken schießt die Prüm bei Irrel durch eine enge Rinne — die „Wasserfälle" sind eigentlich wilde Stromschnellen, seit 2021 überspannt von einer schwungvollen Hängebrücke, die das Naturschauspiel von oben zeigt.',
          'Der Zugang ist kurz und familientauglich, die Brücke kostenlos begehbar. Wer mehr will: Von hier führen Wanderwege flussauf zur Teufelsschlucht — eine der schönsten Halbtagestouren der Südeifel.',
        ],
      },
      {
        slug: 'echternach', name: 'Echternach (Luxemburg)', category: 'sehenswert', lat: 49.8117, lon: 6.4219, emoji: '⛪',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Echternach_St_Willibrord_Basilika_R01.jpg/1280px-Echternach_St_Willibrord_Basilika_R01.jpg',
          author: 'Marc Ryckaert',
          license: 'CC BY 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Echternach_St_Willibrord_Basilika_R01.jpg',
        },
        text: 'Älteste Stadt Luxemburgs: Benediktinerabtei, Marktplatz und Seenpark.',
        long: [
          'Nur über die Sauerbrücke, und ihr seid in Luxemburgs ältester Stadt: Echternach wuchs um die Benediktinerabtei des heiligen Willibrord, dessen Basilika noch heute das Stadtbild prägt. Die berühmte Springprozession ist UNESCO-Kulturerbe.',
          'Der Marktplatz mit dem gotischen Dënzelt lädt zum Café-Stopp, der Echternacher See mit Rundweg und Spielplätzen zur Familienrunde. Und: In Luxemburg tanken ist meist günstiger — der klassische Grenzbonus.',
        ],
      },
      {
        slug: 'muellerthal-trail', name: 'Müllerthal Trail', category: 'aktiv', lat: 49.7935, lon: 6.3559, emoji: '🥾',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Berdorf_%28LU%29%2C_Hohllay_--_2015_--_6097-101.jpg/1280px-Berdorf_%28LU%29%2C_Hohllay_--_2015_--_6097-101.jpg',
          author: 'Dietmar Rabich',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Berdorf_(LU),_Hohllay_--_2015_--_6097-101.jpg',
        },
        text: 'Luxemburgs Premium-Fernwanderweg durch die „Kleine Luxemburger Schweiz".',
        long: [
          'Der Müllerthal Trail gehört zu den besten Wanderwegen Europas („Leading Quality Trail"): 112 Kilometer in drei Routen durch die Felsenlandschaft der „Kleinen Luxemburger Schweiz" — Schluchten, Bachtäler, Burgen und immer wieder spektakuläre Sandsteinformationen.',
          'Von unseren Apartments im Sauertal erreicht ihr die Einstiege bei Echternach und Berdorf in wenigen Minuten. Für den Anfang perfekt: die Etappe rund um Berdorf mit Werschrumschluff und Predigtstuhl — enge Felsspalten inklusive.',
        ],
      },
      {
        slug: 'schiessentuempel', name: 'Schiessentümpel', category: 'sehenswert', lat: 49.7847, lon: 6.3399, emoji: '📸',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Waldbillig_%28LU%29%2C_Schiessent%C3%BCmpel_--_2015_--_6033.jpg/1280px-Waldbillig_%28LU%29%2C_Schiessent%C3%BCmpel_--_2015_--_6033.jpg',
          author: 'Dietmar Rabich',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Waldbillig_(LU),_Schiessent%C3%BCmpel_--_2015_--_6033.jpg',
        },
        text: 'Der berühmteste Wasserfall Luxemburgs — dreifacher Fall unter steinerner Bogenbrücke.',
        long: [
          'Kein Motiv der Region wird öfter fotografiert: Am Schiessentümpel stürzt die Schwarze Ernz in drei Strängen unter einer moosbewachsenen Steinbrücke hindurch — ein Bild wie aus dem Märchenbuch, besonders nach Regen und im Herbstlaub.',
          'Der Wasserfall liegt direkt am Müllerthal Trail; vom Parkplatz an der Straße sind es nur wenige Minuten zu Fuß. Früh morgens gehört der Platz euch allein — und das Licht ist am schönsten.',
        ],
      },
      {
        slug: 'burg-vianden', name: 'Burg Vianden', category: 'sehenswert', lat: 49.935, lon: 6.2019, emoji: '🏰',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Burg_Vianden_2009.jpg/1280px-Burg_Vianden_2009.jpg',
          author: 'Roland Struwe, uploader was Sneecs at de.wikipedia',
          license: 'CC BY-SA 3.0 de',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/de/deed.en',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Burg_Vianden_2009.jpg',
        },
        text: 'Eine der größten Burganlagen westlich des Rheins — hoch über dem Ourtal.',
        long: [
          'Auf einem Bergsporn über der Our thront Burg Vianden — zwischen dem 11. und 14. Jahrhundert erbaut und heute komplett restauriert eine der eindrucksvollsten Burganlagen Europas. Rittersaal, Kapelle und Waffenkammer machen den Rundgang zur Zeitreise.',
          'Victor Hugo verliebte sich einst in das Städtchen darunter; sein Wohnhaus ist heute Museum. Im Sommer bringt euch ein Sessellift auf den Gegenhang — mit dem besten Blick auf Burg und Tal. Von der Südeifel eine gute halbe Stunde.',
        ],
      },
      {
        slug: 'sauertal-radweg', name: 'Sauertal-Radweg', category: 'aktiv', lat: 49.8519, lon: 6.3592, emoji: '🚴',
        komootTours: [
          { title: 'Sauerblick & Echternacher Grenzbrücke — Runde ab Minden (17,3 km · ~1:10 h)', embedUrl: 'https://www.komoot.com/de-de/smarttour/43179735/embed?profile=1' },
          { title: 'Ralinger Tunnel & Echternacher See — Runde ab Echternach (23 km · ~1:25 h)', embedUrl: 'https://www.komoot.com/de-de/smarttour/43160850/embed?profile=1' },
        ],
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Sauertalradweg_near_Wintersdorf_2011.JPG/1280px-Sauertalradweg_near_Wintersdorf_2011.JPG',
          author: 'Cobatfor',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Sauertalradweg_near_Wintersdorf_2011.JPG',
        },
        text: 'Flacher Flussradweg entlang der deutsch-luxemburgischen Grenze.',
        long: [
          'Immer an der Sauer entlang, mal auf deutscher, mal auf luxemburgischer Seite: Der Sauertal-Radweg verbindet die Eifel mit der Mosel — flach, überwiegend autofrei und mit Brücken, die zum Seitenwechsel einladen.',
          'Von Bollendorf und Echternacherbrück rollt ihr flussabwärts über Rosport bis zur Mündung bei Wasserbillig; dort trifft der Weg auf den Mosel-Radweg Richtung Trier. Einkehrmöglichkeiten liegen wie Perlen an der Strecke.',
        ],
      },
      {
        slug: 'kajak-sauer', name: 'Kajak auf der Sauer', category: 'familie', lat: 49.848, lon: 6.39, emoji: '🛶',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1c/Bridge_across_Sauer-S%C3%BBre_btw_Bollendorf_-_Bollendorf-Pont.jpg/1280px-Bridge_across_Sauer-S%C3%BBre_btw_Bollendorf_-_Bollendorf-Pont.jpg',
          author: 'Zinneke',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Bridge_across_Sauer-S%C3%BBre_btw_Bollendorf_-_Bollendorf-Pont.jpg',
        },
        text: 'Kanu- und Kajaktouren auf der Sauer — Verleih in Bollendorf und Echternacherbrück.',
        long: [
          'Die Sauer ist ein ideales Einsteiger-Paddelrevier: ruhiges Wasser, grüne Ufer und kleine Kiesbänke für die Pause. Die Verleihstationen in Bollendorf und Echternacherbrück bringen euch samt Boot zum Einstieg — zurück geht es flussabwärts wie von selbst.',
          'Die klassische Halbtagestour endet in Echternacherbrück; sportliche paddeln weiter Richtung Rosport. Schwimmwesten gibt es für alle Größen — auch mit Kindern gut machbar.',
        ],
      },
      {
        slug: 'schloss-weilerbach', name: 'Schloss Weilerbach', category: 'sehenswert', lat: 49.839, lon: 6.399, emoji: '🏰',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Weilerbach_schloss_pavillon.jpg/1280px-Weilerbach_schloss_pavillon.jpg',
          author: 'Palauenc05',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Weilerbach_schloss_pavillon.jpg',
        },
        text: 'Barockes Rokoko-Schloss mit Park an der Sauer.',
        long: [
          'Zwischen Bollendorf und Echternacherbrück liegt das Rokoko-Schlösschen Weilerbach — im 18. Jahrhundert als Sommerresidenz der Echternacher Äbte erbaut, mit französischem Garten und einer markanten Eisenhütte nebenan, die einst Öfen für halb Europa goss.',
          'Heute ist das Ensemble ein stiller Kulturort mit wechselnden Ausstellungen; der Park ist frei zugänglich. Direkt am Sauertal-Radweg — ideal für die Kultur-Pause zwischen zwei Etappen.',
        ],
      },
    ],
    center: [49.832, 6.415],
    zoom: 12,
    locationMatch: 'Südeifel',
    kulinarik: [
      {
        emoji: '🏰', name: 'Schloss Niederweis', art: 'Schloss-Restaurant', ort: 'Niederweis',
        kategorie: 'fein', lat: 49.8702, lon: 6.4653, googleQuery: 'Schloss Niederweis Restaurant', googlePlaceId: 'ChIJ54gOmrDfv0cRzs6524w9hXI',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/Schloss_Niederweis_01.jpg/1280px-Schloss_Niederweis_01.jpg',
          author: 'Thomas Hummel',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Schloss_Niederweis_01.jpg',
        },
        text: 'Gehobene Landküche in den historischen Sälen des barocken Schlosses — auf halbem Weg zwischen Bitburg und der Teufelsschlucht.',
      },
      {
        emoji: '🍗', name: 'Landgasthaus zum Klimmes', art: 'Flieten-Kult', ort: 'Wintersdorf, Sauertal',
        kategorie: 'gasthaus', lat: 49.7876, lon: 6.5094, top: true, googleQuery: 'Landgasthaus zum Klimmes Wintersdorf', googlePlaceId: 'ChIJeVfyVXxhlUcRKFTtW9hr72g',
        text: 'Berühmt für seine Flieten — die knusprigen Hähnchenflügel, die man mit den Fingern isst. Dazu Viez aus eigener Kelterei: Trierer Land-Kultur pur.',
      },
      {
        emoji: '🐟', name: 'Gasthaus Ferring', art: 'Eifeler Gasthaus & Biergarten', ort: 'Minden an der Sauer',
        kategorie: 'gasthaus', lat: 49.8238, lon: 6.4685, googleQuery: 'Gasthaus Ferring Minden Sauer',
        googlePlaceId: 'ChIJhS_BZTNglUcRxG2HHHzXupo',
        text: 'Familiengeführtes Gasthaus dort, wo die Prüm in die Sauer mündet — regionale Küche mit frischer Mindener Forelle, dazu Biergarten und Terrasse.',
      },
      {
        emoji: '🌉', name: 'Ralinger Hof', art: 'Gasthaus an der Sauerbrücke', ort: 'Ralingen an der Sauer',
        kategorie: 'gasthaus', lat: 49.8057, lon: 6.5098, googleQuery: 'Ralinger Hof Ralingen',
        googlePlaceId: 'ChIJU0BrWY9hlUcRX9tqUTA8sdc',
        text: 'Klassisches Gasthaus direkt an der Brücke über die Sauer — bodenständige Küche im Grenzort, auf der anderen Flussseite beginnt Luxemburg.',
      },
      {
        emoji: '🇫🇷', name: 'Le Petit Poète', art: 'Bistro am Marktplatz', ort: 'Echternach (LU)',
        kategorie: 'gasthaus', lat: 49.8126, lon: 6.4208, top: true, googleQuery: 'Le Petit Poète Echternach', googlePlaceId: 'ChIJCcIGrHdglUcRYHW1DZd8FlY',
        text: 'Kleiner Klassiker direkt am Marktplatz der Abteistadt — französisch geprägte Karte und eine der beliebtesten Terrassen der Stadt.',
      },
      {
        emoji: '🍽️', name: 'Aal Eechternoach', art: 'Luxemburgisch-französisch', ort: 'Echternach (LU)',
        kategorie: 'gasthaus', lat: 49.8129, lon: 6.4203, googleQuery: 'Aal Eechternoach Echternach', googlePlaceId: 'ChIJ2a-W3TJelUcRDbvpBD51QhM',
        text: 'Vom deftigen Klassiker bis zum feinen Fischgericht — luxemburgisch-französische Küche mit gutem Ruf bei Einheimischen wie Gästen.',
      },
      {
        emoji: '🥾', name: 'Teufels Küche', art: 'Wander-Einkehr', ort: 'An der Teufelsschlucht, Ernzen',
        kategorie: 'cafe', lat: 49.8283, lon: 6.4443, googleQuery: 'Teufels Küche Teufelsschlucht Ernzen',
        text: 'Stärkung direkt am Schluchteingang: Snacks, Kuchen und kalte Getränke — perfekt vor oder nach der Tour durch die Felsen.',
      },
      {
        emoji: '🍕', name: 'Pizzeria Da Toni', art: 'Italiener in Irrel', ort: 'Irrel',
        kategorie: 'gasthaus', lat: 49.8421, lon: 6.4573, googleQuery: 'Pizzeria Da Toni Irrel',
        googlePlaceId: 'ChIJp5_Qsovfv0cRAYKv_lzAwZI',
        text: 'Italienischer Familienklassiker mitten in Irrel — Pizza und Pasta, wie gemacht für den Abend nach einer Tour durch die nahe Teufelsschlucht.',
      },
      {
        emoji: '🐟', name: 'Gasthäuser im Sauertal', art: 'Regionalküche', ort: 'Bollendorf & Umgebung',
        kategorie: 'gasthaus', lat: 49.8531, lon: 6.3583,
        text: 'Forelle, Wild und Eifeler Klassiker — bodenständige Küche in den Gasthäusern entlang der Sauer, oft mit Biergarten am Fluss.',
      },
      {
        emoji: '🇱🇺', name: 'Luxemburger Küche in Vianden', art: 'Über der Grenze', ort: 'Vianden (LU)',
        kategorie: 'gasthaus', lat: 49.9339, lon: 6.2033,
        text: 'Judd mat Gaardebounen, Gromperekichelcher oder ein Glas Crémant — unterhalb der Burg reihen sich Lokale mit luxemburgischer Tradition.',
      },
    ],
    heroSlugs: ['schiessentuempel', 'teufelsschlucht', 'burg-vianden'],
    komootTours: [
      { title: 'Sauerblick & Echternacher Grenzbrücke — Runde ab Minden (17,3 km · ~1:10 h)', embedUrl: 'https://www.komoot.com/de-de/smarttour/43179735/embed?profile=1' },
      { title: 'Ralinger Tunnel & Echternacher See — Runde ab Echternach (23 km · ~1:25 h)', embedUrl: 'https://www.komoot.com/de-de/smarttour/43160850/embed?profile=1' },
    ],
  },

  saar: {
    slug: 'saar',
    name: 'Saartal & Saarburg',
    emoji: '🍇',
    claim: 'Steile Reben, die Saarschleife und großes Riesling-Terroir',
    metaTitle: 'Ferienwohnungen an der Saar — Kanzem & Saarburg',
    metaDescription:
      'Bald neu: TRIMOSA-Ferienwohnungen in Kanzem an der Saar — im denkmalgeschützten ehemaligen Weingut. Saarschleife, Saarburg und Weinkultur vor der Tür.',
    intro: [
      'Die Saar zwischen Konz und Serrig ist Deutschlands vielleicht unterschätzteste Weinlandschaft: An ihren Schieferhängen wachsen Rieslinge von Weltruf — die Lagen um Kanzem, Wiltingen und Ayl stehen auf den Karten der besten Sommeliers.',
      'Mittendrin: Kanzem, ein Winzerdorf am Fuß des berühmten Altenbergs. Hier entstehen gerade unsere neuen Apartments — im ältesten Gebäude des Ortes, einem denkmalgeschützten ehemaligen Weingut, das wir behutsam kernsanieren. Saarburg mit seinem Wasserfall mitten in der Stadt und die große Saarschleife bei Mettlach liegen gleich um die Ecke.',
    ],
    highlights: [
      { emoji: '🌊', title: 'Saarschleife', text: 'Der ikonische Flussbogen bei Mettlach — vom Cloef-Aussichtspunkt oder Baumwipfelpfad.' },
      { emoji: '🏰', title: 'Saarburg', text: 'Altstadt mit 18-Meter-Wasserfall mitten im Zentrum und Burgruine darüber.' },
      { emoji: '🍇', title: 'Riesling-Terroir', text: 'Kanzemer Altenberg & Wiltinger Lagen — Steillagen-Weine von Weltruf.' },
      { emoji: '🚴', title: 'Saar-Radweg', text: 'Flussradweg von der Mündung bei Konz durchs Weintal Richtung Saarland.' },
    ],
    comingSoon: {
      title: 'Bald neu: 4 Apartments im alten Weingut Kanzem',
      text: 'Im ältesten Gebäude der Region — einem denkmalgeschützten ehemaligen Weingut — entstehen aktuell vier neue TRIMOSA-Ferienwohnungen: kernsaniert, mit Respekt vor der historischen Substanz und Blick auf die Weinberge. Eröffnung wird hier und auf unseren Kanälen angekündigt.',
    },
    pois: [
      {
        slug: 'saarschleife', name: 'Saarschleife & Cloef', category: 'sehenswert', lat: 49.4986, lon: 6.5433, emoji: '🌊',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/2021.07_-_Saarschleife.jpg/1280px-2021.07_-_Saarschleife.jpg',
          author: 'Akveniam',
          license: 'CC0',
          licenseUrl: 'http://creativecommons.org/publicdomain/zero/1.0/deed.en',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:2021.07_-_Saarschleife.jpg',
        },
        text: 'Der berühmteste Flussbogen Deutschlands — Aussichtspunkt Cloef und Baumwipfelpfad.',
        long: [
          'Bei Mettlach legt sich die Saar in eine fast vollständige Schleife um den bewaldeten Umlaufberg — eines der bekanntesten Naturpanoramen Deutschlands. Der klassische Blick öffnet sich vom Aussichtspunkt Cloef in Orscholz, 180 Meter über dem Fluss.',
          'Noch spektakulärer: der Baumwipfelpfad, der in Wipfelhöhe zum 42 Meter hohen Aussichtsturm hinaufführt — mit Rundumblick über Schleife, Hunsrück und bei klarem Wetter bis weit ins Lothringische. Unten lohnt eine Runde mit dem Ausflugsschiff.',
        ],
      },
      {
        slug: 'saarburg', name: 'Saarburg', category: 'sehenswert', lat: 49.6067, lon: 6.5439, emoji: '🏰',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Wasserfall_in_Saarburg.jpg/1280px-Wasserfall_in_Saarburg.jpg',
          author: 'Europan Press',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Wasserfall_in_Saarburg.jpg',
        },
        text: 'Altstadt mit 18-Meter-Wasserfall mitten im Zentrum — das „kleine Venedig" der Saar.',
        long: [
          'Mitten durch Saarburgs Altstadt stürzt der Leukbach 18 Meter in die Tiefe — ein Wasserfall im Stadtzentrum, gesäumt von Fachwerkhäusern und alten Mühlen. Darüber wacht die Burgruine aus dem 10. Jahrhundert, deren Turm den besten Blick übers Saartal bietet.',
          'Die Gassen am Buttermarkt laden zum Bummeln, im Amüseum am Wasserfall dreht sich alles um die Stadtgeschichte. Im Sommer schwebt ihr mit der Sesselbahn auf den Warsberg — Panorama inklusive.',
        ],
      },
      {
        slug: 'kanzemer-altenberg', name: 'Kanzemer Altenberg', category: 'aktiv', lat: 49.663, lon: 6.578, emoji: '🍇',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Altarm_der_Saar_am_Wiltinger_Saarbogen_mit_Blick_auf_Kanzem.jpg/1280px-Altarm_der_Saar_am_Wiltinger_Saarbogen_mit_Blick_auf_Kanzem.jpg',
          author: 'Dorothea Witter-Rieder',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Altarm_der_Saar_am_Wiltinger_Saarbogen_mit_Blick_auf_Kanzem.jpg',
        },
        text: 'Eine der großen Riesling-Steillagen Deutschlands — direkt über unserem neuen Standort.',
        long: [
          'Der Altenberg erhebt sich als steile Schieferwand direkt über Kanzem — eine „Große Lage" des VDP und seit Generationen Quelle einiger der feinsten Rieslinge Deutschlands: mineralisch, langlebig, unverwechselbar.',
          'Wanderwege führen durch die Reben hinauf, oben belohnt der Blick über das Saartal. Danach lohnt die Einkehr bei den Winzern des Orts — von hier stammen Weine, die auf den Karten internationaler Spitzenrestaurants stehen. Unsere neuen Apartments liegen in Sichtweite der Lage.',
        ],
      },
      {
        slug: 'saar-radweg', name: 'Saar-Radweg', category: 'aktiv', lat: 49.6608, lon: 6.5836, emoji: '🚴',
        komootTours: [
          { title: 'Schleuse Kanzem & Stauwehr Schoden — Runde ab Saarburg (21,4 km · ~1:20 h)', embedUrl: 'https://www.komoot.com/de-de/smarttour/39581518/embed?profile=1' },
          { title: 'Stauwehr Schoden & Saar-Altarm — Runde ab Saarburg (23,4 km · ~1:30 h)', embedUrl: 'https://www.komoot.com/de-de/smarttour/43192448/embed?profile=1' },
        ],
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/42/Schoden%2C_wijnbouw_bij_de_Stauwehr_foto7_2017-05-29_12.44.jpg/1280px-Schoden%2C_wijnbouw_bij_de_Stauwehr_foto7_2017-05-29_12.44.jpg',
          author: 'Michielverbeek',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Schoden,_wijnbouw_bij_de_Stauwehr_foto7_2017-05-29_12.44.jpg',
        },
        text: 'Flussradweg durchs Weintal — von Konz über Kanzem und Saarburg Richtung Mettlach.',
        long: [
          'Der Saar-Radweg begleitet den Fluss von der Mündung bei Konz durch das Weintal nach Saarburg und weiter Richtung Saarschleife — flach, gut ausgebaut und mit stetig wechselnden Kulissen aus Steillagen, Leinpfaden und Schleusen.',
          'Ab Kanzem seid ihr in einer knappen halben Stunde in Saarburg; sportliche fahren weiter bis Mettlach und nehmen für die Rückfahrt die Bahn. Unterwegs locken Straußwirtschaften direkt an der Strecke.',
        ],
      },
      {
        slug: 'kanu-saar', name: 'Kanu & SUP auf der Saar', category: 'aktiv', lat: 49.6106, lon: 6.5521, emoji: '🛶',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Saarburg%2C_Saar_--_2023_--_174144.jpg/1280px-Saarburg%2C_Saar_--_2023_--_174144.jpg',
          author: 'Dietmar Rabich',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Saarburg,_Saar_--_2023_--_174144.jpg',
        },
        text: 'Paddeln zwischen Weinbergen — der ruhige Flussabschnitt um Saarburg ist ideal für Kanu, Kajak und SUP.',
        long: [
          'Zwischen Serrig, Saarburg und Kanzem fließt die Saar ruhig und breit durch das Weintal — beste Bedingungen für Kanu, Kajak und Stand-up-Paddling, auch für Einsteiger und Familien. Verleihstationen in und um Saarburg bringen euch aufs Wasser; von dort gleitet ihr vorbei an Steillagen, Leinpfaden und alten Schleusen.',
          'Vom Wasser aus zeigt sich das Tal von seiner schönsten Seite: Weinberge spiegeln sich im Fluss, Reiher stehen am Ufer — und in Saarburg lässt sich die Tour mit einem Eis oder einem Glas Riesling am Ufer beschließen. Wer mehr will, kombiniert die Paddelstrecke mit dem Saar-Radweg zu einer Rundtour.',
        ],
      },
      {
        slug: 'konz-saarmuendung', name: 'Saar-Mosel-Eck Konz', category: 'aktiv', lat: 49.7005, lon: 6.5793, emoji: '🌉',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f3/Konz_-_Saarm%C3%BCndung.jpg/1280px-Konz_-_Saarm%C3%BCndung.jpg',
          author: 'Franzfoto',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:Konz_-_Saarm%C3%BCndung.jpg',
        },
        text: 'Wo die Saar in die Mosel mündet — Knotenpunkt der großen Flussradwege.',
        long: [
          'In Konz endet die Saar — am Saar-Mosel-Eck fließt sie in die Mosel, und drei große Radwege treffen aufeinander: Saar-Radweg, Mosel-Radweg und die Route nach Luxemburg. Das Denkmal am Zusammenfluss ist beliebter Foto-Stopp.',
          'Sehenswert nebenan: das Freilichtmuseum Roscheider Hof, das mit historischen Häusern, Gärten und Spielscheune das Landleben vergangener Jahrhunderte zeigt — der heimliche Familientipp der Ecke.',
        ],
      },
      {
        slug: 'sesselbahn-saarburg', name: 'Sesselbahn Saarburg', category: 'familie', lat: 49.6119, lon: 6.5389, emoji: '🚡',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/20180520Saarburg_07.jpg/1280px-20180520Saarburg_07.jpg',
          author: 'Flocci Nivis',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:20180520Saarburg_07.jpg',
        },
        text: 'Mit dem Sessellift auf den Warsberg — Panoramablick und Greifvogelschau.',
        long: [
          'Gemächlich schwebt die Sesselbahn von Saarburg auf den Warsberg — unter euch Weinberge, vor euch das Saartal. Oben warten Panoramaterrasse, Spielplatz und der Greifvogelpark, dessen Flugvorführungen mit Adlern und Falken der Höhepunkt für Kinder sind.',
          'Wer mag, wandert über den Weinlehrpfad zurück in die Stadt. Die Kombination aus Bahnfahrt, Vögeln und Wasserfall macht Saarburg zum runden Familien-Halbtag.',
        ],
      },
      {
        slug: 'villa-borg', name: 'Römische Villa Borg', category: 'familie', lat: 49.5106, lon: 6.4536, emoji: '🏛️',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/R%C3%B6mische_Villa_Borg.jpg/1280px-R%C3%B6mische_Villa_Borg.jpg',
          author: '© Alexander Spät',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'http://creativecommons.org/licenses/by-sa/3.0/',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:R%C3%B6mische_Villa_Borg.jpg',
        },
        text: 'Komplett rekonstruierte römische Villa — mit Bad, Küche und Gärten zum Anfassen.',
        long: [
          'Einzigartig in Europa: In Borg wurde eine komplette römische Villenanlage originalgetreu wieder aufgebaut — Herrenhaus, Badetrakt, Taverne und Gärten stehen begehbar da, wie vor 1.800 Jahren.',
          'Anders als in Museen darf hier erlebt werden: Römische Küche in der Taverne, Thermen mit echtem Wasser, Mitmach-Aktionen für Kinder. Von Kanzem eine gute halbe Stunde — und der perfekte Kontrast zum Trierer Welterbe.',
        ],
      },
      {
        slug: 'tempelanlage-tawern', name: 'Tempelanlage Tawern', category: 'sehenswert', lat: 49.6689, lon: 6.5197, emoji: '⚱️',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/R%C3%B6mische_Tempelanlage_bei_Tawern_im_Hunsr%C3%BCck.jpg/1280px-R%C3%B6mische_Tempelanlage_bei_Tawern_im_Hunsr%C3%BCck.jpg',
          author: 'Viola sonans',
          license: 'CC BY-SA 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:R%C3%B6mische_Tempelanlage_bei_Tawern_im_Hunsr%C3%BCck.jpg',
        },
        text: 'Rekonstruierter römischer Tempelbezirk auf dem Metzenberg mit Blick ins Tal.',
        long: [
          'Über dem Ort Tawern liegt auf dem Metzenberg ein rekonstruierter gallo-römischer Tempelbezirk: Einst grüßten Reisende auf der Fernstraße von Metz nach Trier hier den Götterboten Merkur, bevor sie die letzte Etappe zur Metropole antraten.',
          'Der kurze Aufstieg vom Ort lohnt doppelt — für die Anlage selbst und den Blick über das Tal. In Kombination mit Villa Borg und Igeler Säule ergibt sich eine kleine Römer-Route abseits der Trierer Klassiker.',
        ],
      },
    ],
    center: [49.635, 6.55],
    zoom: 11,
    locationMatch: 'Saar',
    kulinarik: [
      {
        emoji: '✨', name: 'Villa Keller', art: 'Gourmet-Restaurant', ort: 'Brückenstraße, Saarburg',
        kategorie: 'fein', lat: 49.6085, lon: 6.5578, top: true, googleQuery: 'Villa Keller Saarburg Restaurant', googlePlaceId: 'ChIJU03fZz1ulUcRNlxPw8tOl7k',
        text: 'Saarburgs erste Adresse: feine Küche in der historischen Villa direkt an der Saar — stilvoll vom Aperitif bis zum Dessert.',
      },
      {
        emoji: '🍷', name: 'Weingut Van Volxem', art: 'Weingut & Vinothek', ort: 'Wiltingen',
        kategorie: 'wein', lat: 49.6427, lon: 6.5788, top: true, googleQuery: 'Weingut Van Volxem Wiltingen', googlePlaceId: 'ChIJEQrBEwNwlUcRBfVRrgI2jpU',
        text: 'Saar-Riesling von Weltruf: Die moderne Vinothek hoch über den Weinbergen gehört zu den eindrucksvollsten Genuss-Adressen der Region.',
      },
      {
        emoji: '🍇', name: 'Weingut von Othegraven', art: 'VDP-Weingut', ort: 'Kanzem',
        kategorie: 'wein', lat: 49.6707, lon: 6.5781, googleQuery: 'Weingut von Othegraven Kanzem', googlePlaceId: 'ChIJ31tyV1ZllUcR92KkIVckOgY',
        image: {
          src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/20170830_Weingut_von_Othegraven_05.jpg/1280px-20170830_Weingut_von_Othegraven_05.jpg',
          author: 'Bungert55',
          license: 'CC BY-SA 3.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
          fileUrl: 'https://commons.wikimedia.org/wiki/File:20170830_Weingut_von_Othegraven_05.jpg',
        },
        text: 'Traditionsgut direkt am Kanzemer Altenberg mit historischem Park — seit 2010 im Besitz von Günther Jauch.',
      },
      {
        emoji: '🛏️', name: 'Weinhotel Ayler Kupp', art: 'Weinrestaurant', ort: 'Ayl',
        kategorie: 'wein', lat: 49.6291, lon: 6.5536, googleQuery: 'Weinhotel Ayler Kupp Ayl', googlePlaceId: 'ChIJI1PkKzVulUcROQ3GFVmByHo',
        text: 'Restaurant und Weinhotel am Fuß der berühmten Lage Ayler Kupp — saisonale Küche, begleitet von den besten Rieslingen des Dorfs.',
      },
      {
        emoji: '🥂', name: 'Weinstuben in Saarburg', art: 'Altstadt-Genuss', ort: 'Buttermarkt, Saarburg',
        kategorie: 'wein', lat: 49.6081, lon: 6.5504,
        text: 'Rund um den Wasserfall mitten in der Altstadt reihen sich Weinstuben und Cafés — ideal für einen Riesling nach dem Stadtbummel.',
      },
    ],
    heroSlugs: ['saarschleife', 'saarburg', 'kanzemer-altenberg'],
    komootTours: [
      { title: 'Schleuse Kanzem & Stauwehr Schoden — Runde ab Saarburg (21,4 km · ~1:20 h)', embedUrl: 'https://www.komoot.com/de-de/smarttour/39581518/embed?profile=1' },
      { title: 'Stauwehr Schoden & Saar-Altarm — Runde ab Saarburg (23,4 km · ~1:30 h)', embedUrl: 'https://www.komoot.com/de-de/smarttour/43192448/embed?profile=1' },
    ],
  },
}

/** Find a POI by its slug across all regions. */
export function findPoi(slug: string): { region: Region; poi: Poi } | null {
  for (const region of Object.values(REGIONS)) {
    const poi = region.pois.find((p) => p.slug === slug)
    if (poi) return { region, poi }
  }
  return null
}

/** All POIs with their region, e.g. for generateStaticParams / sitemap. */
export function allPois(): { region: Region; poi: Poi }[] {
  return Object.values(REGIONS).flatMap((region) => region.pois.map((poi) => ({ region, poi })))
}

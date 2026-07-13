/**
 * Curated content for the region landing pages (/region/[slug]).
 * POI coordinates are approximate map positions for well-known destinations.
 */

export type PoiCategory = 'sehenswert' | 'aktiv' | 'familie'

export interface Poi {
  name: string
  category: PoiCategory
  lat: number
  lon: number
  emoji: string
  text: string
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
      { name: 'Porta Nigra', category: 'sehenswert', lat: 49.7596, lon: 6.6439, emoji: '🏛️', text: 'Das besterhaltene römische Stadttor nördlich der Alpen — Wahrzeichen Triers und UNESCO-Welterbe.' },
      { name: 'Trierer Dom', category: 'sehenswert', lat: 49.7566, lon: 6.6431, emoji: '⛪', text: 'Deutschlands älteste Bischofskirche, direkt neben der gotischen Liebfrauenkirche.' },
      { name: 'Hauptmarkt', category: 'sehenswert', lat: 49.7573, lon: 6.6413, emoji: '⛲', text: 'Einer der schönsten Marktplätze Deutschlands — Cafés, Marktstände, Fachwerk.' },
      { name: 'Kaiserthermen', category: 'sehenswert', lat: 49.7519, lon: 6.6488, emoji: '🏺', text: 'Römische Badruinen mit begehbaren unterirdischen Gängen.' },
      { name: 'Amphitheater', category: 'sehenswert', lat: 49.7481, lon: 6.6543, emoji: '🎭', text: 'Römische Arena für 20.000 Zuschauer — im Sommer Kulisse für Festspiele.' },
      { name: 'Mosel-Radweg (Zurlaubener Ufer)', category: 'aktiv', lat: 49.7669, lon: 6.6277, emoji: '🚴', text: 'Einstieg in den Mosel-Radweg am alten Fischerviertel mit Biergärten am Wasser.' },
      { name: 'Weinlage Olewig', category: 'aktiv', lat: 49.742, lon: 6.665, emoji: '🍷', text: 'Weingüter, Straußwirtschaften und Weinlehrpfad am Stadtrand.' },
      { name: 'Ruwer-Hochwald-Radweg', category: 'aktiv', lat: 49.753, lon: 6.705, emoji: '🚵', text: 'Autofreier Bahntrassen-Radweg von der Mosel bis in den Hunsrück.' },
      { name: 'Freibad & Stadtwald Weisshauswald', category: 'familie', lat: 49.7455, lon: 6.6122, emoji: '🌳', text: 'Wildgehege, Spielplätze und Waldwege hoch über der Stadt.' },
    ],
    center: [49.756, 6.641],
    zoom: 13,
    locationMatch: 'Trier',
  },

  bitburg: {
    slug: 'bitburg',
    name: 'Bitburg',
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
      { name: 'Bitburger Marken-Erlebniswelt', category: 'sehenswert', lat: 49.9664, lon: 6.5227, emoji: '🍺', text: 'Interaktive Brauerei-Erlebniswelt mit Verkostung — das Aushängeschild der Stadt.' },
      { name: 'Fußgängerzone & Bedaplatz', category: 'sehenswert', lat: 49.9736, lon: 6.5253, emoji: '🛍️', text: 'Gemütliche Innenstadt mit Cafés, Eisdielen und Wochenmarkt.' },
      { name: 'Stausee Bitburg', category: 'aktiv', lat: 49.9931, lon: 6.4429, emoji: '🏞️', text: 'Naherholungsgebiet mit Badestelle, Tretbooten, Minigolf und Seerundweg.' },
      { name: 'Kylltal-Radweg (Kyllburg)', category: 'aktiv', lat: 50.0392, lon: 6.5911, emoji: '🚴', text: 'Einer der schönsten Bahntrassen-Radwege der Eifel — von Kyllburg bis Trier.' },
      { name: 'Nims-Radweg (Rittersdorf)', category: 'aktiv', lat: 49.9887, lon: 6.4956, emoji: '🚵', text: 'Idyllischer Flussradweg durchs Nimstal, vorbei an Burg Rittersdorf.' },
      { name: 'Cascade Erlebnisbad', category: 'familie', lat: 49.9702, lon: 6.5341, emoji: '💦', text: 'Erlebnisbad mit Rutschen, Sauna und Außenbecken — 15 Gehminuten vom Zentrum.' },
      { name: 'Eifelpark Gondorf', category: 'familie', lat: 49.935, lon: 6.447, emoji: '🎢', text: 'Freizeit- und Wildpark mit Sommerrodelbahn — 10 Autominuten.' },
      { name: 'Burg Rittersdorf', category: 'sehenswert', lat: 49.9899, lon: 6.4939, emoji: '🏰', text: 'Wasserburg aus dem 12. Jahrhundert mit Restaurant im Burghof.' },
    ],
    center: [49.9725, 6.523],
    zoom: 13,
    locationMatch: 'Bitburg',
  },

  suedeifel: {
    slug: 'suedeifel',
    name: 'Südeifel & Sauertal',
    claim: 'Felsen, Flüsse und Luxemburg vor der Tür — Natur pur',
    metaTitle: 'Ferienwohnungen in der Südeifel & im Sauertal',
    metaDescription:
      'Moderne Ferienwohnungen in der Südeifel — direkt buchen bei TRIMOSA. Teufelsschlucht, Sauertal-Radweg und Luxemburg direkt vor der Tür.',
    intro: [
      'Bizarre Felsformationen, tief eingeschnittene Täler und die Sauer als Grenzfluss zu Luxemburg: Die Südeifel ist das Wander- und Outdoor-Paradies der Region — wild, grün und angenehm unaufgeregt.',
      'Unsere Apartments im Sauertal sind der perfekte Ausgangspunkt: Teufelsschlucht und Irreler Wasserfälle in Wanderdistanz, der Sauertal-Radweg direkt am Haus, und für den Abstecher ins Nachbarland liegt Echternach — die älteste Stadt Luxemburgs — nur ein paar Minuten entfernt.',
    ],
    highlights: [
      { emoji: '🪨', title: 'Teufelsschlucht', text: 'Spektakuläre Felsenschlucht mit Wanderwegen zwischen meterhohen Sandsteinwänden.' },
      { emoji: '🦕', title: 'Dinopark', text: 'Über 100 lebensgroße Urzeit-Modelle plus Forscherpfade — das Familien-Highlight.' },
      { emoji: '🚴', title: 'Sauertal-Radweg', text: 'Flach, autofrei und grenzüberschreitend — an der Sauer entlang bis zur Mosel.' },
      { emoji: '🇱🇺', title: 'Echternach', text: 'Die älteste Stadt Luxemburgs mit Benediktinerabtei — direkt über der Brücke.' },
    ],
    pois: [
      { name: 'Teufelsschlucht', category: 'aktiv', lat: 49.8283, lon: 6.4443, emoji: '🪨', text: 'Enge Felsenschlucht mit Rundwegen — eines der Naturwunder der Eifel.' },
      { name: 'Dinosaurierpark Teufelsschlucht', category: 'familie', lat: 49.8281, lon: 6.439, emoji: '🦕', text: 'Lebensgroße Dino-Modelle, Forscherpfad und Fossilien-Werkstatt.' },
      { name: 'Irreler Wasserfälle', category: 'aktiv', lat: 49.8422, lon: 6.455, emoji: '🌊', text: 'Stromschnellen der Prüm mit spektakulärer Hängebrücke.' },
      { name: 'Echternach (Luxemburg)', category: 'sehenswert', lat: 49.8117, lon: 6.4219, emoji: '⛪', text: 'Älteste Stadt Luxemburgs: Benediktinerabtei, Marktplatz und Seenpark.' },
      { name: 'Sauertal-Radweg (Bollendorf)', category: 'aktiv', lat: 49.8519, lon: 6.3592, emoji: '🚴', text: 'Flacher Flussradweg entlang der deutsch-luxemburgischen Grenze.' },
      { name: 'Kajak auf der Sauer', category: 'familie', lat: 49.848, lon: 6.39, emoji: '🛶', text: 'Kanu- und Kajaktouren auf der Sauer — Verleih in Bollendorf und Echternacherbrück.' },
      { name: 'Schloss Weilerbach', category: 'sehenswert', lat: 49.839, lon: 6.399, emoji: '🏰', text: 'Barockes Rokoko-Schloss mit Park an der Sauer.' },
      { name: 'Felsenweg 6 (NaturWanderPark)', category: 'aktiv', lat: 49.8352, lon: 6.4266, emoji: '🥾', text: 'Premium-Wanderweg durch die Felsenlandschaft rund um die Teufelsschlucht.' },
    ],
    center: [49.832, 6.425],
    zoom: 12,
    locationMatch: 'Südeifel',
  },
}

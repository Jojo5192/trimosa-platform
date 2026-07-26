/**
 * 📨 Auto-Nachrichten (Gästemappe Phase 3, §145): Datenmodell + Platzhalter-
 * Auflösung + Startvorlagen. Der Editor (dashboard/auto-nachrichten) pflegt
 * die Vorlagen; die Versand-Engine (Phase B, eigener Schritt) rendert sie mit
 * echten Buchungsdaten und schickt sie über den passenden Kanal.
 */

export type TriggerType = 'nach_buchung' | 'vor_anreise' | 'nach_anreise' | 'vor_abreise' | 'nach_abreise'

/** Kurzfristig-Weiche (§148): Für welche Buchungen gilt die Vorlage?
 *  'kurzfristig' = Anreise ≤ 3 Tage nach Buchungseingang (kompakte
 *  Einzel-Nachricht statt der ganzen Sequenz), 'normal' = alles andere. */
export type LeadFilter = 'alle' | 'kurzfristig' | 'normal'

export const LEAD_META: { id: LeadFilter; label: string; hint: string }[] = [
  { id: 'alle',        label: 'Alle Buchungen',   hint: 'gilt unabhängig vom Buchungszeitpunkt' },
  { id: 'kurzfristig', label: '⚡ Kurzfristig',    hint: 'nur wenn die Anreise max. 3 Tage nach der Buchung liegt' },
  { id: 'normal',      label: '📅 Normal',        hint: 'nur wenn die Anreise mehr als 3 Tage nach der Buchung liegt' },
]

/** Kanal-Chips für channel_filter (normalisierte Schlüssel — die Engine
 *  matcht Buchungs-Kanäle über dieselbe Normalisierung). */
export const CHANNEL_META: { id: string; label: string }[] = [
  { id: 'direkt',    label: '🌐 Website/Direkt' },
  { id: 'airbnb',    label: 'Airbnb' },
  { id: 'booking',   label: 'Booking.com' },
  { id: 'fewo',      label: 'FeWo-direkt' },
  { id: 'hometogo',  label: 'HomeToGo' },
]

export interface AutoMessage {
  id: string
  name: string
  enabled: boolean
  trigger_type: TriggerType
  offset_days: number
  send_hour: number
  listing_id: string | null
  /** §204: MEHRERE Wohnungen (jsonb-Array); hat Vorrang vor listing_id.
   *  null/leer = alle Wohnungen. */
  listing_ids?: string[] | null
  channel_filter: string[] | null
  min_nights: number | null
  lead_filter: LeadFilter
  /** Website-Gäste zusätzlich zur Chat-Nachricht per E-Mail (Default AN). */
  send_email: boolean
  /** §208: E-Mail-Betreff (Platzhalter erlaubt); null = Standard. */
  subject?: string | null
  body: string
  sort: number
}

export const TRIGGER_META: { id: TriggerType; label: string; bezug: string }[] = [
  { id: 'nach_buchung', label: 'Nach der Buchung',  bezug: 'sofort nach Eingang der Buchung' },
  { id: 'vor_anreise',  label: 'Vor der Anreise',   bezug: 'X Tage vor dem Anreisetag' },
  { id: 'nach_anreise', label: 'Nach der Anreise',  bezug: 'X Tage nach dem Anreisetag' },
  { id: 'vor_abreise',  label: 'Vor der Abreise',   bezug: 'X Tage vor dem Abreisetag' },
  { id: 'nach_abreise', label: 'Nach der Abreise',  bezug: 'X Tage nach dem Abreisetag' },
]

/** Verfügbare Platzhalter — Klick fügt sie in den Text ein. */
export const PLACEHOLDERS: { key: string; label: string }[] = [
  { key: '{vorname}',      label: 'Vorname des Gasts' },
  { key: '{name}',         label: 'Voller Gastname' },
  { key: '{wohnung}',      label: 'Name der Wohnung' },
  { key: '{anreise}',      label: 'Anreisedatum' },
  { key: '{abreise}',      label: 'Abreisedatum' },
  { key: '{naechte}',      label: 'Anzahl Nächte' },
  { key: '{gaeste}',       label: 'Anzahl Gäste' },
  { key: '{checkin}',      label: 'Check-in-Uhrzeit' },
  { key: '{checkout}',     label: 'Check-out-Uhrzeit' },
  { key: '{tuercode}',     label: 'Türcode (falls vorhanden)' },
  { key: '{mappe}',        label: 'Link zur Gästemappe' },
  { key: '{mappe_button}', label: 'Gästemappe als Button' },
  { key: '{adresse}',      label: 'Adresse der Wohnung' },
  { key: '{bewertung_button}', label: 'Google-Bewertungs-Link der Wohnung' },
  { key: '{bewertung_button}', label: 'Google-Bewertung als Button' },
]

/** Sentinel, der {mappe_button} unbeschadet durch Übersetzung & Versand trägt
 *  (Phase B): Chat ersetzt ihn durch die URL-Zeile, die Mail durch den Button. */
export const MAPPE_BTN_SENTINEL = '[[MAPPE_BUTTON]]'
/** §207: dito für {bewertung_button} — Gold-Button in der Mail, Link im Chat. */
export const REVIEW_BTN_SENTINEL = '[[REVIEW_BUTTON]]'

export interface MessageContext {
  vorname: string
  name: string
  wohnung: string
  anreise: string
  abreise: string
  naechte: string
  gaeste: string
  checkin: string
  checkout: string
  tuercode: string
  mappe: string
  adresse: string
  google_bewertung: string
}

/** Ersetzt alle {platzhalter} im Text mit den Werten aus dem Kontext. */
export function resolvePlaceholders(body: string, ctx: Partial<MessageContext>): string {
  return body.replace(/\{(\w+)\}/g, (m, key: string) => {
    const v = (ctx as Record<string, string | undefined>)[key]
    return v != null && v !== '' ? v : m
  })
}

/** Demo-Kontext für die Live-Vorschau (echte Buchungsdaten gibt es beim Versand). */
export function demoContext(wohnung: string, checkin: string, checkout: string): MessageContext {
  return {
    vorname: 'Anna',
    name: 'Anna Beispiel',
    wohnung: wohnung || 'City Home',
    anreise: '25.08.2026',
    abreise: '28.08.2026',
    naechte: '3',
    gaeste: '2',
    checkin: checkin || '16:00',
    checkout: checkout || '10:00',
    tuercode: '4 7 2 9 1 5',
    google_bewertung: 'https://search.google.com/local/writereview?placeid=ChIJk0rIYv1hlUcRQtsXHL5QEWo',
    mappe: 'trimosa.de/mappe/…',
    adresse: 'Beispielstraße 1, 54634 Bitburg',
  }
}

/** Menschlich lesbare Kurzbeschreibung des Auslösers (für Karten-Kopf). */
export function triggerSummary(m: Pick<AutoMessage, 'trigger_type' | 'offset_days' | 'send_hour'>): string {
  const h = `${String(m.send_hour).padStart(2, '0')}:00 Uhr`
  const d = m.offset_days
  switch (m.trigger_type) {
    case 'nach_buchung': return 'Direkt nach der Buchung'
    case 'vor_anreise':  return d <= 0 ? `Am Anreisetag um ${h}` : `${d} ${d === 1 ? 'Tag' : 'Tage'} vor Anreise um ${h}`
    case 'nach_anreise': return d <= 0 ? `Am Anreisetag um ${h}` : `${d} ${d === 1 ? 'Tag' : 'Tage'} nach Anreise um ${h}`
    case 'vor_abreise':  return d <= 0 ? `Am Abreisetag um ${h}` : `${d} ${d === 1 ? 'Tag' : 'Tage'} vor Abreise um ${h}`
    case 'nach_abreise': return d <= 0 ? `Am Abreisetag um ${h}` : `${d} ${d === 1 ? 'Tag' : 'Tage'} nach Abreise um ${h}`
  }
}

/** Vorbefüllte Start-Vorlagen (der „✨ Standard-Vorlagen laden"-Knopf).
 *  Anti-Spam-Doktrin (§148): Normale Buchungen bekommen die Sequenz
 *  (Bestätigung → Erinnerung → Anreisetag), kurzfristige Bucher EINE
 *  kompakte Nachricht mit allem Wichtigen. */
export function defaultAutoMessages(): Omit<AutoMessage, 'id'>[] {
  return [
    {
      name: 'Buchungsbestätigung', enabled: true, trigger_type: 'nach_buchung',
      subject: 'Deine Buchung ist bestätigt 🎉 — {wohnung}',
      offset_days: 0, send_hour: 10, listing_id: null, channel_filter: null, min_nights: null, lead_filter: 'normal', send_email: true, sort: 0,
      body: 'Hallo {vorname}, schön, dass du kommst! 🎉\n\nDeine Buchung ist bestätigt:\n🏡 {wohnung}\n🗓 {anreise} – {abreise} · {naechte} Nächte · {gaeste} Gäste\n\nDein wichtigster Begleiter ist deine persönliche digitale Gästemappe 📲 — Anreise, Self-Check-in, Parken, WLAN und die besten Tipps für die Region, immer aktuell und ganz ohne Papierkram:\n\n{mappe_button}\n\n🔑 Deinen persönlichen Türcode findest du dort automatisch wenige Tage vor der Anreise — kein Schlüssel, keine Übergabe, du kommst an, wann es dir passt.\n🕓 Check-in ab {checkin} Uhr am Anreisetag.\n\nFragen? Antworte einfach auf diese Nachricht — wir sind schnell für dich da. 😊\n\nWir freuen uns auf dich!\nDein TRIMOSA-Team 💛',
    },
    {
      name: 'Kurzfristige Buchung — alles Wichtige', enabled: true, trigger_type: 'nach_buchung',
      subject: 'Buchung bestätigt — alles für deine Anreise 🔑',
      offset_days: 0, send_hour: 10, listing_id: null, channel_filter: null, min_nights: null, lead_filter: 'kurzfristig', send_email: true, sort: 1,
      body: 'Hallo {vorname}, deine Buchung ist bestätigt — und es geht ja schon bald los! 🎉\n\n🏡 {wohnung}\n🗓 {anreise} – {abreise} · Check-in ab {checkin} Uhr\n🔑 Dein Türcode: {tuercode} — einfach am Keypad eingeben, kein Schlüssel nötig.\n\nAlles Weitere (Anreise, Parken, WLAN und die besten Tipps für die Region 📲) findest du in deiner persönlichen digitalen Gästemappe:\n\n{mappe_button}\n\nFragen? Antworte einfach auf diese Nachricht — wir sind schnell für dich da. 😊\n\nBis gleich — wir freuen uns auf dich!\nDein TRIMOSA-Team 💛',
    },
    {
      name: 'Erinnerung vor Anreise', enabled: true, trigger_type: 'vor_anreise',
      subject: 'Bald geht\'s los — deine Anreise am {anreise} 🏡',
      offset_days: 3, send_hour: 10, listing_id: null, channel_filter: null, min_nights: null, lead_filter: 'normal', send_email: true, sort: 2,
      body: 'Hallo {vorname}, nur noch wenige Tage! 🎉\n\nDein Aufenthalt startet am {anreise}:\n🏡 {wohnung}\n🕓 Check-in ab {checkin} Uhr — Self-Check-in, ganz ohne Schlüsselübergabe\n🔑 Dein persönlicher Türcode erscheint automatisch in deiner Gästemappe\n\nDort findest du auch Anreise, Parken, WLAN und die besten Tipps für die Region 📲:\n\n{mappe_button}\n\nFragen vor der Anreise? Antworte einfach auf diese Nachricht. 😊\n\nBis ganz bald — wir freuen uns auf dich!\nDein TRIMOSA-Team 💛',
    },
    {
      name: 'Am Anreisetag', enabled: true, trigger_type: 'vor_anreise',
      subject: 'Willkommen! Dein Türcode für {wohnung} 🔑',
      offset_days: 0, send_hour: 12, listing_id: null, channel_filter: null, min_nights: null, lead_filter: 'normal', send_email: true, sort: 3,
      body: 'Hallo {vorname}, heute ist es soweit — herzlich willkommen! 🎉\n\n🔑 Dein Türcode für {wohnung}: {tuercode} — einfach am Keypad eingeben, kein Schlüssel nötig.\n🕓 Ab {checkin} Uhr ist alles für dich bereit.\n\nDie Check-in-Anleitung mit Fotos, Parken und alle weiteren Infos findest du in deiner Gästemappe 📲:\n\n{mappe_button}\n\nWenn unterwegs etwas ist: Antworte einfach auf diese Nachricht — wir sind schnell für dich da. 😊\n\nGute Anreise!\nDein TRIMOSA-Team 💛',
    },
    {
      name: 'Nach der Abreise / Danke', enabled: true, trigger_type: 'nach_abreise',
      subject: 'Danke für deinen Aufenthalt 💛',
      offset_days: 1, send_hour: 11, listing_id: null, channel_filter: null, min_nights: null, lead_filter: 'alle', send_email: true, sort: 4,
      body: 'Hallo {vorname}, danke, dass du bei uns warst! 💛\n\nWir hoffen, du hattest eine wundervolle Zeit bei uns — und vielleicht sehen wir uns ja bald wieder.\n\n⭐ Wenn dir dein Aufenthalt gefallen hat, würdest du uns mit einer kurzen Google-Bewertung riesig helfen:\n\n{google_bewertung}\n\nDein Feedback macht uns besser — und hilft anderen Gästen bei der Entscheidung.\n\nGute Heimreise und bis zum nächsten Mal!\nDein TRIMOSA-Team 💛',
    },
  ]
}

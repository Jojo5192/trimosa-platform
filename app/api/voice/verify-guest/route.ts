import { requireVoiceAuth, findBookingByPhone, findBookingByDetails, normalizePhone, nameLooselyMatches, foldName } from '@/lib/voice'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * ☎️🔐 Anrufer-Verifizierung (§175, Inhaber-Entscheid 24.7.):
 * Der TÜRCODE dient als Ausweis für kritische Auskünfte — außer der Anrufer
 * fragt den Türcode selbst an (zirkulär), dann Nachname + Anreisedatum.
 * Max. wenige Abfragen, Fehlversuche rate-limitiert.
 *
 * POST { caller_number?, door_code?, last_name?, arrival_date?,
 *        apartment_name?, request: 'tuercode' | 'info' }
 * → { verified, guest_first_name?, apartment?, door_code?, chat_sent?, hint }
 */

type BRow = {
  id: string
  guest_name: string | null
  adults: number | null
  children: number | null
  check_in: string
  check_out: string
  door_code: string | null
  portal_token: string | null
  listings: { title: string | null; check_in_time?: string | null } | null
}

async function loadBooking(id: string): Promise<BRow | null> {
  const { data } = await supabaseAdmin
    .from('bookings')
    .select('id, guest_name, adults, children, check_in, check_out, door_code, portal_token, listings(title, check_in_time)')
    .eq('id', id)
    .maybeSingle()
  return (data as unknown as BRow) ?? null
}

export async function POST(request: Request) {
  const denied = requireVoiceAuth(request)
  if (denied) return denied

  let body: {
    caller_number?: string; door_code?: string; last_name?: string
    arrival_date?: string; departure_date?: string; apartment_name?: string; request?: string
  }
  try { body = await request.json() } catch { body = {} }

  const caller = String(body.caller_number ?? '').trim()
  const codeIn = String(body.door_code ?? '').replace(/\D/g, '')
  const lastName = String(body.last_name ?? '').trim().toLowerCase()
  const arrival = String(body.arrival_date ?? '').trim()
  const departure = String(body.departure_date ?? '').trim()
  const apartment = String(body.apartment_name ?? '').trim().toLowerCase()
  const wants = body.request === 'tuercode' ? 'tuercode' : 'info'

  // Fehlversuchs-Bremse je Rufnummer (Anrufer-ID-Spoofing bleibt Restrisiko,
  // aber Brute-Force über wiederholte Anrufe wird teuer)
  // 12/Std.: der Frage-Trichter braucht mehrere Tool-Runden pro Gespräch
  const rlKey = `voice-verify:${normalizePhone(caller) || 'anon'}`
  const allowed = await checkRateLimit(rlKey, 12, 3600)
  if (!allowed) {
    return Response.json({ verified: false, hint: 'Zu viele Versuche — der Anrufer soll es später erneut versuchen oder das Team ruft zurück.' })
  }

  const today = new Date().toISOString().slice(0, 10)
  const cutoff = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)

  // ── Buchung finden: Anrufer-Nummer → Türcode → Namens-Daten ──
  let booking: BRow | null = null
  const byPhone = caller ? await findBookingByPhone(caller) : null
  if (byPhone) booking = await loadBooking(byPhone.id)

  if (!booking && codeIn.length >= 5) {
    const { data } = await supabaseAdmin
      .from('bookings')
      .select('id, guest_name, adults, children, check_in, check_out, door_code, portal_token, listings(title, check_in_time)')
      .eq('status', 'confirmed')
      .eq('door_code', codeIn)
      .gte('check_out', cutoff)
      .order('check_in', { ascending: true })
      .limit(2)
    const rows = (data ?? []) as unknown as BRow[]
    if (rows.length === 1) booking = rows[0]
  }

  if (!booking && lastName && /^\d{4}-\d{2}-\d{2}$/.test(arrival)) {
    const { data } = await supabaseAdmin
      .from('bookings')
      .select('id, guest_name, adults, children, check_in, check_out, door_code, portal_token, listings(title, check_in_time)')
      .eq('status', 'confirmed')
      .eq('check_in', arrival)
      .ilike('guest_name', `%${lastName}%`)
      .limit(3)
    const rows = (data ?? []) as unknown as BRow[]
    const filtered = apartment
      ? rows.filter((r) => String(r.listings?.title ?? '').toLowerCase().includes(apartment))
      : rows
    if (filtered.length === 1) booking = filtered[0]
  }

  // Website-Buchungen tragen den Namen oft nur im PROFIL (guest_name null).
  // Zwei getrennte Queries statt or() — Sonderzeichen/Umlaute im or()-String
  // sind eine bekannte PostgREST-Falle (§134-Lektion).
  if (!booking && lastName && /^\d{4}-\d{2}-\d{2}$/.test(arrival)) {
    try {
      const [byDisplay, byLast] = await Promise.all([
        supabaseAdmin.from('profiles').select('id').ilike('display_name', `%${lastName}%`).limit(10),
        supabaseAdmin.from('profiles').select('id').ilike('guest_last_name', `%${lastName}%`).limit(10),
      ])
      const ids = [...new Set([...(byDisplay.data ?? []), ...(byLast.data ?? [])].map((p) => String(p.id)))]
      if (ids.length) {
        const { data } = await supabaseAdmin
          .from('bookings')
          .select('id, guest_name, guest_id, adults, children, check_in, check_out, door_code, portal_token, listings(title, check_in_time)')
          .eq('status', 'confirmed')
          .eq('check_in', arrival)
          .in('guest_id', ids)
          .limit(3)
        const rows = (data ?? []) as unknown as (BRow & { guest_id: string | null })[]
        const filtered = apartment
          ? rows.filter((r) => String(r.listings?.title ?? '').toLowerCase().includes(apartment))
          : rows
        // Profil-Treffer = Name bereits geprüft → guest_name-Lücke überbrücken
        if (filtered.length === 1) booking = { ...filtered[0], guest_name: filtered[0].guest_name ?? lastName }
      }
    } catch { /* best effort */ }
  }

  // §183-Nachtrag „Bootsma-Fall": Buchung auch über Wohnung+Daten finden
  // (Datum als Anker, Name nur zum Entschärfen) — ein verhörter Nachname
  // darf die SUCHE nicht scheitern lassen; verifiziert wird danach separat.
  if (!booking && (arrival || departure)) {
    const byDetails = await findBookingByDetails({
      name: lastName, apartment, arrival, departure,
    }).catch(() => null)
    if (byDetails) booking = await loadBooking(byDetails.id)
  }

  if (!booking) {
    // §186-Trichter: Der Server sagt dem Bot GENAU, was er als Nächstes fragen
    // soll — eine Frage pro Runde, dann erneuter Tool-Aufruf mit ALLEN Angaben.
    const missing: string[] = []
    if (!arrival) missing.push('das Anreisedatum')
    if (!departure) missing.push('das Abreisedatum')
    if (!lastName) missing.push('den Namen der Person, die gebucht hat')
    if (!apartment) missing.push('den Namen der Wohnung')
    const hint = missing.length
      ? `Keine passende Buchung gefunden — es fehlt noch: ${missing.join(', ')}. Frag beiläufig GENAU EINE dieser Angaben nach (in dieser Reihenfolge) und rufe das Tool danach mit ALLEN bisher bekannten Angaben erneut auf.`
      : 'Zu diesen Angaben passt keine Buchung. Kläre die wahrscheinlichste Ursache — EINE Rückfrage pro Runde, danach Tool erneut aufrufen: 1) Datum verhört oder falsch erinnert („Magst du kurz in deiner Buchungsbestätigung nachschauen?") · 2) Buchung läuft auf einen ANDEREN Namen (Partner, Familie, Firma — nach dem Namen der buchenden Person fragen) · 3) über ein Portal gebucht (Airbnb/Booking/FeWo — der dort hinterlegte Name kann abweichen). Nach spätestens ZWEI erfolglosen Runden nicht weiter verhören: nachricht_aufnehmen — das Team meldet sich schnell.'
    return Response.json({
      verified: false,
      hint: hint + ' WICHTIG: Steht der Anrufer ausgesperrt VOR DER TÜR, ist das ein NOTFALL — dann NICHT weiter suchen, sondern SOFORT nachricht_aufnehmen mit urgent=true; den Anrufer nie unverrichteter Dinge auflegen lassen.',
    })
  }

  // ── Verifizieren (§180, Inhaber: „nicht so streng — wie ein Mensch") ──
  // Wege: (a) Zugangscode · (b) Name (Vor- ODER Nachname reicht) + Anreise-
  // UND Abreisedatum · (c) per Rufnummer gefundene Buchung + Anreisedatum
  // (die bekannte Nummer ist selbst ein Identitätsfaktor).
  const codeOk = !!booking.door_code && codeIn.length >= 5 && codeIn === booking.door_code
  const guestFull = (booking.guest_name ?? '').trim().toLowerCase()
  // §188: FUZZY-Vergleich (Akzente gefaltet + kleine Edit-Distanz) — die
  // Spracherkennung verstümmelt Namen massiv („Bozma" ↔ „Bootsma",
  // „Edmes Läppchen" ↔ „Edmée Sleijpen"). §181-Policy: EIN Namensteil reicht.
  let nameOk = nameLooselyMatches(lastName, guestFull)
  // Website-Buchungen tragen den Namen oft nur im Profil
  if (!nameOk && lastName) {
    try {
      const { data: b2 } = await supabaseAdmin
        .from('bookings').select('guest_id').eq('id', booking.id).maybeSingle()
      if (b2?.guest_id) {
        const { data: prof } = await supabaseAdmin
          .from('profiles').select('display_name, guest_last_name').eq('id', b2.guest_id).maybeSingle()
        const profNames = `${prof?.display_name ?? ''} ${prof?.guest_last_name ?? ''}`
        if (nameLooselyMatches(lastName, profNames)) nameOk = true
      }
    } catch { /* best effort */ }
  }
  const arrivalOk = /^\d{4}-\d{2}-\d{2}$/.test(arrival) && arrival === booking.check_in
  const departureOk = /^\d{4}-\d{2}-\d{2}$/.test(departure) && departure === booking.check_out
  // §191: SCHNELL-Verifizierung (Inhaber: „Zuordnung darf nicht so schwer
  // sein") — wer WOHNUNG + exakten Zeitraum kennt, ist der Gast; der Name
  // dient dann nur noch der Anrede, kein Buchstabier-Zirkus mehr nötig.
  const aptFold = foldName(apartment)
  const titleFold = foldName(String(booking.listings?.title ?? ''))
  const apartmentOk = !!aptFold && !!titleFold && (
    titleFold.includes(aptFold) || aptFold.includes(titleFold) ||
    (() => { const w = aptFold.split(/\s+/).filter((x) => x.length >= 3); return w.length > 0 && w.every((x) => titleFold.includes(x)) })()
  )
  const dataOk = (arrivalOk && departureOk && (nameOk || apartmentOk)) || (arrivalOk && !!byPhone)

  if (!codeOk && !dataOk) {
    return Response.json({
      verified: false,
      hint: (nameOk || apartmentOk)
        ? 'Zeitraum passt nicht ganz zur gefundenen Buchung — Anreise- und Abreisedatum nochmal beiläufig klären (Gäste irren sich oft um einen Tag; im Zweifel kurz in die Buchungsbestätigung schauen lassen), dann erneut aufrufen.'
        : 'Eine Buchung zum Zeitraum existiert, aber der genannte NAME passt nicht. Drei Wege, je EINE Frage pro Runde: 1) Fehlt die WOHNUNG noch, frag danach — Wohnung + exakter Zeitraum reichen zur Verifizierung, ganz ohne Namens-Klärung. 2) Den Anrufer den Nachnamen langsam BUCHSTABIEREN lassen (die Spracherkennung verhört Namen oft) und mit dem buchstabierten Namen erneut aufrufen. 3) Vielleicht hat der Partner/die Familie/die Firma gebucht — nach dem Namen der buchenden Person fragen. Klappt nichts davon: NICHT weiter raten — nachricht_aufnehmen (ausgesperrter Gast vor der Tür = urgent=true), das Team meldet sich sofort.',
    })
  }

  const firstName = (booking.guest_name ?? '').split(/\s+/)[0] ?? ''
  const title = booking.listings?.title ?? 'deiner Wohnung'

  // ── Türcode-Anfrage (§180, Inhaber-Policy): Ab ANREISETAG bis Ende
  //    Abreisetag wird der Code ganz normal am Telefon genannt (Gast ist
  //    vor Ort). VOR der Anreise: nicht nennen — Gästemappen-Link in den
  //    Chat senden, Code erscheint dort automatisch im Reveal-Fenster.
  if (wants === 'tuercode') {
    const staying = booking.check_in <= today && booking.check_out >= today
    const mappe = booking.portal_token ? `https://trimosa.de/mappe/${booking.portal_token}` : null

    if (booking.check_out < today) {
      return Response.json({
        verified: true, guest_first_name: firstName, apartment: title,
        hint: 'Der Aufenthalt ist bereits beendet — Codes sind abgelaufen. Anliegen ggf. per nachricht_aufnehmen ans Team.',
      })
    }

    if (!staying) {
      // Vor der Anreise: Mappe-Link in den Chat, Code kommt automatisch
      let chatSent = false
      try {
        const content = [
          `📖 Wie eben am Telefon besprochen: Hier nochmal der Link zu deiner Gästemappe${mappe ? ` — ${mappe}` : ' (der Link kam mit deiner Buchung)'}.`,
          'Dein Türcode erscheint dort automatisch wenige Tage vor der Anreise.',
        ].join('\n')
        const { error } = await supabaseAdmin.from('messages').insert({
          booking_id: booking.id, sender_type: 'host', content, lang: 'de',
        })
        chatSent = !error
      } catch { /* best effort */ }
      return Response.json({
        verified: true, guest_first_name: firstName, apartment: title,
        mappe_link_sent: chatSent,
        hint: 'Code jetzt noch NICHT nennen (Anreise liegt in der Zukunft). Dem Gast sagen: Der Code erscheint automatisch wenige Tage vor der Anreise in der Gästemappe' + (chatSent ? ' — den Mappen-Link haben wir ihm gerade nochmal in den Chat geschickt.' : ' (Link kam mit der Buchung).'),
      })
    }

    // Aufenthalt läuft (Anreisetag bis Abreisetag): Code nennen
    let code = booking.door_code
    if (!code) {
      try {
        const { ensureDoorCode } = await import('@/lib/locks')
        code = await ensureDoorCode(booking.id)
      } catch (e) { console.error('[voice-verify] ensureDoorCode:', e) }
    }
    if (!code) {
      return Response.json({
        verified: true, guest_first_name: firstName, apartment: title,
        hint: 'Kein Code verfügbar (technisches Problem) — per nachricht_aufnehmen mit urgent=true SOFORT ans Team, der Gast wartet vermutlich vor der Tür.',
      })
    }

    let chatSent = false
    try {
      const content = [
        `🔐 Wie eben am Telefon besprochen: Dein Türcode für ${title} ist ${code}.`,
        mappe ? `Du findest ihn jederzeit auch in deiner Gästemappe: ${mappe}` : '',
      ].filter(Boolean).join('\n')
      const { error } = await supabaseAdmin.from('messages').insert({
        booking_id: booking.id, sender_type: 'host', content, lang: 'de',
      })
      chatSent = !error
    } catch { /* best effort */ }

    // §189/§190: Ausgesperrt = erst GEMEINSAM lösen, nicht sofort eskalieren —
    // Prüfschritte aber NUR bei Bedarf, nicht vorab herunterbeten
    const sirzenich = /cozy|magnolia|sweet/i.test(title)
    const doorInfo = sirzenich
      ? 'Diese Wohnung ist in Sirzenich: HAUSTÜR und WOHNUNGSTÜR haben je ein Keypad — DIESER Code gilt für beide Türen.'
      : ''
    // §190: Anruf am Anreisetag VOR der Check-in-Zeit → Code ja, aber mit
    // klarem Hinweis (außer im Chat wurde ein früherer Check-in vereinbart)
    const nowHM = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date())
    const checkinTime = String(booking.listings?.check_in_time ?? '16:00').slice(0, 5)
    const earlyNote = booking.check_in === today && nowHM < checkinTime
      ? ` ⏰ WICHTIG: Es ist erst ${nowHM} Uhr, Check-in ist ab ${checkinTime} Uhr — den Code darfst du nennen, aber weise freundlich darauf hin, dass die Wohnung erst ab ${checkinTime} Uhr bezugsfertig ist (die Reinigung kann noch laufen). AUSNAHME: Der Gast hat mit dem Team einen früheren Check-in vereinbart — frag ihn danach bzw. prüfe es mit chat_verlauf.`
      : ''
    return Response.json({
      verified: true,
      guest_first_name: firstName,
      apartment: title,
      door_code: code,
      chat_sent: chatSent,
      hint: 'Code langsam und deutlich Ziffer für Ziffer nennen' + (chatSent ? ' — er steht jetzt zusätzlich im Chat bzw. in der Gästemappe.' : '.')
        + earlyNote
        + (doorInfo ? ` ${doorInfo}` : '')
        + ' Danach nur fragen, ob es geklappt hat — KEINE Bedienungs-Anleitung vorab. NUR falls der Gast nach dem Versuch nicht reinkommt, gemeinsam eingrenzen (eine Frage nach der anderen): 1) Welchen Code hat er eingetippt? Mit diesem abgleichen — oft wurde ein alter/anderer Code aus einer früheren Nachricht probiert oder Ziffern vertauscht. 2) Wurde die Eingabe mit dem Häkchen (✓) bestätigt? 3) Was zeigt das Keypad — rotes Licht, gar kein Licht (kann leere Batterie heißen), ein Ton? Erst wenn das gemeinsam nicht klappt: nachricht_aufnehmen mit urgent=true.',
    })
  }

  // §192: Buchungsdetails DIREKT mitliefern — der Bot behauptete sonst,
  // er habe „keinen Zugriff auf die Personenzahl"
  const persons = (booking.adults ?? 0) + (booking.children ?? 0)
  const nights = Math.round((new Date(`${booking.check_out}T00:00:00Z`).getTime() - new Date(`${booking.check_in}T00:00:00Z`).getTime()) / 86400000)
  return Response.json({
    verified: true,
    guest_first_name: firstName,
    apartment: title,
    check_in: booking.check_in,
    check_out: booking.check_out,
    nights,
    persons: persons > 0 ? persons : null,
    adults: booking.adults,
    children: booking.children,
    hint: 'Verifiziert — buchungsbezogene Fragen dürfen jetzt beantwortet werden. Personenzahl und Zeitraum stehen DIREKT in dieser Antwort — nutze sie und sag nie, du hättest keinen Zugriff auf Buchungsdetails. Türcodes nur über request=tuercode.',
  })
}

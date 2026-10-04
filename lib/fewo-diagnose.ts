/**
 * 🔎 FeWo-Daten-Diagnose (1.10., Fall Hans-Dieter) — server-only, NUR LESEN: Datenbank + app_settings
 * 'graph_mail', kein Graph-, Smoobu- oder KI-Aufruf. Beantwortet je FeWo-direkt-Buchung: Was fehlt
 * (E-Mail/Nachname)? Gibt es die Team-Aufgabe? Wartet eine Buchungsmail mit genau diesem Zeitraum noch
 * auf Zuordnung — und warum? Passt die Objektnummer der Mail zur vrbo_url der Wohnung?
 * Aufrufer: GET /api/smoobu/reservation (?booking=<id> bzw. ?fewo=1), nur Admin/Gastgeber.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getGraphMailState, type GraphMailState } from '@/lib/graph-mail'
import { fewoMissing, FEWO_NAME_TASK_DAYS } from '@/lib/inbound-mail-core'
import { isFewoRelayEmail } from '@/lib/fewo'

type Row = {
  id: string; guest_name: string | null; guest_email: string | null; adults: number | null; children: number | null
  check_in: string; check_out: string; channel: string | null; status: string | null; created_at: string | null
  listing_id: string | null
  listings: { title?: string | null; vrbo_url?: string | null } | { title?: string | null; vrbo_url?: string | null }[] | null
}

const SELECT = 'id, guest_name, guest_email, adults, children, check_in, check_out, channel, status, created_at, listing_id, listings(title, vrbo_url)'
const lst = (b: Row) => (Array.isArray(b.listings) ? b.listings[0] : b.listings) ?? null

/** Objektnummer einer wartenden Mail: KI-Wert, sonst die „#1234567" aus dem Betreff. */
function objektNrOf(p: GraphMailState['pending'][number]): string {
  return String(p.parsed?.objekt_nr ?? '').replace(/\D/g, '') || (p.subject.match(/#\s?(\d{5,10})\b/)?.[1] ?? '')
}

function pendingView(p: GraphMailState['pending'][number]) {
  return {
    betreff: p.subject, postfach: p.mailbox, empfangen: p.receivedAt ?? null,
    zeitraum: p.parsed ? `${String(p.parsed.checkin ?? '?')} – ${String(p.parsed.checkout ?? '?')}` : null,
    nameInMail: p.parsed ? String(p.parsed.gast_name ?? '') || null : null,
    objektNr: objektNrOf(p) || null,
    wartetBis: p.until, versuche: p.tries ?? 0, grund: p.grund || null,
    // Alt-Eintrag/KI-Aussetzer: Mail wird je Lauf neu geholt und extrahiert
    ohneDaten: !p.parsed,
  }
}

export async function fewoDiagnose(o: { bookingId?: string } = {}) {
  const today = new Date().toISOString().slice(0, 10)
  let q = supabaseAdmin.from('bookings').select(SELECT)
  q = o.bookingId
    ? q.eq('id', o.bookingId)
    : q.neq('status', 'cancelled').gte('check_out', today).order('check_in', { ascending: true }).limit(500)
  const { data, error } = await q
  if (error) throw new Error(`bookings: ${error.message}`)
  const rows = ((data ?? []) as unknown as Row[]).filter((b) => !!o.bookingId || /fewo|homeaway|vrbo/i.test(b.channel ?? ''))

  const state = await getGraphMailState()

  // Aufgaben „Gastdaten fehlen"/„Nachname fehlt" je Buchung (jeder Status)
  const tasks = new Map<string, { id: string; status: string | null; title: string | null }>()
  for (let i = 0; i < rows.length; i += 60) {
    const { data: ts } = await supabaseAdmin
      .from('tasks').select('id, status, title, source_ref').eq('source', 'system')
      .in('source_ref', rows.slice(i, i + 60).map((b) => `fewo-daten:${b.id}`))
    for (const t of ts ?? []) tasks.set(String(t.source_ref), { id: String(t.id), status: t.status ?? null, title: t.title ?? null })
  }

  // Einzel-Diagnose: alle anderen (nicht stornierten) Buchungen mit exakt demselben Zeitraum — bei mehreren
  // entscheidet der Namens-Abgleich, sonst bleibt die Mail in der Warteschlange
  let gleicherZeitraum: { id: string; gast: string | null; kanal: string | null; wohnung: string | null; status: string | null }[] | undefined
  if (o.bookingId && rows[0]) {
    const { data: same } = await supabaseAdmin
      .from('bookings').select(SELECT)
      .eq('check_in', rows[0].check_in).eq('check_out', rows[0].check_out)
      .neq('status', 'cancelled').neq('id', rows[0].id).limit(40)
    gleicherZeitraum = ((same ?? []) as unknown as Row[]).map((b) => ({
      id: b.id, gast: b.guest_name, kanal: b.channel, wohnung: lst(b)?.title ?? null, status: b.status,
    }))
  }

  // wie ensureFewoDataTasks: „Nachname fehlt" entsteht erst ab FEWO_NAME_TASK_DAYS vor der Anreise
  const nameHorizon = new Date(Date.now() + FEWO_NAME_TASK_DAYS * 86400_000).toISOString().slice(0, 10)
  const buchungen = rows.map((b) => {
    const vrbo = String(lst(b)?.vrbo_url ?? '')
    const task = tasks.get(`fewo-daten:${b.id}`) ?? null
    const fehlt = fewoMissing(b)
    return {
      id: b.id, gast: b.guest_name, wohnung: lst(b)?.title ?? null,
      zeitraum: `${b.check_in} – ${b.check_out}`, kanal: b.channel, status: b.status, angelegt: b.created_at,
      email: !(b.guest_email ?? '').includes('@') ? 'fehlt' : isFewoRelayEmail(b.guest_email) ? 'relay (FeWo-Messenger)' : 'echt',
      personen: (b.adults ?? 0) + (b.children ?? 0) || null,
      fehlt,
      wohnungHatVrboUrl: !!vrbo,
      aufgabe: task,
      // true = der nächste Mail-Scan legt (bei ≥ 2 h alter Buchung, höchstens 5 je Lauf) eine Aufgabe an
      aufgabeFolgt: !task && fehlt.length > 0 && b.status === 'confirmed' && b.check_out >= today && /fewo|homeaway|vrbo/i.test(b.channel ?? '')
        && (fehlt.includes('E-Mail') || b.check_in <= nameHorizon),
      wartendeMails: state.pending
        .filter((p) => p.parsed?.checkin === b.check_in && p.parsed?.checkout === b.check_out)
        .map((p) => {
          const nr = objektNrOf(p)
          return { ...pendingView(p), objektNrInVrboUrl: nr ? vrbo.includes(nr) : null }
        }),
    }
  })

  return {
    hinweis: 'Nur lesend. fehlt = was der Buchung fehlt; wartendeMails = Buchungsmails mit genau diesem Zeitraum, die noch keiner Buchung zugeordnet werden konnten (grund = letzter Versuch). objektNrInVrboUrl=false → die FeWo-URL der Wohnung enthält die Objektnummer der Mail nicht; die Zuordnung läuft dann über Kanal + Name. aufgabeFolgt = der nächste Mail-Scan legt dafür eine Team-Aufgabe an („Nachname fehlt" erst ab ' + FEWO_NAME_TASK_DAYS + ' Tagen vor der Anreise).',
    mailScan: { aktiv: state.enabled, postfaecher: state.mailboxes, wartendGesamt: state.pending.length },
    buchungen: o.bookingId ? buchungen : buchungen.filter((b) => b.fehlt.length > 0 || b.wartendeMails.length > 0),
    ...(o.bookingId
      ? { gleicherZeitraum: gleicherZeitraum ?? [] }
      : {
          fewoBuchungenGesamt: buchungen.length,
          // Mengen-Vorschau vor/nach dem Deploy: so viele Aufgaben entstehen in den nächsten Läufen
          zaehler: {
            ohneEmail: buchungen.filter((b) => b.fehlt.includes('E-Mail')).length,
            nurNachnameFehlt: buchungen.filter((b) => b.fehlt.length === 1 && b.fehlt[0] === 'Nachname').length,
            aufgabenFolgen: buchungen.filter((b) => b.aufgabeFolgt).length,
          },
          wartend: state.pending.map(pendingView),
        }),
  }
}

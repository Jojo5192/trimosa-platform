'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import SmoobuConnect from '@/app/dashboard/SmoobuConnect'

const GOLD = '#A8882A'

const STEPS = [
  { id: 1, title: 'Wie TRIMOSA funktioniert', icon: '📋' },
  { id: 2, title: 'Smoobu verbinden',          icon: '🔗' },
  { id: 3, title: 'Webhook einrichten',         icon: '🔔' },
  { id: 4, title: 'Inserate einrichten',        icon: '🏠' },
  { id: 5, title: 'Preisgestaltung',            icon: '💶' },
  { id: 6, title: 'Stornierungsbedingungen',    icon: '📄' },
  { id: 7, title: 'Zahlungsdaten',              icon: '🏦' },
  { id: 8, title: 'Fertig!',                    icon: '✅' },
]

const CANCEL_POLICIES = [
  { id: 'flexibel', label: 'Flexibel',  desc: 'Kostenlose Stornierung bis 24 Std. vor Check-in. Danach 1 Nacht Gebühr.' },
  { id: 'moderat',  label: 'Moderat',   desc: 'Kostenlose Stornierung bis 5 Tage vor Check-in. Danach 50 % des Buchungsbetrags.' },
  { id: 'strikt',   label: 'Strikt',    desc: 'Kostenlose Stornierung innerhalb von 48 h nach Buchung (mind. 14 Tage vor Check-in). Danach keine Rückerstattung.' },
]

export default function SetupPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [markup, setMarkup] = useState('0')
  const [smoobuApiKey, setSmoobuApiKey] = useState<string | null>(null)
  const [smoobuChannelId, setSmoobuChannelId] = useState<number | null>(null)
  const [smoobuMarkup, setSmoobuMarkup] = useState(0)
  const [billing, setBilling] = useState({
    billing_name: '', billing_address: '', billing_city: '', billing_zip: '',
    billing_country: 'Deutschland', billing_tax_id: '', iban: '', bic: '', account_holder: '',
  })
  const [cancelPolicy, setCancelPolicy] = useState('moderat')
  const [savingCancel, setSavingCancel] = useState(false)
  const [savingBilling, setSavingBilling] = useState(false)
  const [billingSaved, setBillingSaved] = useState(false)
  const [savingMarkup, setSavingMarkup] = useState(false)
  const [markupSaved, setMarkupSaved] = useState(false)

  useEffect(() => {
    fetch('/api/host/billing').then(r => r.json()).then(d => {
      if (d.billing_name) setBilling(b => ({ ...b, ...d }))
      if (d.onboarding_step) setStep(Math.max(1, d.onboarding_step))
    })
    fetch('/api/settings').then(r => r.json()).then(d => {
      if (d.platform_markup_pct !== undefined) {
        setMarkup(String(d.platform_markup_pct))
        setSmoobuMarkup(d.platform_markup_pct)
      }
    })
    // Load Smoobu connection status
    fetch('/api/smoobu/apartments').then(r => r.json()).then(d => {
      if (d.apiKey) setSmoobuApiKey(d.apiKey)
      if (d.channelId) setSmoobuChannelId(d.channelId)
    }).catch(() => {/* not critical */})
  }, [])

  async function saveMarkup() {
    setSavingMarkup(true)
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform_markup_pct: parseFloat(markup) || 0 }),
    })
    setSavingMarkup(false)
    setMarkupSaved(true)
    setTimeout(() => setMarkupSaved(false), 3000)
  }

  async function saveBilling() {
    setSavingBilling(true)
    await fetch('/api/host/billing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...billing, onboarding_step: 8 }),
    })
    setSavingBilling(false)
    setBillingSaved(true)
  }

  async function goToStep(n: number) {
    setStep(n)
    await fetch('/api/host/billing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboarding_step: n }),
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const pct = parseFloat(markup) || 0
  const exampleBase = 100
  const exampleGuest = Math.round(exampleBase * (1 + pct / 100))
  const exampleCommission = Math.round(exampleGuest * 0.1)
  const examplePayout = exampleGuest - exampleCommission

  const WEBHOOK_URL = 'https://trimosa-app.vercel.app/api/smoobu/webhook'

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#FAFAF8', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#fff', borderBottom: '1px solid #EEEBE4', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/dashboard" style={{ textDecoration: 'none', color: '#666', fontSize: '13px' }}>← Zurück zum Dashboard</Link>
        <span style={{ fontSize: '13px', fontWeight: 600, color: GOLD }}>TRIMOSA Einrichtung</span>
      </div>

      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '32px 20px' }}>

        {/* Progress */}
        <div style={{ display: 'flex', gap: '5px', marginBottom: '36px' }}>
          {STEPS.map(s => (
            <div key={s.id} style={{ flex: 1, height: '4px', borderRadius: '2px', backgroundColor: step >= s.id ? GOLD : '#E8E4DB', transition: 'background 0.3s' }} />
          ))}
        </div>
        <div style={{ fontSize: '12px', fontWeight: 600, color: GOLD, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>
          Schritt {step} von {STEPS.length} — {STEPS[step - 1].icon} {STEPS[step - 1].title}
        </div>

        {/* ── Step 1: Wie es funktioniert ── */}
        {step === 1 && (
          <div>
            <h1 style={h1}>Willkommen bei TRIMOSA</h1>
            <p style={sub}>Bevor wir loslegen, hier ein kurzer Überblick wie die Zusammenarbeit funktioniert.</p>

            {[
              { icon: '💶', title: 'Deine Preise, deine Kontrolle', text: 'Du pflegst deine Preise wie gewohnt in Smoobu. TRIMOSA synchronisiert sie automatisch — kein doppelter Aufwand.' },
              { icon: '📊', title: '10 % Provision pro Buchung', text: 'TRIMOSA behält 10 % der Buchungssumme als Provision. Der Rest wird dir am Tag des Check-Ins überwiesen. Du entscheidest ob du die Provision über einen Preisaufschlag auf den Gast umlegen möchtest.' },
              { icon: '🧾', title: 'Monatliche Sammelrechnung', text: 'Du erhältst einmal im Monat eine Rechnung über alle Provisionen — nicht pro Buchung.' },
              { icon: '🔄', title: 'Smoobu bleibt dein Channel Manager', text: 'Buchungen über TRIMOSA landen automatisch in deinem Smoobu-Kalender und blockieren alle anderen Kanäle.' },
            ].map(item => (
              <div key={item.title} style={{ display: 'flex', gap: '16px', padding: '16px 0', borderBottom: '1px solid #F0EDE6' }}>
                <div style={{ fontSize: '24px', flexShrink: 0, width: '36px', textAlign: 'center' }}>{item.icon}</div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#111', marginBottom: '4px' }}>{item.title}</div>
                  <div style={{ fontSize: '13px', color: '#666', lineHeight: 1.6 }}>{item.text}</div>
                </div>
              </div>
            ))}

            <button onClick={() => goToStep(2)} style={btnStyle}>Verstanden — weiter →</button>
          </div>
        )}

        {/* ── Step 2: Smoobu verbinden ── */}
        {step === 2 && (
          <div>
            <h1 style={h1}>Smoobu verbinden</h1>
            <p style={sub}>Verbinde dein Smoobu-Konto damit TRIMOSA Verfügbarkeiten, Preise und Buchungen synchronisieren kann.</p>

            <SmoobuConnect
              currentApiKey={smoobuApiKey}
              currentChannelId={smoobuChannelId}
              currentMarkup={smoobuMarkup}
            />

            <div style={{ marginTop: '20px', padding: '16px 20px', backgroundColor: '#F5F3EF', borderRadius: '12px', border: '1px solid #E8E4DB', fontSize: '13px', color: '#555', lineHeight: 1.6 }}>
              <strong>Kein Smoobu?</strong> Kein Problem — du kannst Wohnungen auch manuell in TRIMOSA anlegen. Überspringe diesen Schritt.
            </div>

            <button onClick={() => goToStep(3)} style={btnStyle}>Weiter →</button>
            <button onClick={() => goToStep(3)} style={skipStyle}>Überspringen</button>
          </div>
        )}

        {/* ── Step 3: Webhook einrichten ── */}
        {step === 3 && (
          <div>
            <h1 style={h1}>Webhook einrichten</h1>
            <p style={sub}>
              Damit TRIMOSA sofort über neue Buchungen, Stornierungen und Nachrichten aus Smoobu informiert wird, muss ein Webhook eingerichtet werden. Das ist einmalig und dauert 2 Minuten.
            </p>

            <div style={{ backgroundColor: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: '12px', padding: '14px 16px', marginBottom: '20px' }}>
              <p style={{ fontSize: '13px', color: '#0369A1', margin: 0, lineHeight: 1.6 }}>
                <strong>Was ist ein Webhook?</strong> Smoobu schickt automatisch eine Benachrichtigung an TRIMOSA, sobald sich etwas ändert — z.B. eine Buchung eingeht oder ein Gast eine Nachricht schickt. Ohne Webhook erfährt TRIMOSA Änderungen erst beim nächsten Abruf.
              </p>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#111', marginBottom: '16px' }}>So richtest du den Webhook ein:</div>

              {[
                {
                  step: 1,
                  title: 'Smoobu öffnen',
                  text: <>Melde dich bei <a href="https://login.smoobu.com" target="_blank" rel="noreferrer" style={{ color: GOLD }}>login.smoobu.com</a> an und gehe zu <strong>Einstellungen → API</strong> (Zahnrad-Symbol oben rechts).</>,
                },
                {
                  step: 2,
                  title: 'Webhook hinzufügen',
                  text: <>Scrolle zum Abschnitt <strong>„Webhook"</strong> und klicke auf <strong>„Webhook hinzufügen"</strong> oder ähnlich.</>,
                },
                {
                  step: 3,
                  title: 'URL einfügen',
                  text: (
                    <div>
                      <p style={{ margin: '0 0 8px', color: '#444' }}>Füge folgende URL als Webhook-Ziel ein:</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#1D1D1F', borderRadius: '8px', padding: '10px 14px' }}>
                        <code style={{ fontSize: '12px', color: '#A5F3A5', flex: 1, wordBreak: 'break-all', fontFamily: 'monospace' }}>
                          {WEBHOOK_URL}
                        </code>
                        <button
                          onClick={() => navigator.clipboard.writeText(WEBHOOK_URL)}
                          style={{ padding: '4px 10px', borderRadius: '6px', border: 'none', backgroundColor: '#3A3A3A', color: '#ccc', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          Kopieren
                        </button>
                      </div>
                    </div>
                  ),
                },
                {
                  step: 4,
                  title: 'Events auswählen',
                  text: <>Aktiviere mindestens: <strong>Neue Reservierung</strong>, <strong>Reservierung geändert</strong>, <strong>Reservierung storniert</strong>, <strong>Neue Nachricht</strong>. Dann speichern.</>,
                },
              ].map(item => (
                <div key={item.step} style={{ display: 'flex', gap: '14px', marginBottom: '18px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: GOLD, color: '#fff', fontSize: '12px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {item.step}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#111', marginBottom: '4px' }}>{item.title}</div>
                    <div style={{ fontSize: '13px', color: '#555', lineHeight: 1.6 }}>{item.text}</div>
                  </div>
                </div>
              ))}

              <div style={{ backgroundColor: '#FFF9EC', border: '1px solid #F6C840', borderRadius: '10px', padding: '12px 16px', marginTop: '4px' }}>
                <p style={{ fontSize: '12px', color: '#92400E', margin: 0, lineHeight: 1.5 }}>
                  <strong>Tipp:</strong> Nach dem Speichern kannst du in Smoobu einen Test-Ping senden — TRIMOSA antwortet mit Status 200 wenn alles korrekt ist.
                </p>
              </div>
            </div>

            <button onClick={() => goToStep(4)} style={btnStyle}>Webhook eingerichtet — weiter →</button>
            <button onClick={() => goToStep(4)} style={skipStyle}>Überspringen (später einrichten)</button>
          </div>
        )}

        {/* ── Step 4: Inserate einrichten ── */}
        {step === 4 && (
          <div>
            <h1 style={h1}>Inserate einrichten</h1>
            <p style={sub}>Wähle wie du deine Wohnungen zu TRIMOSA hinzufügst.</p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '24px' }}>
              {/* Aus Smoobu importieren */}
              <div style={{ ...cardStyle, marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: '28px', marginBottom: '10px' }}>🔗</div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#111', marginBottom: '6px' }}>Aus Smoobu importieren</div>
                <p style={{ fontSize: '12px', color: '#777', lineHeight: 1.5, flex: 1, marginBottom: '14px' }}>
                  Alle deine Smoobu-Apartments werden als Inserate angelegt. Verfügbarkeit und Preise werden automatisch synchronisiert.
                </p>
                {smoobuApiKey ? (
                  <Link href="/dashboard" style={{ textDecoration: 'none' }}>
                    <button style={{ ...btnSmall, width: '100%' }}>Zum Dashboard → Sync starten</button>
                  </Link>
                ) : (
                  <button onClick={() => goToStep(2)} style={{ ...btnSmall, width: '100%', background: '#F0EDE6', color: '#666' }}>
                    Erst Smoobu verbinden (Schritt 2)
                  </button>
                )}
              </div>

              {/* Manuell erstellen */}
              <div style={{ ...cardStyle, marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: '28px', marginBottom: '10px' }}>✏️</div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#111', marginBottom: '6px' }}>Manuell erstellen</div>
                <p style={{ fontSize: '12px', color: '#777', lineHeight: 1.5, flex: 1, marginBottom: '14px' }}>
                  Erstelle Inserate direkt in TRIMOSA — ohne Smoobu. Du legst Preise, Verfügbarkeit und alle Details selbst fest.
                </p>
                <Link href="/dashboard/new-listing" style={{ textDecoration: 'none' }}>
                  <button style={{ ...btnSmall, width: '100%' }}>Neue Wohnung anlegen →</button>
                </Link>
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#111', marginBottom: '12px' }}>Egal wie du startest — das musst du pro Inserat ausfüllen:</div>
              {[
                { icon: '📸', title: 'Fotos hochladen', text: 'Professionelle Fotos erhöhen die Buchungsrate deutlich. Das Titelbild erscheint in der Suche.' },
                { icon: '📝', title: 'Beschreibung schreiben', text: 'Was macht deine Unterkunft besonders? Authentisch und konkret überzeugt Gäste.' },
                { icon: '📍', title: 'Ort & Adresse', text: 'Genaue Adresse und Lagetext damit Gäste wissen was sie erwartet.' },
                { icon: '💶', title: 'Preis festlegen', text: 'Bei manuellen Inseraten legst du den Preis direkt fest. Bei Smoobu-Inseraten kommt er aus Smoobu.' },
                { icon: '✅', title: 'Inserat aktivieren', text: 'Erst nach Aktivierung ist das Inserat öffentlich buchbar.' },
              ].map(item => (
                <div key={item.title} style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '18px' }}>{item.icon}</span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#111' }}>{item.title}</div>
                    <div style={{ fontSize: '12px', color: '#777', marginTop: '2px', lineHeight: 1.5 }}>{item.text}</div>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => goToStep(5)} style={btnStyle}>Weiter →</button>
          </div>
        )}

        {/* ── Step 5: Preisgestaltung ── */}
        {step === 5 && (
          <div>
            <h1 style={h1}>Preisgestaltung</h1>
            <p style={sub}>Deine Basispreise kommen direkt aus Smoobu. Du kannst optional einen Auf- oder Abschlag für TRIMOSA festlegen.</p>

            <div style={cardStyle}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#111', marginBottom: '12px' }}>Preisberechnung:</div>
              <div style={{ fontSize: '13px', color: '#555', lineHeight: 1.7, marginBottom: '16px' }}>
                TRIMOSA behält <strong>10 % Provision</strong> auf jede Buchung. Du entscheidest ob du diese über einen Aufschlag auf den Gastpreis umlegen möchtest.
              </div>

              <div style={{ backgroundColor: '#FFF9F0', border: '1px solid #F0E4C0', borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: GOLD, marginBottom: '10px' }}>BEISPIELRECHNUNG</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
                  <span style={{ color: '#666' }}>Smoobu Basispreis:</span>
                  <span style={{ fontWeight: 600 }}>€{exampleBase} / Nacht</span>
                  <span style={{ color: '#666' }}>Aufschlag ({pct >= 0 ? '+' : ''}{pct}%):</span>
                  <span style={{ fontWeight: 600 }}>€{exampleGuest} für den Gast</span>
                  <span style={{ color: '#666' }}>TRIMOSA Provision (10%):</span>
                  <span style={{ fontWeight: 600, color: '#E07000' }}>−€{exampleCommission}</span>
                  <span style={{ color: '#666', fontWeight: 700 }}>Deine Auszahlung:</span>
                  <span style={{ fontWeight: 800, color: '#16A34A', fontSize: '15px' }}>€{examplePayout}</span>
                </div>
              </div>

              <div style={{ fontSize: '12px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Preisanpassung für TRIMOSA</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ position: 'relative' }}>
                  <input
                    type="number" min="-50" max="50" step="0.5"
                    value={markup}
                    onChange={e => setMarkup(e.target.value)}
                    style={{ padding: '10px 32px 10px 14px', borderRadius: '10px', border: '1px solid #D2D2D7', fontSize: '14px', width: '100px', outline: 'none' }}
                  />
                  <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#999', fontSize: '13px' }}>%</span>
                </div>
                <button onClick={saveMarkup} disabled={savingMarkup} style={{ ...btnSmall, opacity: savingMarkup ? 0.6 : 1 }}>
                  {markupSaved ? '✓ Gespeichert' : 'Speichern'}
                </button>
              </div>

              <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#F0F9F4', borderRadius: '8px', border: '1px solid #BBF7D0' }}>
                <div style={{ fontSize: '12px', color: '#16A34A', lineHeight: 1.5 }}>
                  <strong>Tipp:</strong> Um die Provision neutral zu halten (du bekommst exakt deinen Smoobu-Preis), setze den Aufschlag auf <strong>+11,11 %</strong>.
                </div>
              </div>
            </div>

            <button onClick={() => goToStep(6)} style={btnStyle}>Weiter →</button>
          </div>
        )}

        {/* ── Step 6: Stornierungsbedingungen ── */}
        {step === 6 && (
          <div>
            <h1 style={h1}>Stornierungsbedingungen</h1>
            <p style={sub}>Wähle deine Standard-Stornierungsrichtlinie. Diese gilt für alle Buchungen über TRIMOSA und wird Gästen vor der Buchung angezeigt.</p>

            <div style={{ marginBottom: '20px', background: '#FFF9EC', borderRadius: '14px', padding: '14px 18px', border: '1px solid #F6C840' }}>
              <p style={{ fontSize: '13px', color: '#92400E', margin: 0 }}>
                ⚠️ <strong>Wichtig:</strong> Stornierungen werden ausschließlich über TRIMOSA abgewickelt — nicht über Smoobu.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '28px' }}>
              {CANCEL_POLICIES.map(p => (
                <label key={p.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: '14px', padding: '16px 20px', borderRadius: '14px', cursor: 'pointer',
                  border: cancelPolicy === p.id ? `2px solid ${GOLD}` : '1.5px solid #E0DDD6',
                  background: cancelPolicy === p.id ? '#FBF6EC' : '#fff',
                }}>
                  <input type="radio" name="cancel" value={p.id} checked={cancelPolicy === p.id}
                    onChange={() => setCancelPolicy(p.id)} style={{ marginTop: '3px', accentColor: GOLD }} />
                  <div>
                    <p style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: '0 0 4px' }}>{p.label}</p>
                    <p style={{ fontSize: '13px', color: '#666', margin: 0, lineHeight: 1.5 }}>{p.desc}</p>
                  </div>
                </label>
              ))}
            </div>

            <button
              onClick={async () => {
                setSavingCancel(true)
                await fetch('/api/host/billing', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ onboarding_step: 6 }),
                })
                setSavingCancel(false)
                goToStep(7)
              }}
              style={btnStyle} disabled={savingCancel}
            >
              {savingCancel ? 'Wird gespeichert…' : 'Weiter →'}
            </button>
          </div>
        )}

        {/* ── Step 7: Zahlungsdaten ── */}
        {step === 7 && (
          <div>
            <h1 style={h1}>Zahlungsdaten hinterlegen</h1>
            <p style={sub}>Damit TRIMOSA Auszahlungen vornehmen und die monatliche Provisionsrechnung ausstellen kann.</p>

            <div style={cardStyle}>
              <div style={{ display: 'grid', gap: '14px' }}>
                <FieldGroup label="Rechnungsempfänger / Firmenname *">
                  <Input value={billing.billing_name} onChange={v => setBilling(b => ({...b, billing_name: v}))} placeholder="Max Mustermann oder Musterfirma GmbH" />
                </FieldGroup>
                <FieldGroup label="Straße & Hausnummer *">
                  <Input value={billing.billing_address} onChange={v => setBilling(b => ({...b, billing_address: v}))} placeholder="Musterstraße 12" />
                </FieldGroup>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
                  <FieldGroup label="PLZ *">
                    <Input value={billing.billing_zip} onChange={v => setBilling(b => ({...b, billing_zip: v}))} placeholder="54290" />
                  </FieldGroup>
                  <FieldGroup label="Stadt *">
                    <Input value={billing.billing_city} onChange={v => setBilling(b => ({...b, billing_city: v}))} placeholder="Trier" />
                  </FieldGroup>
                </div>
                <FieldGroup label="Land">
                  <Input value={billing.billing_country} onChange={v => setBilling(b => ({...b, billing_country: v}))} placeholder="Deutschland" />
                </FieldGroup>
                <FieldGroup label="USt-ID oder Steuernummer (optional)">
                  <Input value={billing.billing_tax_id} onChange={v => setBilling(b => ({...b, billing_tax_id: v}))} placeholder="DE123456789" />
                </FieldGroup>

                <div style={{ borderTop: '1px solid #F0EDE6', paddingTop: '14px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '14px' }}>Bankverbindung für Auszahlungen</div>
                  <div style={{ display: 'grid', gap: '14px' }}>
                    <FieldGroup label="Kontoinhaber *">
                      <Input value={billing.account_holder} onChange={v => setBilling(b => ({...b, account_holder: v}))} placeholder="Max Mustermann" />
                    </FieldGroup>
                    <FieldGroup label="IBAN *">
                      <Input value={billing.iban} onChange={v => setBilling(b => ({...b, iban: v.toUpperCase().replace(/\s/g,'')}))} placeholder="DE89370400440532013000" mono />
                    </FieldGroup>
                    <FieldGroup label="BIC">
                      <Input value={billing.bic} onChange={v => setBilling(b => ({...b, bic: v.toUpperCase()}))} placeholder="COBADEFFXXX" mono />
                    </FieldGroup>
                  </div>
                </div>

                <div style={{ backgroundColor: '#F5F3EF', borderRadius: '10px', padding: '12px', fontSize: '12px', color: '#777', lineHeight: 1.5 }}>
                  🔒 Deine Bankdaten werden verschlüsselt gespeichert und ausschließlich für Auszahlungen und die Provisionsrechnung verwendet.
                </div>

                <button
                  onClick={saveBilling}
                  disabled={savingBilling || !billing.billing_name || !billing.iban}
                  style={{ ...btnStyle, marginTop: '4px', opacity: (!billing.billing_name || !billing.iban) ? 0.5 : 1 }}
                >
                  {savingBilling ? 'Speichern...' : billingSaved ? '✓ Gespeichert' : 'Daten speichern & weiter →'}
                </button>
                {billingSaved && (
                  <button onClick={() => goToStep(8)} style={{ ...btnStyle, background: '#F0FDF4', color: '#16A34A', border: '1px solid #BBF7D0' }}>
                    Zur Zusammenfassung →
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Step 8: Fertig ── */}
        {step === 8 && (
          <div>
            <div style={{ textAlign: 'center', padding: '20px 0 32px' }}>
              <div style={{ fontSize: '56px', marginBottom: '16px' }}>🎉</div>
              <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#111', letterSpacing: '-0.5px', marginBottom: '8px' }}>
                Einrichtung abgeschlossen!
              </h1>
              <p style={{ fontSize: '15px', color: '#666', maxWidth: '420px', margin: '0 auto', lineHeight: 1.6 }}>
                Dein TRIMOSA-Konto ist einsatzbereit. Aktiviere deine Inserate und empfange deine ersten Buchungen.
              </p>
            </div>

            <div style={{ display: 'grid', gap: '12px', marginBottom: '32px' }}>
              {[
                { icon: '🏠', title: 'Inserate aktivieren', desc: 'Aktiviere deine Inserate damit sie öffentlich sichtbar und buchbar sind.', href: '/dashboard' },
                { icon: '🔔', title: 'Webhook prüfen', desc: 'Sende einen Test-Ping aus Smoobu um sicherzustellen dass der Webhook aktiv ist.', action: () => goToStep(3) },
                { icon: '💶', title: 'Preisanpassung prüfen', desc: 'Stelle sicher dass dein Auf-/Abschlag korrekt eingestellt ist.', action: () => goToStep(5) },
                { icon: '📋', title: 'Zahlungsdaten aktualisieren', desc: 'Halte deine Bankverbindung für reibungslose Auszahlungen aktuell.', action: () => goToStep(7) },
              ].map(item => (
                <div key={item.title} style={{ display: 'flex', gap: '14px', padding: '16px', backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #EEEBE4' }}>
                  <span style={{ fontSize: '24px' }}>{item.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#111' }}>{item.title}</div>
                    <div style={{ fontSize: '12px', color: '#777', marginTop: '2px' }}>{item.desc}</div>
                  </div>
                  {item.href && (
                    <Link href={item.href} style={{ fontSize: '12px', color: GOLD, fontWeight: 600, textDecoration: 'none', alignSelf: 'center', whiteSpace: 'nowrap' }}>Öffnen →</Link>
                  )}
                  {item.action && (
                    <button onClick={item.action} style={{ fontSize: '12px', color: GOLD, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>Öffnen →</button>
                  )}
                </div>
              ))}
            </div>

            <Link href="/dashboard"><button style={btnStyle}>Zum Dashboard →</button></Link>
          </div>
        )}

        {/* Zurück-Button */}
        {step > 1 && step < 7 && (
          <button onClick={() => goToStep(step - 1)} style={{ ...skipStyle, marginTop: '8px' }}>← Zurück</button>
        )}
      </div>
    </div>
  )
}

/* ── Hilfkomponenten ── */
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '6px', letterSpacing: '0.02em' }}>{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input
      value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: '1px solid #D2D2D7', fontSize: '13px', outline: 'none', fontFamily: mono ? 'monospace' : 'inherit', boxSizing: 'border-box' }}
    />
  )
}

/* ── Styles ── */
const h1: React.CSSProperties = { fontSize: '26px', fontWeight: 800, color: '#111', marginBottom: '8px', letterSpacing: '-0.5px' }
const sub: React.CSSProperties = { fontSize: '15px', color: '#555', lineHeight: 1.7, marginBottom: '28px' }
const btnStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '14px', marginTop: '24px',
  background: `linear-gradient(135deg, ${GOLD}, #8A6818)`,
  color: '#fff', fontSize: '14px', fontWeight: 700, borderRadius: '12px', border: 'none', cursor: 'pointer',
}
const btnSmall: React.CSSProperties = {
  padding: '10px 18px', background: `linear-gradient(135deg, ${GOLD}, #8A6818)`,
  color: '#fff', fontSize: '13px', fontWeight: 600, borderRadius: '10px', border: 'none', cursor: 'pointer',
}
const skipStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '10px', marginTop: '8px',
  background: 'none', border: 'none', color: '#999', fontSize: '13px', cursor: 'pointer', textAlign: 'center',
}
const cardStyle: React.CSSProperties = {
  backgroundColor: '#fff', borderRadius: '14px', border: '1px solid #EEEBE4', padding: '20px', marginBottom: '8px',
}

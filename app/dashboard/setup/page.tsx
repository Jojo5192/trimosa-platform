'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const GOLD = '#A8882A'
const STEPS = [
  { id: 1, title: 'Wie TRIMOSA funktioniert', icon: '📋' },
  { id: 2, title: 'Smoobu verbinden',          icon: '🔗' },
  { id: 3, title: 'Inserate einrichten',        icon: '🏠' },
  { id: 4, title: 'Preisgestaltung',            icon: '💶' },
  { id: 5, title: 'Zahlungsdaten',              icon: '🏦' },
  { id: 6, title: 'Fertig!',                    icon: '✅' },
]

export default function SetupPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [apiKey, setApiKey] = useState('')
  const [markup, setMarkup] = useState('0')
  const [syncing, setSyncing] = useState(false)
  const [syncDone, setSyncDone] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [billing, setBilling] = useState({
    billing_name: '', billing_address: '', billing_city: '', billing_zip: '',
    billing_country: 'Deutschland', billing_tax_id: '', iban: '', bic: '', account_holder: '',
  })
  const [savingBilling, setSavingBilling] = useState(false)
  const [billingSaved, setBillingSaved] = useState(false)
  const [savingMarkup, setSavingMarkup] = useState(false)
  const [markupSaved, setMarkupSaved] = useState(false)

  // Load current values
  useEffect(() => {
    fetch('/api/host/billing').then(r => r.json()).then(d => {
      if (d.billing_name) setBilling(b => ({ ...b, ...d }))
      if (d.onboarding_step) setStep(Math.max(1, d.onboarding_step))
    })
    fetch('/api/settings').then(r => r.json()).then(d => {
      if (d.platform_markup_pct !== undefined) setMarkup(String(d.platform_markup_pct))
    })
  }, [])

  async function saveApiKey() {
    if (!apiKey.trim()) return
    setSavingKey(true)
    await fetch('/api/smoobu/sync', { method: 'POST' }) // will use env key or metadata
    setSavingKey(false)
  }

  async function runSync() {
    setSyncing(true)
    const res = await fetch('/api/smoobu/sync', { method: 'POST' })
    const data = await res.json()
    setSyncMsg(data.message ?? 'Sync abgeschlossen')
    setSyncDone(true)
    setSyncing(false)
  }

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
      body: JSON.stringify({ ...billing, onboarding_step: 6 }),
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

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#FAFAF8', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#fff', borderBottom: '1px solid #EEEBE4', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/dashboard" style={{ textDecoration: 'none', color: '#666', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          ← Zurück zum Dashboard
        </Link>
        <span style={{ fontSize: '13px', fontWeight: 600, color: GOLD }}>TRIMOSA Einrichtung</span>
      </div>

      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '32px 20px' }}>

        {/* Progress Bar */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '36px' }}>
          {STEPS.map(s => (
            <div key={s.id} style={{ flex: 1, height: '4px', borderRadius: '2px', backgroundColor: step >= s.id ? GOLD : '#E8E4DB', transition: 'background 0.3s' }} />
          ))}
        </div>

        {/* Step indicator */}
        <div style={{ fontSize: '12px', fontWeight: 600, color: GOLD, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px' }}>
          Schritt {step} von {STEPS.length} — {STEPS[step - 1].icon} {STEPS[step - 1].title}
        </div>

        {/* ── Step 1: Wie es funktioniert ── */}
        {step === 1 && (
          <div>
            <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#111', marginBottom: '8px', letterSpacing: '-0.5px' }}>
              Willkommen bei TRIMOSA
            </h1>
            <p style={{ fontSize: '15px', color: '#555', lineHeight: 1.7, marginBottom: '32px' }}>
              Bevor wir loslegen, hier ein kurzer Überblick wie die Zusammenarbeit funktioniert.
            </p>

            {[
              {
                icon: '💶', title: 'Deine Preise, deine Kontrolle',
                text: 'Du pflegst deine Preise wie gewohnt in Smoobu. TRIMOSA synchronisiert sie automatisch — kein doppelter Aufwand.',
              },
              {
                icon: '📊', title: '10 % Provision pro Buchung',
                text: 'TRIMOSA behält 10 % der Buchungssumme als Provision. Der Rest wird dir am Tag des Check-Ins auf dein Konto überwiesen. Du entscheidest selbst, ob du die Provision über einen Preisaufschlag auf den Gast umlegen möchtest.',
              },
              {
                icon: '🧾', title: 'Monatliche Sammelrechnung',
                text: 'Du erhältst einmal im Monat eine Rechnung über alle angefallenen Provisionen — nicht pro Buchung. Das hält den Aufwand klein.',
              },
              {
                icon: '📦', title: '7 % USt. inklusive',
                text: 'Die Mehrwertsteuer (7 %) ist bereits in der Buchungssumme enthalten und wird nicht extra aufgeschlagen. Smoobu übernimmt das.',
              },
              {
                icon: '🔄', title: 'Smoobu bleibt dein Channel Manager',
                text: 'Buchungen über TRIMOSA landen automatisch in deinem Smoobu-Kalender und blockieren die Verfügbarkeit auf allen anderen Kanälen.',
              },
            ].map(item => (
              <div key={item.title} style={{ display: 'flex', gap: '16px', padding: '16px 0', borderBottom: '1px solid #F0EDE6' }}>
                <div style={{ fontSize: '24px', flexShrink: 0, width: '36px', textAlign: 'center' }}>{item.icon}</div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#111', marginBottom: '4px' }}>{item.title}</div>
                  <div style={{ fontSize: '13px', color: '#666', lineHeight: 1.6 }}>{item.text}</div>
                </div>
              </div>
            ))}

            <button onClick={() => goToStep(2)} style={btnStyle}>
              Verstanden — weiter →
            </button>
          </div>
        )}

        {/* ── Step 2: Smoobu verbinden ── */}
        {step === 2 && (
          <div>
            <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#111', marginBottom: '8px', letterSpacing: '-0.5px' }}>
              Smoobu verbinden
            </h1>
            <p style={{ fontSize: '15px', color: '#555', lineHeight: 1.7, marginBottom: '28px' }}>
              Verbinde dein Smoobu-Konto damit TRIMOSA Verfügbarkeiten, Preise und Buchungen synchronisieren kann.
            </p>

            <div style={cardStyle}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#111', marginBottom: '16px' }}>So findest du deinen API Key:</div>
              {['Melde dich bei login.smoobu.com an', 'Gehe zu Einstellungen → API', 'Kopiere den API Key und füge ihn hier ein'].map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: GOLD, color: '#fff', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</div>
                  <span style={{ fontSize: '13px', color: '#444', lineHeight: 1.5 }}>{t}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '24px', padding: '20px', backgroundColor: '#F5F3EF', borderRadius: '12px', border: '1px solid #E8E4DB' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#888', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Dein Smoobu API Key</div>
              <p style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
                Der API Key ist bereits in unserem System hinterlegt (du hast ihn beim Registrieren angegeben). Klicke direkt auf „Apartments importieren".
              </p>
              <button
                onClick={runSync}
                disabled={syncing || syncDone}
                style={{ ...btnStyle, marginTop: 0, opacity: syncDone ? 0.6 : 1 }}
              >
                {syncing ? '⏳ Importiere...' : syncDone ? `✓ ${syncMsg}` : '🔄 Apartments aus Smoobu importieren'}
              </button>
            </div>

            {syncDone && (
              <button onClick={() => goToStep(3)} style={{ ...btnStyle, marginTop: '16px' }}>
                Weiter →
              </button>
            )}
            <button onClick={() => goToStep(3)} style={skipStyle}>Überspringen</button>
          </div>
        )}

        {/* ── Step 3: Inserate einrichten ── */}
        {step === 3 && (
          <div>
            <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#111', marginBottom: '8px', letterSpacing: '-0.5px' }}>
              Inserate einrichten
            </h1>
            <p style={{ fontSize: '15px', color: '#555', lineHeight: 1.7, marginBottom: '24px' }}>
              Deine Apartments wurden importiert. Jetzt kannst du jeden Eintrag mit Fotos, Beschreibung und Lage vervollständigen und anschließend aktivieren.
            </p>

            <div style={cardStyle}>
              {[
                { icon: '📸', title: 'Fotos hochladen', text: 'Lade professionelle Fotos hoch. Das Titelbild erscheint auf der Startseite.' },
                { icon: '📝', title: 'Beschreibung schreiben', text: 'Erkläre was deine Unterkunft besonders macht. Authentisch & konkret überzeugt.' },
                { icon: '📍', title: 'Ort & Lage angeben', text: 'Füge die genaue Adresse und einen kurzen Lagetext hinzu.' },
                { icon: '✅', title: 'Inserat aktivieren', text: 'Erst wenn du aktivierst, ist das Inserat öffentlich sichtbar und buchbar.' },
              ].map(item => (
                <div key={item.title} style={{ display: 'flex', gap: '12px', marginBottom: '14px' }}>
                  <span style={{ fontSize: '20px' }}>{item.icon}</span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#111' }}>{item.title}</div>
                    <div style={{ fontSize: '12px', color: '#777', marginTop: '2px' }}>{item.text}</div>
                  </div>
                </div>
              ))}
            </div>

            <Link href="/dashboard" style={{ display: 'block', textDecoration: 'none' }}>
              <button style={btnStyle}>Zum Dashboard → Inserate bearbeiten</button>
            </Link>
            <button onClick={() => goToStep(4)} style={skipStyle}>Weiter zu Schritt 4</button>
          </div>
        )}

        {/* ── Step 4: Preisgestaltung ── */}
        {step === 4 && (
          <div>
            <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#111', marginBottom: '8px', letterSpacing: '-0.5px' }}>
              Preisgestaltung
            </h1>
            <p style={{ fontSize: '15px', color: '#555', lineHeight: 1.7, marginBottom: '24px' }}>
              Deine Basispreise kommen direkt aus Smoobu. Du kannst optional einen Auf- oder Abschlag für TRIMOSA festlegen.
            </p>

            <div style={cardStyle}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#111', marginBottom: '12px' }}>So funktioniert die Preisberechnung:</div>
              <div style={{ fontSize: '13px', color: '#555', lineHeight: 1.7, marginBottom: '16px' }}>
                TRIMOSA behält <strong>10 % Provision</strong> auf jede Buchung. Du entscheidest selbst ob du diese Provision über einen Aufschlag auf den Gastpreis umlegen möchtest.
              </div>

              <div style={{ backgroundColor: '#FFF9F0', border: '1px solid #F0E4C0', borderRadius: '10px', padding: '16px', marginBottom: '20px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: GOLD, marginBottom: '10px' }}>BEISPIELRECHNUNG</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
                  <span style={{ color: '#666' }}>Smoobu Basispreis:</span>
                  <span style={{ fontWeight: 600 }}>€{exampleBase} / Nacht</span>
                  <span style={{ color: '#666' }}>Dein Aufschlag ({pct >= 0 ? '+' : ''}{pct}%):</span>
                  <span style={{ fontWeight: 600 }}>€{exampleGuest} für den Gast</span>
                  <span style={{ color: '#666' }}>TRIMOSA Provision (10%):</span>
                  <span style={{ fontWeight: 600, color: '#E07000' }}>−€{exampleCommission}</span>
                  <span style={{ color: '#666', fontWeight: 700 }}>Deine Auszahlung:</span>
                  <span style={{ fontWeight: 800, color: '#16A34A', fontSize: '15px' }}>€{examplePayout}</span>
                </div>
              </div>

              <div style={{ fontSize: '12px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                Preisanpassung für TRIMOSA
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ position: 'relative' }}>
                  <input
                    type="number"
                    min="-50" max="50" step="0.5"
                    value={markup}
                    onChange={e => setMarkup(e.target.value)}
                    style={{ padding: '10px 32px 10px 14px', borderRadius: '10px', border: '1px solid #D2D2D7', fontSize: '14px', width: '100px', outline: 'none' }}
                  />
                  <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#999', fontSize: '13px' }}>%</span>
                </div>
                <button onClick={saveMarkup} disabled={savingMarkup} style={{ ...btnSmall, opacity: savingMarkup ? 0.6 : 1 }}>
                  {markupSaved ? '✓ Gespeichert' : 'Speichern'}
                </button>
                <span style={{ fontSize: '12px', color: '#888' }}>
                  {pct === 0 ? 'Kein Aufschlag — du trägst die 10 % selbst' : pct > 0 ? `Gast zahlt €${exampleGuest} statt €${exampleBase}` : `Gast zahlt €${exampleGuest} statt €${exampleBase}`}
                </span>
              </div>

              <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#F0F9F4', borderRadius: '8px', border: '1px solid #BBF7D0' }}>
                <div style={{ fontSize: '12px', color: '#16A34A', lineHeight: 1.5 }}>
                  <strong>Tipp:</strong> Um die 10 % Provision neutral zu halten (du bekommst genau deinen Smoobu-Preis), setze den Aufschlag auf <strong>+11,11 %</strong>. Dann zahlt der Gast mehr, und nach Abzug der 10 % landest du exakt beim Basispreis.
                </div>
              </div>
            </div>

            <button onClick={() => goToStep(5)} style={btnStyle}>Weiter →</button>
          </div>
        )}

        {/* ── Step 5: Zahlungsdaten ── */}
        {step === 5 && (
          <div>
            <h1 style={{ fontSize: '26px', fontWeight: 800, color: '#111', marginBottom: '8px', letterSpacing: '-0.5px' }}>
              Zahlungsdaten hinterlegen
            </h1>
            <p style={{ fontSize: '15px', color: '#555', lineHeight: 1.7, marginBottom: '24px' }}>
              Damit TRIMOSA deine Auszahlungen vornehmen und die monatliche Provisionsrechnung ausstellen kann, benötigen wir folgende Angaben.
            </p>

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

                <div style={{ borderTop: '1px solid #F0EDE6', paddingTop: '14px', marginTop: '4px' }}>
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
                  🔒 Deine Bankdaten werden verschlüsselt gespeichert und ausschließlich für Auszahlungen und die Erstellung der monatlichen Provisionsrechnung verwendet.
                </div>

                <button
                  onClick={saveBilling}
                  disabled={savingBilling || !billing.billing_name || !billing.iban}
                  style={{ ...btnStyle, marginTop: '4px', opacity: (!billing.billing_name || !billing.iban) ? 0.5 : 1 }}
                >
                  {savingBilling ? 'Speichern...' : billingSaved ? '✓ Gespeichert' : 'Daten speichern & weiter →'}
                </button>
                {billingSaved && (
                  <button onClick={() => goToStep(6)} style={{ ...btnStyle, backgroundColor: '#F0FDF4', color: '#16A34A', border: '1px solid #BBF7D0' }}>
                    Zur Zusammenfassung →
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Step 6: Fertig ── */}
        {step === 6 && (
          <div>
            <div style={{ textAlign: 'center', padding: '20px 0 32px' }}>
              <div style={{ fontSize: '56px', marginBottom: '16px' }}>🎉</div>
              <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#111', letterSpacing: '-0.5px', marginBottom: '8px' }}>
                Einrichtung abgeschlossen!
              </h1>
              <p style={{ fontSize: '15px', color: '#666', maxWidth: '420px', margin: '0 auto', lineHeight: 1.6 }}>
                Dein TRIMOSA-Konto ist einsatzbereit. Aktiviere deine Inserate und empfange deine ersten direkten Buchungen.
              </p>
            </div>

            <div style={{ display: 'grid', gap: '12px', marginBottom: '32px' }}>
              {[
                { icon: '🏠', title: 'Inserate aktivieren', desc: 'Gehe zum Dashboard und aktiviere deine Inserate damit sie öffentlich sichtbar sind.', href: '/dashboard' },
                { icon: '💶', title: 'Preisanpassung prüfen', desc: 'Stelle sicher dass dein Auf-/Abschlag korrekt eingestellt ist.', href: '/dashboard' },
                { icon: '📋', title: 'Zahlungsdaten aktualisieren', desc: 'Halte deine Bankverbindung aktuell für reibungslose Auszahlungen.', action: () => goToStep(5) },
              ].map(item => (
                <div key={item.title} style={{ display: 'flex', gap: '14px', padding: '16px', backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #EEEBE4' }}>
                  <span style={{ fontSize: '24px' }}>{item.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#111' }}>{item.title}</div>
                    <div style={{ fontSize: '12px', color: '#777', marginTop: '2px' }}>{item.desc}</div>
                  </div>
                  {item.href && (
                    <Link href={item.href} style={{ fontSize: '12px', color: GOLD, fontWeight: 600, textDecoration: 'none', alignSelf: 'center', whiteSpace: 'nowrap' }}>
                      Öffnen →
                    </Link>
                  )}
                  {item.action && (
                    <button onClick={item.action} style={{ fontSize: '12px', color: GOLD, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      Öffnen →
                    </button>
                  )}
                </div>
              ))}
            </div>

            <Link href="/dashboard">
              <button style={btnStyle}>Zum Dashboard →</button>
            </Link>
          </div>
        )}

        {/* Navigation dots */}
        {step < 6 && step > 1 && (
          <button onClick={() => goToStep(step - 1)} style={{ ...skipStyle, marginTop: '8px' }}>
            ← Zurück
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Small reusable components ── */
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
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', padding: '10px 14px', borderRadius: '10px',
        border: '1px solid #D2D2D7', fontSize: '13px', outline: 'none',
        fontFamily: mono ? 'monospace' : 'inherit', boxSizing: 'border-box',
      }}
    />
  )
}

/* ── Styles ── */
const GOLD = '#A8882A'
const btnStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '14px', marginTop: '24px',
  background: `linear-gradient(135deg, ${GOLD}, #8A6818)`,
  color: '#fff', fontSize: '14px', fontWeight: 700,
  borderRadius: '12px', border: 'none', cursor: 'pointer',
  letterSpacing: '0.02em',
}
const btnSmall: React.CSSProperties = {
  padding: '10px 18px', background: `linear-gradient(135deg, ${GOLD}, #8A6818)`,
  color: '#fff', fontSize: '13px', fontWeight: 600,
  borderRadius: '10px', border: 'none', cursor: 'pointer',
}
const skipStyle: React.CSSProperties = {
  display: 'block', width: '100%', padding: '10px', marginTop: '8px',
  background: 'none', border: 'none', color: '#999', fontSize: '13px',
  cursor: 'pointer', textAlign: 'center',
}
const cardStyle: React.CSSProperties = {
  backgroundColor: '#fff', borderRadius: '14px',
  border: '1px solid #EEEBE4', padding: '20px',
  marginBottom: '8px',
}

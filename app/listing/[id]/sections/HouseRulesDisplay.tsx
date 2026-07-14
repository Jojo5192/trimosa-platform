'use client'


/* ── 5. House Rules Display (structured Airbnb-style) ──────── */
interface HouseRules {
  pets_allowed?: boolean
  events_allowed?: boolean
  smoking_allowed?: boolean
  quiet_hours?: boolean
  quiet_start?: string
  quiet_end?: string
  commercial_photo?: boolean
  max_guests?: number
  additional_rules?: string
}

export function HouseRulesDisplay({ rules, checkIn, checkOut, legacyText }: {
  rules: HouseRules; checkIn?: string; checkOut?: string; legacyText?: string
}) {
  const hasStructured = rules.pets_allowed !== undefined || rules.quiet_hours || rules.max_guests || rules.additional_rules
  if (!hasStructured && !legacyText) return null

  const items: { emoji: string; label: string; value: string }[] = []
  if (rules.max_guests) items.push({ emoji: '👥', label: 'Maximale Gästeanzahl', value: `${rules.max_guests} Gäste` })
  if (checkIn) items.push({ emoji: '🕐', label: 'Check-in', value: `ab ${checkIn} Uhr` })
  if (checkOut) items.push({ emoji: '🕐', label: 'Check-out', value: `bis ${checkOut} Uhr` })
  items.push({ emoji: '🐾', label: 'Haustiere', value: rules.pets_allowed ? 'Erlaubt' : 'Nicht erlaubt' })
  items.push({ emoji: '🎉', label: 'Veranstaltungen', value: rules.events_allowed ? 'Erlaubt' : 'Nicht erlaubt' })
  items.push({ emoji: '🚬', label: 'Rauchen', value: rules.smoking_allowed ? 'Erlaubt' : 'Nicht erlaubt' })
  items.push({ emoji: '📸', label: 'Kommerzielles Fotografieren', value: rules.commercial_photo ? 'Erlaubt' : 'Nicht erlaubt' })
  if (rules.quiet_hours) {
    items.push({ emoji: '🤫', label: 'Ruhezeiten', value: `${rules.quiet_start ?? '22:00'} – ${rules.quiet_end ?? '07:00'}` })
  }

  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#1D1D1F', marginBottom: '10px' }}>Hausregeln</h2>
      {hasStructured ? (
        <div>
          {items.map((item, i) => (
            <div key={item.label} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0',
              borderBottom: i < items.length - 1 ? '1px solid #F0EEE8' : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>{item.emoji}</span>
                <span style={{ fontSize: '13px', color: '#6E6E73' }}>{item.label}</span>
              </div>
              <span style={{ fontSize: '12px', fontWeight: 600, color: item.value.includes('Nicht') ? '#DC2626' : '#1D1D1F' }}>
                {item.value}
              </span>
            </div>
          ))}
          {rules.additional_rules && (
            <div style={{ paddingTop: '10px', marginTop: '6px', borderTop: '1px solid #F0EEE8' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#999', marginBottom: '4px' }}>Zusätzliche Regeln</div>
              <p style={{ fontSize: '13px', lineHeight: 1.6, color: '#6E6E73', whiteSpace: 'pre-line', margin: 0 }}>
                {rules.additional_rules}
              </p>
            </div>
          )}
        </div>
      ) : legacyText ? (
        <p style={{ fontSize: '13px', lineHeight: 1.7, color: '#6E6E73', whiteSpace: 'pre-line', margin: 0 }}>
          {legacyText}
        </p>
      ) : null}
    </div>
  )
}

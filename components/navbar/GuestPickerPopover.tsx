'use client'

/* ─── Guest Picker Popover ────────────────────────────── */
export default function GuestPickerPopover({
  adults, children: kids, onChangeAdults, onChangeKids, onClose
}: {
  adults: number; children: number
  onChangeAdults: (n: number) => void
  onChangeKids: (n: number) => void
  onClose: () => void
}) {
  function Counter({ label, sub, value, onChange, min = 0 }: { label: string; sub: string; value: number; onChange: (n: number) => void; min?: number }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 0', borderBottom: '1px solid #F2F0EC' }}>
        <div>
          <p style={{ fontSize: '14px', fontWeight: 500, color: '#111', margin: 0 }}>{label}</p>
          <p style={{ fontSize: '12px', color: '#888', margin: '2px 0 0' }}>{sub}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            type="button"
            onClick={() => onChange(Math.max(min, value - 1))}
            disabled={value <= min}
            style={{
              width: 28, height: 28, borderRadius: '50%', border: '1.5px solid',
              borderColor: value <= min ? '#DDD' : '#888',
              background: 'none', cursor: value <= min ? 'default' : 'pointer',
              fontSize: '16px', color: value <= min ? '#CCC' : '#333',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1,
            }}
          >−</button>
          <span style={{ fontSize: '14px', fontWeight: 500, color: '#111', width: '16px', textAlign: 'center' }}>{value}</span>
          <button
            type="button"
            onClick={() => onChange(Math.min(16, value + 1))}
            style={{
              width: 28, height: 28, borderRadius: '50%', border: '1.5px solid #888',
              background: 'none', cursor: 'pointer', fontSize: '16px', color: '#333',
              display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
            }}
          >+</button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 12px)',
        right: 0,
        width: '300px',
        backgroundColor: '#fff',
        borderRadius: '24px',
        padding: '8px 24px 20px',
        boxShadow: '0 16px 48px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)',
        zIndex: 100,
      }}
    >
      <Counter label="Erwachsene" sub="Ab 13 Jahren" value={adults} onChange={onChangeAdults} min={1} />
      <Counter label="Kinder" sub="2–12 Jahre" value={kids} onChange={onChangeKids} />
      <button
        type="button"
        onClick={onClose}
        style={{ display: 'block', width: '100%', marginTop: '16px', fontSize: '13px', fontWeight: 600, color: '#fff', background: 'linear-gradient(135deg, var(--gold), var(--gold))', border: 'none', borderRadius: '999px', padding: '10px', cursor: 'pointer' }}
      >
        Fertig
      </button>
    </div>
  )
}

'use client'

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '60px 20px', textAlign: 'center' }}>
      <p style={{ fontSize: '32px', marginBottom: '16px' }}>💬</p>
      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#111', margin: '0 0 8px' }}>
        Chat konnte nicht geladen werden
      </h2>
      <p style={{ fontSize: '13px', color: '#888', margin: '0 0 24px' }}>
        {error.message || 'Ein unbekannter Fehler ist aufgetreten.'}
      </p>
      <button
        onClick={reset}
        style={{
          padding: '12px 28px', borderRadius: '999px', border: 'none',
          background: 'linear-gradient(135deg, #C4A235, #8A6818)',
          color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer',
        }}
      >
        Erneut versuchen
      </button>
    </div>
  )
}

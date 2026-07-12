import NavBar from '@/components/NavBar'

/**
 * Shared, readable layout for the legal pages (Impressum / AGB /
 * Datenschutz). Keeps typography and spacing consistent across all three.
 */
export default function LegalShell({
  title,
  updated,
  children,
}: {
  title: string
  updated?: string
  children: React.ReactNode
}) {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <NavBar />
      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '40px 20px 96px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#1D1D1F', letterSpacing: '-0.4px', margin: '0 0 8px' }}>
          {title}
        </h1>
        {updated && (
          <p style={{ fontSize: '12px', color: '#9A968E', margin: '0 0 32px' }}>Stand: {updated}</p>
        )}
        <div className="legal-body" style={{ fontSize: '14px', lineHeight: 1.75, color: '#3A3A3C' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

/* ── Small building blocks so the three pages read uniformly ── */

export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '28px' }}>
      <h2 style={{ fontSize: '17px', fontWeight: 700, color: '#1D1D1F', margin: '0 0 10px' }}>{heading}</h2>
      {children}
    </section>
  )
}

export function LegalP({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: '0 0 12px' }}>{children}</p>
}

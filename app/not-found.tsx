import Link from 'next/link'
import NavBar from '@/components/NavBar'

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <NavBar />
      <div style={{
        minHeight: 'calc(100vh - 88px)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: '16px', padding: '20px', textAlign: 'center',
      }}>
        <span style={{ fontSize: '48px' }}>🧭</span>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1D1D1F', margin: 0 }}>
          Diese Seite gibt es nicht
        </h1>
        <p style={{ fontSize: '14px', color: '#6E6E73', margin: 0, maxWidth: '360px' }}>
          Der Link ist vielleicht veraltet, oder die Seite wurde verschoben.
        </p>
        <Link href="/" style={{
          marginTop: '8px', fontSize: '13px', fontWeight: 600, padding: '10px 22px',
          borderRadius: '999px', color: '#fff',
          background: 'linear-gradient(135deg, var(--gold), var(--gold-dark))',
          textDecoration: 'none',
        }}>
          ← Zurück zur Übersicht
        </Link>
      </div>
    </div>
  )
}

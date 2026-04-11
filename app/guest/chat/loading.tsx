export default function ChatLoading() {
  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '24px 20px 40px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 130px)' }}>
      <div style={{ textAlign: 'center', color: '#AAA' }}>
        <p style={{ fontSize: '28px', marginBottom: '10px' }}>💬</p>
        <p style={{ fontSize: '13px' }}>Chat wird geladen…</p>
      </div>
    </div>
  )
}

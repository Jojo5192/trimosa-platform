'use client'

import { useState } from 'react'

export default function InvoiceDownload({ month, monthLabel }: { month: string; monthLabel: string }) {
  const [loading, setLoading] = useState(false)

  async function download() {
    setLoading(true)
    const res = await fetch(`/api/host/invoices?month=${month}`)
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `TRIMOSA-Rechnung-${month}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } else {
      alert('Download fehlgeschlagen. Bitte versuche es später erneut.')
    }
    setLoading(false)
  }

  return (
    <button
      onClick={download}
      disabled={loading}
      style={{
        fontSize: '12px', fontWeight: 600, padding: '7px 14px',
        borderRadius: '99px', border: '1.5px solid #E0DDD6',
        background: '#fff', color: '#555', cursor: loading ? 'wait' : 'pointer',
        display: 'flex', alignItems: 'center', gap: '6px',
      }}
    >
      {loading ? '…' : '⬇ PDF'}
    </button>
  )
}

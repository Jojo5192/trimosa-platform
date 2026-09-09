import React from 'react'

// URLs im Nachrichtentext klickbar machen (z. B. Gästemappe-Link aus einer
// Auto-Nachricht). Fresh-Regex je Aufruf (kein globaler lastIndex-Zustand);
// nachlaufende Satzzeichen bleiben Text.
export function linkify(text: string, isMe: boolean): React.ReactNode {
  if (!text) return text
  const re = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    let url = m[0]
    const trail = url.match(/[.,;:!?]+$/)
    const tail = trail ? trail[0] : ''
    if (tail) url = url.slice(0, -tail.length)
    const href = url.startsWith('http') ? url : `https://${url}`
    out.push(
      <a key={m.index} href={href} target="_blank" rel="noreferrer" style={{
        color: isMe ? '#EAF2FF' : '#0A66C2', textDecoration: 'underline', wordBreak: 'break-all',
      }}>{url}</a>
    )
    if (tail) out.push(tail)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out.length ? out : text
}

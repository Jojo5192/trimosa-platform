import NavBar from '@/components/NavBar'
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { getUiLang } from '@/lib/i18n-server'
import { makeTr } from '@/lib/static-translate'
import type { UiLang } from '@/lib/i18n'

/**
 * Shared, readable layout for the legal pages (Impressum / AGB / Datenschutz).
 * Non-German visitors get an AI translation of the ENTIRE page content
 * (generic React-tree walk, cached via static_translations) plus a banner
 * stating that the German version is the legally binding one.
 */

const DISCLAIMER: Record<Exclude<UiLang, 'de'>, string> = {
  en: 'Automatic translation for your convenience — the German version is legally binding.',
  fr: 'Traduction automatique pour votre confort — la version allemande fait foi juridiquement.',
  nl: 'Automatische vertaling voor uw gemak — de Duitse versie is juridisch bindend.',
}
const UPDATED_LABEL: Record<UiLang, string> = { de: 'Stand:', en: 'Last updated:', fr: 'Version du :', nl: 'Stand:' }

function collectStrings(node: ReactNode, out: string[]) {
  if (typeof node === 'string') {
    if (node.trim().length > 1) out.push(node)
  } else if (Array.isArray(node)) {
    node.forEach((n) => collectStrings(n, out))
  } else if (isValidElement(node)) {
    const p = node.props as { heading?: unknown; children?: ReactNode }
    if (typeof p.heading === 'string') out.push(p.heading)
    collectStrings(p.children, out)
  }
}

function applyTr(node: ReactNode, T: (s: string) => string): ReactNode {
  if (typeof node === 'string') return node.trim().length > 1 ? T(node) : node
  if (Array.isArray(node)) return node.map((n, i) => {
    const r = applyTr(n, T)
    return isValidElement(r) && r.key == null ? cloneElement(r as ReactElement, { key: i }) : r
  })
  if (isValidElement(node)) {
    const p = node.props as { heading?: unknown; children?: ReactNode }
    const extra: Record<string, unknown> = {}
    if (typeof p.heading === 'string') extra.heading = T(p.heading)
    if (p.children === undefined) {
      return Object.keys(extra).length ? cloneElement(node, extra) : node
    }
    return cloneElement(node, extra, applyTr(p.children, T))
  }
  return node
}

export default async function LegalShell({
  title,
  updated,
  children,
}: {
  title: string
  updated?: string
  children: React.ReactNode
}) {
  const lang = await getUiLang()
  let heading = title
  let content: ReactNode = children
  if (lang !== 'de') {
    const texts: string[] = [title]
    collectStrings(children, texts)
    const T = await makeTr(lang, texts)
    heading = T(title)
    content = applyTr(children, T)
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F5F5F7' }}>
      <NavBar lang={lang} />
      <div style={{ maxWidth: '760px', margin: '0 auto', padding: '40px 20px 96px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#1D1D1F', letterSpacing: '-0.4px', margin: '0 0 8px' }}>
          {heading}
        </h1>
        {updated && (
          <p style={{ fontSize: '12px', color: '#9A968E', margin: '0 0 12px' }}>{UPDATED_LABEL[lang]} {updated}</p>
        )}
        {lang !== 'de' && (
          <div style={{
            margin: '0 0 28px', padding: '10px 14px', borderRadius: '10px', fontSize: '12.5px',
            background: '#FDF6E3', border: '1px solid #F0E0A0', color: '#8A6D1E', lineHeight: 1.5,
          }}>
            🌐 {DISCLAIMER[lang as Exclude<UiLang, 'de'>]}
          </div>
        )}
        <div className="legal-body" style={{ fontSize: '14px', lineHeight: 1.75, color: '#3A3A3C' }}>
          {content}
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

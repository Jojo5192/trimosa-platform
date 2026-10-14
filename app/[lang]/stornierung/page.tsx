import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import StornierungPage, { metadata as rootMetadata } from '@/app/stornierung/page'
import { isUiLang } from '@/lib/i18n'
import { legalAlternates } from '@/lib/legal-meta'
import { makeTr } from '@/lib/static-translate'

// Erstbesuch je Sprache übersetzt die Seite per KI (wie die Root-Seite)
export const maxDuration = 120

/** Sprachpfad /en|fr|nl/stornierung — dünner Wrapper (Audit 14.10.2026: Rechtsseiten hatten keine Sprach-URLs). */
type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params
  if (!isUiLang(lang) || lang === 'de') return {}
  const title = String(rootMetadata.title ?? '')
  const description = String(rootMetadata.description ?? '')
  const tr = await makeTr(lang, [title, description])
  return { ...rootMetadata, title: tr(title), description: tr(description), alternates: legalAlternates('/stornierung', lang) }
}

export default async function LangStornierungPage({ params }: Props) {
  const { lang } = await params
  if (!isUiLang(lang) || lang === 'de') notFound()
  return StornierungPage({ searchParams: Promise.resolve({ lang }) })
}

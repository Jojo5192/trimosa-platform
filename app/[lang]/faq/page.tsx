import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import FaqPage, { generateMetadata as rootGenerateMetadata } from '@/app/faq/page'

/** §173-Jupas ④ Etappe 3: /en|fr|nl/faq — dünner Wrapper (Listing-Muster). */
const LANGS = ['en', 'fr', 'nl'] as const
type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params
  if (!(LANGS as readonly string[]).includes(lang)) return {}
  return rootGenerateMetadata({ searchParams: Promise.resolve({ lang }) })
}

export default async function LangFaqPage({ params }: Props) {
  const { lang } = await params
  if (!(LANGS as readonly string[]).includes(lang)) notFound()
  return FaqPage({ searchParams: Promise.resolve({ lang }) })
}

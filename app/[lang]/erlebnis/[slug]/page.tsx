import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import ErlebnisPage, { generateMetadata as rootGenerateMetadata } from '@/app/erlebnis/[slug]/page'

/** §173-Jupas ④ Etappe 2: /en|fr|nl/erlebnis/<slug> — dünner Wrapper (Listing-Muster). */
const LANGS = ['en', 'fr', 'nl'] as const
type Props = { params: Promise<{ lang: string; slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params
  if (!(LANGS as readonly string[]).includes(lang)) return {}
  return rootGenerateMetadata({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({ lang }) })
}

export default async function LangErlebnisPage({ params }: Props) {
  const { lang, slug } = await params
  if (!(LANGS as readonly string[]).includes(lang)) notFound()
  return ErlebnisPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({ lang }) })
}

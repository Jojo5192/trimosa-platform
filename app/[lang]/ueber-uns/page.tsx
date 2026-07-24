import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import UeberUnsPage, { generateMetadata as rootGenerateMetadata } from '@/app/ueber-uns/page'

/** §173-Jupas ④ Etappe 2: /en|fr|nl/ueber-uns — dünner Wrapper (Listing-Muster). */
const LANGS = ['en', 'fr', 'nl'] as const
type Props = { params: Promise<{ lang: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params
  if (!(LANGS as readonly string[]).includes(lang)) return {}
  return rootGenerateMetadata({ searchParams: Promise.resolve({ lang }) })
}

export default async function LangUeberUnsPage({ params }: Props) {
  const { lang } = await params
  if (!(LANGS as readonly string[]).includes(lang)) notFound()
  return UeberUnsPage({ searchParams: Promise.resolve({ lang }) })
}

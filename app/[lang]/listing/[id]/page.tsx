import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import ListingPage, { generateMetadata as rootGenerateMetadata } from '@/app/listing/[id]/page'

/**
 * §173-Jupas ④ (Etappe 1): echte Sprachpfade — /en|fr|nl/listing/<slug>
 * rendert die bestehende Listing-Seite in der jeweiligen Sprache (dünner
 * Wrapper: delegiert an die Root-Seite mit synthetischem ?lang=). Damit
 * werden die übersetzten Inserate für Google unter eigenen URLs indexierbar
 * (hreflang-Cluster zeigt auf diese Pfade).
 */
const LANGS = ['en', 'fr', 'nl'] as const

type Props = { params: Promise<{ lang: string; id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, id } = await params
  if (!(LANGS as readonly string[]).includes(lang)) return {}
  return rootGenerateMetadata({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({ lang }),
  })
}

export default async function LangListingPage({ params }: Props) {
  const { lang, id } = await params
  if (!(LANGS as readonly string[]).includes(lang)) notFound()
  return ListingPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve({ lang }),
  })
}

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Home, { generateMetadata as rootGenerateMetadata } from '@/app/page'

/**
 * §173-Jupas ④ Etappe 3: Sprachpfad-STARTSEITE (/en, /fr, /nl) — dünner
 * Wrapper auf die Root-Startseite; Suchparameter (q/guests/…) laufen durch.
 * Unbekannte Top-Level-Pfade (/xyz) landen hier und gehen sauber auf 404.
 */
const LANGS = ['en', 'fr', 'nl'] as const

type Props = {
  params: Promise<{ lang: string }>
  searchParams: Promise<{ q?: string; guests?: string; checkin?: string; checkout?: string; view?: string; flex?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang } = await params
  if (!(LANGS as readonly string[]).includes(lang)) return {}
  return rootGenerateMetadata({ searchParams: Promise.resolve({ lang }) })
}

export default async function LangHome({ params, searchParams }: Props) {
  const { lang } = await params
  if (!(LANGS as readonly string[]).includes(lang)) notFound()
  const sp = await searchParams
  return Home({ searchParams: Promise.resolve({ ...sp, lang }) })
}

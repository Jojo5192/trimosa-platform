import type { MetadataRoute } from 'next'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { REGIONS, allPois } from '@/lib/regions'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa-app.vercel.app'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('id, slug, created_at')
    .eq('is_active', true)

  // §173-Jupas ④: je Listing auch die Sprachpfade (/en|fr|nl/…) mit
  // vollständigen hreflang-Annotationen an JEDER Variante
  const LANGS = ['en', 'fr', 'nl'] as const
  const listingEntries: MetadataRoute.Sitemap = (listings ?? []).flatMap((l) => {
    const path = `/listing/${l.slug ?? l.id}`
    const languages = {
      de: `${siteUrl}${path}`,
      ...Object.fromEntries(LANGS.map((x) => [x, `${siteUrl}/${x}${path}`])),
      'x-default': `${siteUrl}${path}`,
    }
    return [
      {
        url: `${siteUrl}${path}`,
        lastModified: l.created_at ?? undefined,
        changeFrequency: 'weekly' as const,
        priority: 0.8,
        alternates: { languages },
      },
      ...LANGS.map((x) => ({
        url: `${siteUrl}/${x}${path}`,
        lastModified: l.created_at ?? undefined,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
        alternates: { languages },
      })),
    ]
  })

  // §173 Etappe 2: Reiseführer-Seiten ebenfalls mit Sprachpfad-Varianten
  const langAlternates = (path: string) => ({
    de: `${siteUrl}${path}`,
    ...Object.fromEntries(LANGS.map((x) => [x, `${siteUrl}/${x}${path}`])),
    'x-default': `${siteUrl}${path}`,
  })
  const multiLang = (path: string, priority: number): MetadataRoute.Sitemap => {
    const languages = langAlternates(path)
    return [
      { url: `${siteUrl}${path}`, changeFrequency: 'monthly' as const, priority, alternates: { languages } },
      ...LANGS.map((x) => ({
        url: `${siteUrl}/${x}${path}`, changeFrequency: 'monthly' as const,
        priority: Math.max(priority - 0.2, 0.1), alternates: { languages },
      })),
    ]
  }

  const contentEntries: MetadataRoute.Sitemap = [
    ...Object.keys(REGIONS).map((slug) => `/region/${slug}`),
    '/ueber-uns',
  ].flatMap((path) => multiLang(path, 0.7))

  const poiEntries: MetadataRoute.Sitemap = allPois().flatMap(({ poi }) => multiLang(`/erlebnis/${poi.slug}`, 0.6))

  const legalEntries: MetadataRoute.Sitemap = ['/impressum', '/datenschutz', '/agb', '/barrierefreiheit', '/stornierung'].map((path) => ({
    url: `${siteUrl}${path}`,
    changeFrequency: 'yearly',
    priority: 0.3,
  }))

  // §173 Etappe 3: FAQ + Startseite ebenfalls mit Sprachpfad-Varianten
  const faqEntries: MetadataRoute.Sitemap = multiLang('/faq', 0.5)
  const homeLanguages = {
    de: siteUrl,
    ...Object.fromEntries(LANGS.map((x) => [x, `${siteUrl}/${x}`])),
    'x-default': siteUrl,
  }
  const homeEntries: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: 'daily' as const, priority: 1, alternates: { languages: homeLanguages } },
    ...LANGS.map((x) => ({
      url: `${siteUrl}/${x}`, changeFrequency: 'daily' as const, priority: 0.8, alternates: { languages: homeLanguages },
    })),
  ]

  return [
    ...homeEntries,
    ...faqEntries,
    ...listingEntries,
    ...contentEntries,
    ...poiEntries,
    ...legalEntries,
  ]
}

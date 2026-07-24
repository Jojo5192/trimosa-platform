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

  const contentEntries: MetadataRoute.Sitemap = [
    ...Object.keys(REGIONS).map((slug) => `/region/${slug}`),
    '/ueber-uns',
  ].map((path) => ({
    url: `${siteUrl}${path}`,
    changeFrequency: 'monthly',
    priority: 0.7,
  }))

  const poiEntries: MetadataRoute.Sitemap = allPois().map(({ poi }) => ({
    url: `${siteUrl}/erlebnis/${poi.slug}`,
    changeFrequency: 'monthly',
    priority: 0.6,
  }))

  const legalEntries: MetadataRoute.Sitemap = ['/impressum', '/datenschutz', '/agb', '/barrierefreiheit', '/faq', '/stornierung'].map((path) => ({
    url: `${siteUrl}${path}`,
    changeFrequency: 'yearly',
    priority: 0.3,
  }))

  return [
    {
      url: siteUrl,
      changeFrequency: 'daily',
      priority: 1,
    },
    ...listingEntries,
    ...contentEntries,
    ...poiEntries,
    ...legalEntries,
  ]
}

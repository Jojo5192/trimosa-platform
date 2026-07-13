import type { MetadataRoute } from 'next'
import { supabaseAdmin } from '@/lib/supabase-admin'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa-app.vercel.app'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data: listings } = await supabaseAdmin
    .from('listings')
    .select('id, slug, created_at')
    .eq('is_active', true)

  const listingEntries: MetadataRoute.Sitemap = (listings ?? []).map((l) => ({
    url: `${siteUrl}/listing/${l.slug ?? l.id}`,
    lastModified: l.created_at ?? undefined,
    changeFrequency: 'weekly',
    priority: 0.8,
  }))

  const contentEntries: MetadataRoute.Sitemap = ['/region/trier', '/region/bitburg', '/region/suedeifel', '/ueber-uns'].map((path) => ({
    url: `${siteUrl}${path}`,
    changeFrequency: 'monthly',
    priority: 0.7,
  }))

  const legalEntries: MetadataRoute.Sitemap = ['/impressum', '/datenschutz', '/agb'].map((path) => ({
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
    ...legalEntries,
  ]
}

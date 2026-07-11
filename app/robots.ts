import type { MetadataRoute } from 'next'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa-app.vercel.app'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard/', '/guest/', '/booking/', '/api/', '/login', '/register'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}

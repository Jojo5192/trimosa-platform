import type { MetadataRoute } from 'next'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa-app.vercel.app'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Auth-Seiten (/login, /register, /passwort-*) sind bewusst NICHT mehr
      // disallowed: Sie tragen ein noindex im jeweiligen layout.tsx — Google muss
      // sie crawlen DÜRFEN, um das noindex zu sehen (GSC-Warnung „Indexiert,
      // obwohl durch robots.txt blockiert", §252).
      disallow: ['/dashboard/', '/guest/', '/booking/', '/api/', '/auth/', '/team', '/mappe/', '/reinigung/', '/buchhaltung/'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}

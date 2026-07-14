import type { MetadataRoute } from 'next'

/**
 * PWA manifest — makes the team chat installable on the iPhone homescreen
 * (required for iOS web push). Guests just see a normal website.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TRIMOSA Team-Chat',
    short_name: 'TRIMOSA',
    description: 'Gäste-Kommunikation von TRIMOSA Apartments & Homes',
    start_url: '/dashboard/chat',
    display: 'standalone',
    background_color: '#F5F5F7',
    theme_color: '#12222E',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}

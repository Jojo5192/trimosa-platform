import type { MetadataRoute } from 'next'

/**
 * PWA manifest — makes the team chat installable on the iPhone homescreen
 * (required for iOS web push). Guests just see a normal website.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TRIMOSA Team',
    short_name: 'TRIMOSA',
    description: 'Gäste-Kommunikation von TRIMOSA Apartments & Homes',
    start_url: '/team',
    display: 'standalone',
    // §276: App-Hintergrund (Tokens) — Statusbar-Zone nahtlos zur Glas-Kopfleiste
    background_color: '#f3f4f6',
    theme_color: '#f3f4f6',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}

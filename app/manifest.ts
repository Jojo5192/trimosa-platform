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
    background_color: '#ffffff',
    // Statusbar-Zone (Uhrzeit/Batterie) weiß, nahtlos zum App-Header
    theme_color: '#ffffff',
    icons: [
      { src: '/icon.png', sizes: '512x512', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}

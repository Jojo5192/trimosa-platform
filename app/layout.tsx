import type { Metadata, Viewport } from "next";
import { headers, cookies } from 'next/headers'
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://trimosa-app.vercel.app'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "TRIMOSA — Ferienwohnungen in Sirzenich, Trier, Bitburg & der Südeifel",
    template: "%s | TRIMOSA",
  },
  description: "Handverlesene Ferienwohnungen in Sirzenich bei Trier, Bitburg und der Südeifel — direkt vom Gastgeber, ohne Vermittler.",
  // Bing Webmaster Tools (Domain-Property nicht importierbar → Meta-Verifizierung)
  verification: { other: { "msvalidate.01": "16F4C326DC193773955BAD589FCBA512" } },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // §174: html-lang folgt der Route (WCAG 3.1.1 + konsistentes Google-
  // Signal zu hreflang) — Sprachpfad-Präfix (/en|fr|nl via x-pathname aus
  // proxy.ts) gewinnt, sonst die Cookie-Sprachwahl, sonst Deutsch.
  let lang = 'de'
  try {
    const h = await headers()
    const path = h.get('x-pathname') ?? ''
    const m = path.match(/^\/(en|fr|nl)(\/|$)/)
    if (m) {
      lang = m[1]
    } else {
      const c = (await cookies()).get('uilang')?.value
      if (c === 'en' || c === 'fr' || c === 'nl') lang = c
    }
  } catch { /* Fallback de */ }
  return (
    <html
      lang={lang}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {children}
        {/* Vercel Web Analytics: cookielos & anonymisiert — kein Consent-Banner nötig */}
        <Analytics />
      </body>
    </html>
  );
}

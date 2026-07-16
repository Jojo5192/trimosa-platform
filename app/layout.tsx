import type { Metadata, Viewport } from "next";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
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

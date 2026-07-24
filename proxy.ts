import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * §174: Der Proxy läuft jetzt auf ALLEN Seiten-Routen (Matcher unten
 * schließt Statics/API aus) und reicht den Pfad als x-pathname-Header
 * durch — das Root-Layout leitet daraus das html-lang-Attribut ab
 * (Sprachpfade /en|fr|nl, WCAG 3.1.1). Die Supabase-Session-Logik läuft
 * weiterhin NUR für /dashboard (kein Auth-Roundtrip auf jeder Seite).
 */
export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-pathname', request.nextUrl.pathname)
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  })

  if (!request.nextUrl.pathname.startsWith('/dashboard')) return response

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // Session refreshen (damit Tokens aktuell bleiben)
  const { data: { session } } = await supabase.auth.getSession()

  // /dashboard nur für eingeloggte Nutzer
  if (!session) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', request.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  // Alle Seiten-Routen; ausgeschlossen: API, Next-Interna und alles mit
  // Datei-Endung (Bilder, sw.js, manifest, sitemap.xml, …)
  matcher: ['/((?!api|_next/static|_next/image|_next/data|.*\\..*).*)'],
}

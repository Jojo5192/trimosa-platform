import { createBrowserClient } from '@supabase/ssr'

// Für Client Components — speichert Auth-Tokens als Cookies (nötig für Server-seitige Auth-Checks)
export const supabaseBrowser = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

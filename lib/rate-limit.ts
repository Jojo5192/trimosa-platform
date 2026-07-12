import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Fixed-window rate limiter backed by a Supabase table (reliable across
 * serverless instances, unlike an in-memory counter). A small race window
 * under concurrent requests can let a couple of extra attempts through —
 * acceptable here since this guards against sustained abuse, not a
 * security boundary that needs to be exact.
 *
 * Returns true if the request is allowed, false if the caller is
 * currently rate-limited.
 */
export async function checkRateLimit(key: string, maxAttempts: number, windowSeconds: number): Promise<boolean> {
  const now = Date.now()

  const { data: existing } = await supabaseAdmin
    .from('rate_limits')
    .select('count, window_start')
    .eq('key', key)
    .maybeSingle()

  if (!existing || now - new Date(existing.window_start).getTime() > windowSeconds * 1000) {
    await supabaseAdmin
      .from('rate_limits')
      .upsert({ key, count: 1, window_start: new Date(now).toISOString() })
    return true
  }

  if (existing.count >= maxAttempts) return false

  await supabaseAdmin
    .from('rate_limits')
    .update({ count: existing.count + 1 })
    .eq('key', key)
  return true
}

/** Best-effort client IP extraction for anonymous-endpoint rate limiting. */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() ?? 'unknown'
}

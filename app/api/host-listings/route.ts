import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function GET(req: NextRequest) {
  const hostId = req.nextUrl.searchParams.get('hostId')
  if (!hostId) return NextResponse.json({ listings: [] })

  const { data } = await supabaseAdmin
    .from('listings')
    .select('id, title, images, city, location, price_per_night')
    .eq('host_id', hostId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  return NextResponse.json({ listings: data ?? [] })
}

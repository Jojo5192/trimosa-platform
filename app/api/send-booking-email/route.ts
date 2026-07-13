import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { sendBookingEmail, sendHostBookingAlert } from '@/lib/email'

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Nicht eingeloggt' }, { status: 401 })
  }

  const { bookingId, type } = await request.json()
  if (!bookingId) {
    return NextResponse.json({ error: 'bookingId fehlt' }, { status: 400 })
  }

  // type 'host' re-sends the host alert (useful for testing the template);
  // default is the guest confirmation.
  const result = type === 'host'
    ? await sendHostBookingAlert(bookingId)
    : await sendBookingEmail(bookingId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json(result)
}

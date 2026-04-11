import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * GET /api/debug/profile
 *
 * Returns everything the webhook would see for the current user's profile.
 * Helps debug why Smoobu gets wrong/empty guest data.
 *
 * DELETE THIS ENDPOINT AFTER DEBUGGING!
 */
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  // ── 1. Try full select (same as webhook does) ─────────────────
  const { data: fullData, error: fullError } = await supabaseAdmin
    .from('profiles')
    .select('guest_first_name, guest_last_name, company_name, account_type, display_name, phone, guest_street, guest_zip, guest_city, guest_country')
    .eq('id', user.id)
    .maybeSingle()

  // ── 2. Try minimal select (fallback) ──────────────────────────
  const { data: minData, error: minError } = await supabaseAdmin
    .from('profiles')
    .select('guest_first_name, guest_last_name, display_name, phone, guest_street, guest_zip, guest_city, guest_country')
    .eq('id', user.id)
    .maybeSingle()

  // ── 3. Check which columns exist ──────────────────────────────
  const { data: allCols } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  const columnNames = allCols ? Object.keys(allCols) : []

  // ── 4. Auth metadata ──────────────────────────────────────────
  const userMeta = user.user_metadata ?? {}

  return NextResponse.json({
    userId: user.id,
    email: user.email,
    userMetadata: userMeta,
    profileColumns: columnNames,
    fullSelect: {
      data: fullData,
      error: fullError?.message ?? null,
    },
    minimalSelect: {
      data: minData,
      error: minError?.message ?? null,
    },
    diagnosis: {
      hasAccountTypeColumn: columnNames.includes('account_type'),
      hasCompanyNameColumn: columnNames.includes('company_name'),
      hasVatIdColumn: columnNames.includes('vat_id'),
      hasGuestFirstName: columnNames.includes('guest_first_name'),
      hasGuestStreet: columnNames.includes('guest_street'),
      guestFirstNameValue: (fullData ?? minData)?.guest_first_name ?? '❌ NULL',
      guestLastNameValue: (fullData ?? minData)?.guest_last_name ?? '❌ NULL',
      displayNameValue: (fullData ?? minData)?.display_name ?? '❌ NULL',
      guestStreetValue: (fullData ?? minData)?.guest_street ?? '❌ NULL',
      guestZipValue: (fullData ?? minData)?.guest_zip ?? '❌ NULL',
      guestCityValue: (fullData ?? minData)?.guest_city ?? '❌ NULL',
      guestCountryValue: (fullData ?? minData)?.guest_country ?? '❌ NULL',
      phoneValue: (fullData ?? minData)?.phone ?? '❌ NULL',
    },
  }, { status: 200 })
}

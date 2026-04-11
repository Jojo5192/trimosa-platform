import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * POST /api/auth/register
 *
 * Legt User + Profil in einem Schritt an (via Service-Role).
 * E-Mail-Bestätigung wird übersprungen damit der User sofort eingeloggt werden kann.
 */
export async function POST(request: Request) {
  const body = await request.json()

  const {
    email,
    password,
    role,            // 'guest' | 'host'
    accountType,     // 'person' | 'business'
    firstName,       // nur bei Privatperson
    lastName,        // nur bei Privatperson
    companyName,     // nur bei Unternehmen
    vatId,           // nur bei Unternehmen, optional
    displayName,     // öffentlicher Anzeigename (Chat, Bewertungen)
    street,
    zip,
    city,
    country,
    phone,
  } = body

  // Pflichtfelder prüfen
  if (!email || !password || !role || !accountType) {
    return NextResponse.json({ error: 'Pflichtfelder fehlen.' }, { status: 400 })
  }
  if (accountType === 'person' && (!firstName?.trim() || !lastName?.trim())) {
    return NextResponse.json({ error: 'Vor- und Nachname sind Pflichtfelder.' }, { status: 400 })
  }
  if (accountType === 'business' && !companyName?.trim()) {
    return NextResponse.json({ error: 'Firmenname ist ein Pflichtfeld.' }, { status: 400 })
  }
  if (!street?.trim() || !zip?.trim() || !city?.trim()) {
    return NextResponse.json({ error: 'Adresse (Straße, PLZ, Stadt) ist ein Pflichtfeld.' }, { status: 400 })
  }
  if (!phone?.trim()) {
    return NextResponse.json({ error: 'Telefonnummer ist ein Pflichtfeld.' }, { status: 400 })
  }

  // Anzeigename ableiten wenn nicht angegeben
  const resolvedDisplayName = displayName?.trim() ||
    (accountType === 'business' ? companyName?.trim() : `${firstName?.trim()} ${lastName?.trim()}`.trim())

  // 1. User anlegen — email_confirm: true überspringt die Bestätigungs-E-Mail
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: {
      role,
      account_type: accountType,
      name: resolvedDisplayName,
    },
  })

  if (authError) {
    // Benutzerfreundliche Fehlermeldungen
    if (authError.message.includes('already registered') || authError.message.includes('already been registered')) {
      return NextResponse.json({ error: 'Diese E-Mail-Adresse ist bereits registriert.' }, { status: 409 })
    }
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

  const userId = authData.user.id

  // 2. Profil anlegen
  const { error: profileError } = await supabaseAdmin.from('profiles').upsert({
    id: userId,
    display_name: resolvedDisplayName,
    account_type: accountType,
    // Privatperson
    guest_first_name: accountType === 'person' ? firstName?.trim() : null,
    guest_last_name:  accountType === 'person' ? lastName?.trim()  : null,
    // Unternehmen
    company_name: accountType === 'business' ? companyName?.trim() : null,
    vat_id:       accountType === 'business' ? (vatId?.trim() || null) : null,
    // Adresse (für beide)
    guest_street:  street?.trim(),
    guest_zip:     zip?.trim(),
    guest_city:    city?.trim(),
    guest_country: country?.trim() || 'Deutschland',
    phone: phone?.trim() || null,
  })

  if (profileError) {
    // User wieder löschen damit kein Halbzustand bleibt
    await supabaseAdmin.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: 'Profil konnte nicht angelegt werden: ' + profileError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

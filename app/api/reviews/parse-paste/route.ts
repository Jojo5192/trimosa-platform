import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'

/**
 * POST /api/reviews/parse-paste
 * Parse pasted review text from platforms and import into DB.
 * Handles various formats: Airbnb copy-paste, Booking copy-paste, Google copy-paste
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { listingId, source, text } = await req.json()
  if (!listingId || !text) return NextResponse.json({ error: 'listingId und text erforderlich' }, { status: 400 })

  // Verify ownership
  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('host_id')
    .eq('id', listingId)
    .single()

  if (!listing) return NextResponse.json({ error: 'Unterkunft nicht gefunden' }, { status: 404 })
  if (listing.host_id !== user.id) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })

  // Parse reviews from pasted text
  const reviews = parseReviewText(text, source || 'airbnb')

  if (reviews.length === 0) {
    return NextResponse.json({ error: 'Keine Bewertungen erkannt. Bitte kopiere den gesamten Bewertungsbereich mit Namen, Sternen und Text.' }, { status: 400 })
  }

  let imported = 0
  for (let i = 0; i < reviews.length; i++) {
    const review = reviews[i]
    const { error } = await supabaseAdmin.from('reviews').upsert({
      listing_id: listingId,
      source: source || 'airbnb',
      source_review_id: `${source}_paste_${review.author.replace(/\s+/g, '_')}_${i}_${Date.now()}`,
      author_name: review.author,
      rating: review.rating,
      review_text: review.text || null,
      review_date: review.date,
    }, { onConflict: 'listing_id,source,source_review_id' })

    if (!error) imported++
  }

  return NextResponse.json({ imported, parsed: reviews.length })
}

interface ParsedReview {
  author: string
  rating: number
  text: string
  date: string
}

function parseReviewText(rawText: string, source: string): ParsedReview[] {
  const text = rawText.trim()
  const reviews: ParsedReview[] = []

  // Normalize star characters
  const normalized = text
    .replace(/⭐/g, '★')
    .replace(/🌟/g, '★')
    .replace(/☆/g, '')

  // Strategy 1: Split by common review boundaries
  // Airbnb format: "Name\n★★★★★\nDate\nReview text"
  // Or: "Name\n5.0\nDate\nReview text"
  // Or: "Name rated it ★★★★★\nDate\nText"

  // Try splitting by patterns that typically separate reviews:
  // - Lines that look like a name followed by stars/rating
  // - Double newlines between reviews
  // - "Translated by Google" markers

  // Pattern: Name (short line, 2-40 chars, no sentences) followed by rating
  const reviewBlocks = splitIntoReviewBlocks(normalized)

  for (const block of reviewBlocks) {
    const parsed = parseSingleReview(block, source)
    if (parsed) reviews.push(parsed)
  }

  // If splitting didn't work well, try the whole text as one review
  if (reviews.length === 0 && text.length > 20) {
    const single = parseSingleReview(normalized, source)
    if (single) reviews.push(single)
  }

  return reviews
}

function splitIntoReviewBlocks(text: string): string[] {
  const lines = text.split('\n')
  const blocks: string[] = []
  let currentBlock: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const nextLine = lines[i + 1]?.trim() ?? ''

    // Detect review boundary: a short name-like line followed by stars or rating
    const isNameLine = line.length >= 2 && line.length <= 50 && !line.includes('.') && !line.match(/^\d/) && !line.match(/^[★]+$/) && !isDateLine(line) && !line.match(/^(Übersetzen|Translated|Mehr|Weiterlesen|Antwort|Response|Originaltextanzeigen)/i)
    const nextIsRating = nextLine.match(/^[★]{1,5}/) || nextLine.match(/^\d[.,]\d/) || nextLine.match(/^(\d)\s*(von|\/|out of)\s*5/)
    const lineIsRating = line.match(/^[★]{1,5}/) || line.match(/^\d[.,]\d\s*$/)

    // New review starts: name line + rating on next line
    if (isNameLine && nextIsRating && currentBlock.length > 0) {
      blocks.push(currentBlock.join('\n'))
      currentBlock = [line]
      continue
    }

    // Or: rating line followed by name-like content (Google format)
    if (lineIsRating && currentBlock.length > 2) {
      // Check if previous block has content
      const prevContent = currentBlock.join('\n').trim()
      if (prevContent.length > 10) {
        blocks.push(prevContent)
        currentBlock = [line]
        continue
      }
    }

    // Double empty line = review separator
    if (line === '' && lines[i - 1]?.trim() === '' && currentBlock.length > 2) {
      const content = currentBlock.join('\n').trim()
      if (content.length > 5) {
        blocks.push(content)
        currentBlock = []
        continue
      }
    }

    if (line) currentBlock.push(line)
  }

  // Don't forget the last block
  if (currentBlock.length > 0) {
    const content = currentBlock.join('\n').trim()
    if (content.length > 5) blocks.push(content)
  }

  return blocks
}

function parseSingleReview(block: string, source: string): ParsedReview | null {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 1) return null

  let author = ''
  let rating = 5
  let text = ''
  let date = new Date().toISOString().split('T')[0]
  let textStartIdx = 0

  // Find rating (stars or numeric)
  let ratingFound = false
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i]

    // Star rating: ★★★★★
    const starMatch = line.match(/^([★]{1,5})/)
    if (starMatch) {
      rating = starMatch[1].length
      ratingFound = true
      if (i > 0 && !author) author = lines.slice(0, i).join(' ')
      textStartIdx = Math.max(textStartIdx, i + 1)
      continue
    }

    // Numeric rating: "5,0" or "4.8" or "5/5" or "5 von 5"
    const numMatch = line.match(/^(\d[.,]?\d?)\s*(?:$|von\s*5|\/\s*5|out of|Sterne|stars)/i)
    if (numMatch) {
      rating = Math.round(parseFloat(numMatch[1].replace(',', '.')))
      if (rating > 5) rating = Math.round(rating / 2)
      ratingFound = true
      if (i > 0 && !author) author = lines.slice(0, i).join(' ')
      textStartIdx = Math.max(textStartIdx, i + 1)
      continue
    }

    // Inline rating: "Max M. ★★★★★" or "5.0 - Max M."
    const inlineStarMatch = line.match(/([★]{1,5})\s*$/)
    if (inlineStarMatch && i < 3) {
      rating = inlineStarMatch[1].length
      ratingFound = true
      author = line.replace(inlineStarMatch[0], '').trim()
      textStartIdx = Math.max(textStartIdx, i + 1)
      continue
    }

    // Date line
    if (isDateLine(line) && i < 5) {
      date = parseDateLine(line)
      textStartIdx = Math.max(textStartIdx, i + 1)
      continue
    }

    // First short line is likely the name
    if (i === 0 && line.length <= 40 && !author) {
      author = line
      textStartIdx = Math.max(textStartIdx, 1)
    }
  }

  // Everything after rating/date/name is the review text
  const textLines = lines.slice(textStartIdx).filter(l => {
    // Skip meta lines
    return !l.match(/^(Übersetzen|Translated by|Originaltextanzeigen|Mehr anzeigen|Weiterlesen|Antwort von|Response from|Hilfreich|Helpful|\d+ (Personen|people) fanden)/i)
  })
  text = textLines.join(' ').trim()

  // Need at least some content
  if (!text && !ratingFound) return null
  if (!author) author = source === 'airbnb' ? 'Airbnb-Gast' : source === 'booking' ? 'Booking-Gast' : source === 'google' ? 'Google-Nutzer' : 'Gast'

  // Clean up author name
  author = author.replace(/[★•·\-–—]/g, '').trim()
  if (author.length > 50) author = author.slice(0, 50)

  return { author, rating: Math.min(5, Math.max(1, rating)), text, date }
}

function isDateLine(line: string): boolean {
  // German months
  if (line.match(/^(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+\d{4}/i)) return true
  // English months
  if (line.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i)) return true
  // Short format: "Mär. 2025" or "Mar 2025"
  if (line.match(/^[A-Za-zÄÖÜäöü]{3,4}\.?\s+\d{4}/)) return true
  // ISO-like: "2025-03-15" or "15.03.2025"
  if (line.match(/^\d{4}-\d{2}-\d{2}/) || line.match(/^\d{1,2}\.\d{1,2}\.\d{4}/)) return true
  // Relative: "vor 2 Monaten", "2 months ago"
  if (line.match(/^vor\s+\d/i) || line.match(/^\d+\s+(month|week|day|year)s?\s+ago/i)) return true
  return false
}

function parseDateLine(line: string): string {
  // Try ISO
  const isoMatch = line.match(/(\d{4}-\d{2}-\d{2})/)
  if (isoMatch) return isoMatch[1]

  // Try German date
  const deMatch = line.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (deMatch) return `${deMatch[3]}-${deMatch[2].padStart(2, '0')}-${deMatch[1].padStart(2, '0')}`

  // Try month-year
  const months: Record<string, string> = {
    'januar': '01', 'februar': '02', 'märz': '03', 'april': '04', 'mai': '05', 'juni': '06',
    'juli': '07', 'august': '08', 'september': '09', 'oktober': '10', 'november': '11', 'dezember': '12',
    'january': '01', 'february': '02', 'march': '03', 'may': '05', 'june': '06',
    'july': '07', 'october': '10', 'december': '12',
    'jan': '01', 'feb': '02', 'mär': '03', 'mar': '03', 'apr': '04', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'okt': '10', 'oct': '10', 'nov': '11', 'dez': '12', 'dec': '12',
  }

  const monthYearMatch = line.match(/([A-Za-zÄÖÜäöü]+)\.?\s+(\d{4})/)
  if (monthYearMatch) {
    const monthKey = monthYearMatch[1].toLowerCase().replace('.', '')
    const monthNum = months[monthKey]
    if (monthNum) return `${monthYearMatch[2]}-${monthNum}-01`
  }

  return new Date().toISOString().split('T')[0]
}

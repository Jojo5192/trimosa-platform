/** URL slug from a listing title: "Café Höhe 12" → "cafe-hoehe-12". */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // strip remaining accents (é → e)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'unterkunft'
  )
}

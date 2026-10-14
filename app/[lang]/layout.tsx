import { notFound } from 'next/navigation'
import { isUiLang } from '@/lib/i18n'
import LangCookieSync from '@/components/LangCookieSync'

/** Sprachpfade /en|fr|nl: Cookie beim Besuch setzen (Details components/LangCookieSync.tsx). */
export default async function LangLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params
  if (!isUiLang(lang) || lang === 'de') notFound()
  return (
    <>
      <LangCookieSync lang={lang} />
      {children}
    </>
  )
}

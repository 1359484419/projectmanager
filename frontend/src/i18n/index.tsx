import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import zh from './zh'
import en from './en'

export type Locale = 'zh' | 'en'
export type Translations = typeof zh

const LOCALE_KEY = 'pm-locale'

const locales: Record<Locale, Translations> = { zh, en }

const I18nContext = createContext<{ t: Translations; locale: Locale; setLocale: (l: Locale) => void }>({
  t: zh,
  locale: 'zh',
  setLocale: () => {},
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = localStorage.getItem(LOCALE_KEY)
    return stored === 'en' ? 'en' : 'zh'
  })

  const setLocale = (l: Locale) => {
    setLocaleState(l)
    localStorage.setItem(LOCALE_KEY, l)
  }

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return (
    <I18nContext.Provider value={{ t: locales[locale], locale, setLocale }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}

export function useT() {
  return useContext(I18nContext).t
}

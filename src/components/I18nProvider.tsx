'use client';

import { createContext, useContext, useMemo } from 'react';
import { translate, type Lang } from '@/lib/i18n/dictionary';

type I18n = { lang: Lang; t: (key: string, vars?: Record<string, string | number>) => string };

const I18nContext = createContext<I18n>({ lang: 'ru', t: (key, vars) => translate('ru', key, vars) });

export function I18nProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const value = useMemo(() => ({ lang, t: (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars) }), [lang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLanguage } from '@/app/profile/language';
import { useI18n } from './I18nProvider';

export default function LanguageSwitcher() {
  const { lang, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function pick(next: 'ru' | 'en') {
    if (next === lang || pending) return;
    startTransition(async () => {
      await setLanguage(next);
      router.refresh();
    });
  }

  return (
    <section className="card mt-8">
      <h2 className="font-semibold">{t('profile.language')}</h2>
      <p className="mt-1 text-xs text-mute">{t('profile.languageHint')}</p>
      <div className="mt-3 flex gap-2" role="group" aria-label={t('profile.language')}>
        {(['ru', 'en'] as const).map((l) => (
          <button key={l} type="button" className={l === lang ? 'btn-solid' : 'btn'} aria-pressed={l === lang} disabled={pending} onClick={() => pick(l)}>
            {l === 'ru' ? 'Русский' : 'English'}
          </button>
        ))}
      </div>
    </section>
  );
}
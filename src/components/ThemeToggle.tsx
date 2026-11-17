'use client';

import { useEffect, useState } from 'react';
import Icon from './Icon';
import { useI18n } from './I18nProvider';

export default function ThemeToggle() {
  const { t } = useI18n();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const sync=()=>setDark(document.documentElement.classList.contains('dark'));sync();window.addEventListener('flowdesk:theme-changed',sync);return()=>window.removeEventListener('flowdesk:theme-changed',sync);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      /* без сохранения тоже работает */
    }
  }

  return (
    <button
      onClick={toggle}
      className="btn h-9 w-9 p-0"
      aria-label={dark ? t('nav.themeLight') : t('nav.themeDark')}
      title={dark ? t('nav.themeLightTitle') : t('nav.themeDarkTitle')}
    >
      <Icon name={dark ? 'sun' : 'moon'} width={18} height={18}/>
    </button>
  );
}

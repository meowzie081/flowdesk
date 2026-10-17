'use client';

import { useEffect, useState } from 'react';
import Icon from './Icon';

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
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
      aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      title={dark ? 'Светлая тема' : 'Тёмная тема'}
    >
      <Icon name={dark ? 'sun' : 'moon'} width={18} height={18}/>
    </button>
  );
}

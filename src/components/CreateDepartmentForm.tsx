'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { createDepartment } from '@/app/create-department';
import { useI18n } from './I18nProvider';

export default function CreateDepartmentForm() {
  const { t } = useI18n();
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(ref.current!);
    startTransition(async () => {
      const res = await createDepartment(fd);
      if (!res.ok) return setError(res.error);
      ref.current?.reset();
      router.refresh();
    });
  }

  const isLimit = error?.includes('Тариф');

  return (
    <form ref={ref} onSubmit={submit} className="mt-8">
      <div className="flex gap-2">
        <input name="name" className="input" placeholder={t('home.depName')} required minLength={2} maxLength={80} aria-label={t('home.depName')} />
        <button className="btn-solid" disabled={pending}>
          {pending ? t('common.creating') : t('common.create')}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}{' '}
          {isLimit && (
            <Link href="/org" className="font-medium underline">
              {t('home.viewPlan')}
            </Link>
          )}
        </p>
      )}
    </form>
  );
}
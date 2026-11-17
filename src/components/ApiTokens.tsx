'use client';

import { useRef, useState, useTransition } from 'react';
import { createApiToken, revokeApiToken } from '@/app/profile/api-tokens';

export type ApiTokenRow = { id: string; name: string; token_prefix: string; created_at: string; last_used_at: string | null };

const fmt = (iso: string) => new Date(iso).toLocaleDateString('ru-RU');

export default function ApiTokens({ tokens }: { tokens: ApiTokenRow[] | null }) {
  const [pending, startTransition] = useTransition();
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (!tokens) {
    return (
      <section className="mt-8 rounded-lg border border-line p-4">
        <h2 className="text-sm font-medium">API-токены</h2>
        <p className="mt-1 text-sm text-mute">
          Публичный API ещё не включён в этой базе. Примените миграцию 0024 в Supabase SQL Editor — после этого здесь можно будет создавать персональные токены.
        </p>
      </section>
    );
  }

  function create(formData: FormData) {
    setError(null);
    setCreated(null);
    startTransition(async () => {
      const result = await createApiToken(formData);
      if (result.ok) {
        setCreated(result.token);
        setCopied(false);
        formRef.current?.reset();
      } else setError(result.error);
    });
  }

  function revoke(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await revokeApiToken(formData);
      if (!result.ok) setError(result.error ?? 'Не удалось удалить токен');
    });
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      setCopied(true);
    } catch {
      setError('Не удалось скопировать — выделите токен вручную.');
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-line p-4">
      <h2 className="text-sm font-medium">API-токены</h2>
      <p className="mt-1 text-sm text-mute">
        Персональные токены для публичного API: доступ в рамках ваших отделов, права как у вашей роли. Документация — docs/API.md в репозитории.
      </p>

      {created && (
        <div role="status" className="mt-3 rounded-lg border border-orange-600/40 bg-orange-50 p-3">
          <p className="text-sm font-medium">Токен создан. Скопируйте его сейчас — он показывается один раз.</p>
          <code className="mt-2 block break-all rounded bg-white p-2 text-xs">{created}</code>
          <button type="button" className="btn mt-2 py-1" onClick={copy}>
            {copied ? 'Скопировано' : 'Скопировать'}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <form ref={formRef} action={create} className="mt-3 flex flex-wrap gap-2">
        <input name="name" required maxLength={60} placeholder="Например: CI-скрипт" className="input max-w-xs" />
        <button className="btn-solid" disabled={pending}>
          {pending ? 'Создаём…' : 'Создать токен'}
        </button>
      </form>

      {tokens.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-mute">
                  <code>{t.token_prefix}…</code> · создан {fmt(t.created_at)} ·{' '}
                  {t.last_used_at ? `использован ${fmt(t.last_used_at)}` : 'ещё не использовался'}
                </p>
              </div>
              <form action={revoke}>
                <input type="hidden" name="id" value={t.id} />
                <button className="btn py-1" disabled={pending}>
                  Отозвать
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
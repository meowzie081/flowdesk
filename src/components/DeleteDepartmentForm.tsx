'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteDepartment } from '@/app/d/[depId]/team/actions';

export default function DeleteDepartmentForm({ depId }: { depId: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await deleteDepartment(depId, confirm);
      if (!res.ok) return setError(res.error);
      setDone(true);
      // Отдела больше нет — возвращаемся к выбору отдела
      router.replace('/');
      router.refresh();
    });
  }

  if (done) return <p className="mt-3 text-sm text-mute">Отдел удалён. Переходим к списку отделов…</p>;

  return (
    <form onSubmit={submit} className="mt-3">
      <div className="flex flex-wrap gap-2">
        <input
          required
          autoComplete="off"
          placeholder="Введите название отдела для подтверждения"
          className="input max-w-sm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <button className="btn border-red-600 text-red-600 hover:bg-red-600 hover:text-[#fff]" disabled={pending}>
          {pending ? 'Удаляю…' : 'Удалить навсегда'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </form>
  );
}

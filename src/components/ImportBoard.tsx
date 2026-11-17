'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { csvToPayload, parseCsv, trelloToPayload, type ImportPayload } from '@/lib/import';

export default function ImportBoard({ depId, canWrite }: { depId: string; canWrite: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [payload, setPayload] = useState<ImportPayload | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneBoardId, setDoneBoardId] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setPayload(null);
    setDoneBoardId(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      const isJson = file.name.toLowerCase().endsWith('.json') || text.trimStart().startsWith('{');
      const parsed = isJson ? trelloToPayload(JSON.parse(text)) : csvToPayload(parseCsv(text));
      if (parsed.tasks.length === 0) setError('В файле не найдено ни одной задачи.');
      setPayload(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось разобрать файл.');
    }
  }

  async function submit() {
    if (!payload) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dep: depId, payload }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? 'Не удалось импортировать.');
      setDoneBoardId(data.boardId);
      setPayload(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch {
      setError('Не удалось связаться с сервером. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  if (!canWrite)
    return <p className="text-sm text-mute">Импорт доступен владельцам и участникам отдела с правом редактирования.</p>;

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="card">
        <h2 className="font-semibold">Файл для импорта</h2>
        <p className="mt-1 text-sm text-mute">
          Поддерживаются экспорт доски Trello (.json) и CSV: выгрузка FlowDesk, Jira CSV или таблица с колонками
          «Задача/Summary/Title», «Колонка/Status», «Описание», «Приоритет», «Срок».
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".json,.csv,application/json,text/csv"
          onChange={onFile}
          aria-label="Файл для импорта"
          className="mt-3 block text-sm text-mute file:mr-3 file:rounded-lg file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-neutral-100"
        />
        {fileName && <p className="mt-2 text-xs text-mute">Выбран файл: {fileName}</p>}
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {payload && (
        <div className="card">
          <h2 className="font-semibold">Предпросмотр: {payload.board_name}</h2>
          <p className="mt-1 text-sm text-mute">
            Колонок: {payload.columns.length} · Задач: {payload.tasks.length}. Будет создана новая доска в этом отделе.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {payload.columns.map((c) => (
              <span key={c.name} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-mute">
                {c.name}
                {c.is_done ? ' ✓' : ''}
              </span>
            ))}
          </div>
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {payload.tasks.slice(0, 5).map((t, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="truncate">{t.title}</span>
                <span className="shrink-0 text-mute">{t.column}</span>
              </li>
            ))}
            {payload.tasks.length > 5 && <li className="text-mute">…и ещё {payload.tasks.length - 5}</li>}
          </ul>
          <button className="btn-solid mt-4" onClick={submit} disabled={busy}>
            {busy ? 'Импортирую…' : `Импортировать ${payload.tasks.length} задач`}
          </button>
        </div>
      )}

      {doneBoardId && (
        <div className="card text-sm">
          <p className="font-medium">Готово! Доска создана.</p>
          <Link href={`/d/${depId}/board?board=${doneBoardId}`} className="mt-2 inline-block font-medium text-orange-600 hover:underline">
            Открыть импортированную доску →
          </Link>
        </div>
      )}
    </div>
  );
}
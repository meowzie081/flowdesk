'use client';
import {trackEvent} from '@/lib/analytics-client';

import { useState } from 'react';
import RichText from './RichText';

/**
 * Кнопка «спросить ИИ» с готовым запросом к /api/ai.
 * Используется для резюме дайджеста и подсказок по блокерам.
 */
export default function AiAction({
  label,
  request,
  className,
  downloadName,
}: {
  label: string;
  request: Record<string, unknown>;
  className?: string;
  /** Если задано — под ответом появляется кнопка «Скачать .md» с этим именем файла */
  downloadName?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(String(data.detail ?? data.error ?? `Ошибка ${res.status}`));
      } else {
        trackEvent('ai_response_received',{command:request.command as 'digest'|'blocker'|'report'});
        setText(String(data.answer ?? ''));
      }
    } catch {
      setError('Не удалось связаться с сервером');
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (text === null || !downloadName) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={className}>
      {text === null ? (
        <button className="btn py-1 text-xs" onClick={run} disabled={busy}>
          {busy ? 'Думаю…' : label}
        </button>
      ) : (
        <div className="rounded-md border border-line bg-neutral-50 p-3 text-sm">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-mute">ИИ</span>
            <button className="text-xs text-mute hover:text-ink" onClick={() => setText(null)}>
              Скрыть
            </button>
          </div>
          <RichText text={text} />
          {downloadName && (
            <button className="mt-2 text-xs text-mute hover:text-ink" onClick={download}>
              Скачать .md
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

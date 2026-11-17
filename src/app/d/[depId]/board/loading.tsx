import { getLang } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/dictionary';

export default function BoardLoading() {
  const label = translate(getLang(), 'board.loading');
  return (
    <div role="status" aria-label={label}>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="skeleton h-10 w-64 max-w-full" />
        <div className="skeleton h-10 w-36" />
        <div className="skeleton h-10 w-40" />
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {[0, 1, 2, 3].map((col) => (
          <div key={col} className="board-column w-72 shrink-0 p-3">
            <div className="skeleton mb-3 h-5 w-32" />
            <div className="flex flex-col gap-2">
              {[0, 1].map((card) => (
                <div key={card} className="skeleton h-24 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
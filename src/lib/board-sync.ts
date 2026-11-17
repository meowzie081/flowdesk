export interface RealtimeChange {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

export interface TaskChangeResult<T> {
  rows: T[];
  fetchIds: string[];
}

/**
 * Применяет событие Realtime к списку задач. INSERT и UPDATE неизвестной строки
 * требуют догрузки: в payload нет вложенных чек-листов, а строка могла появиться
 * после начальной загрузки. UPDATE известной строки сливается поверх текущей,
 * сохраняя вложенные поля (task_checklist), которых нет в payload.
 */
export function applyTaskChange<T extends { id: string }>(
  tasks: T[],
  change: RealtimeChange,
): TaskChangeResult<T> {
  if (change.eventType === 'DELETE') {
    const id = change.old?.id;
    return { rows: typeof id === 'string' ? tasks.filter((t) => t.id !== id) : tasks, fetchIds: [] };
  }
  const row = change.new as (T & { id?: unknown }) | null | undefined;
  if (!row || typeof row.id !== 'string') return { rows: tasks, fetchIds: [] };
  if (change.eventType === 'INSERT' || !tasks.some((t) => t.id === row.id)) {
    return { rows: tasks, fetchIds: [row.id] };
  }
  return { rows: tasks.map((t) => (t.id === row.id ? { ...t, ...row } : t)), fetchIds: [] };
}

/** События колонок плоские: применяем напрямую, порядок держим по position, затем id. */
export function applyColumnChange<T extends { id: string; position: number }>(
  columns: T[],
  change: RealtimeChange,
): T[] {
  if (change.eventType === 'DELETE') {
    const id = change.old?.id;
    return typeof id === 'string' ? columns.filter((c) => c.id !== id) : columns;
  }
  const row = change.new as (T & { id?: unknown }) | null | undefined;
  if (!row || typeof row.id !== 'string') return columns;
  const next = columns.some((c) => c.id === row.id)
    ? columns.map((c) => (c.id === row.id ? { ...c, ...row } : c))
    : [...columns, row as T];
  return next.sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Дедупликация при слиянии догруженных строк с текущим состоянием. */
export function mergeFetchedTasks<T extends { id: string }>(current: T[], fetched: T[]): T[] {
  const map = new Map(current.map((t) => [t.id, t]));
  for (const row of fetched) map.set(row.id, row);
  return [...map.values()];
}
/**
 * Аналитика по доске: загрузка команды и риск срыва сроков.
 * Чистые функции без обращения к базе — их легко проверить тестами.
 * Это прозрачные эвристики, а не «чёрный ящик»: у каждой оценки есть понятная причина.
 */

const DAY_MS = 86_400_000;

export interface ATask {
  id: string;
  title: string;
  columnId: string;
  assigneeId: string | null;
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null; // YYYY-MM-DD
  createdAt: string;
  movedAt: string;
}

export interface ACol {
  id: string;
  position: number;
  isDone: boolean;
}

/** Сколько полных дней осталось до даты (отрицательно — просрочено). Сравнение по календарным дням. */
export function daysUntil(dueDate: string, now: Date): number {
  const due = Date.parse(`${dueDate}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((due - today) / DAY_MS);
}

export type LoadStatus = 'overloaded' | 'normal' | 'free';

export interface WorkloadRow {
  userId: string | null; // null — задачи без исполнителя
  open: number;
  high: number;
  overdue: number;
  dueSoon: number; // срок в ближайшие 3 дня
  score: number;
  status: LoadStatus;
}

/** Вес открытой задачи: высокий приоритет тяжелее, просрочка добавляет напряжения. */
function weight(t: ATask, overdue: boolean): number {
  const base = t.priority === 'high' ? 3 : t.priority === 'medium' ? 2 : 1;
  return base + (overdue ? 2 : 0);
}

export function computeWorkload(
  tasks: ATask[],
  cols: ACol[],
  memberIds: string[],
  now: Date,
): { rows: WorkloadRow[]; unassigned: number } {
  const done = new Set(cols.filter((c) => c.isDone).map((c) => c.id));
  const byUser = new Map<string, WorkloadRow>();
  for (const id of memberIds) {
    byUser.set(id, { userId: id, open: 0, high: 0, overdue: 0, dueSoon: 0, score: 0, status: 'normal' });
  }
  let unassigned = 0;

  for (const t of tasks) {
    if (done.has(t.columnId)) continue;
    if (!t.assigneeId) {
      unassigned++;
      continue;
    }
    const row = byUser.get(t.assigneeId);
    if (!row) continue; // исполнитель уже не в отделе
    const left = t.dueDate ? daysUntil(t.dueDate, now) : null;
    const overdue = left !== null && left < 0;
    row.open++;
    if (t.priority === 'high') row.high++;
    if (overdue) row.overdue++;
    else if (left !== null && left <= 3) row.dueSoon++;
    row.score += weight(t, overdue);
  }

  const rows = [...byUser.values()];
  const avg = rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : 0;
  for (const r of rows) {
    // «Перегружен»: заметно выше среднего (и не пустяк) или много просрочек
    if ((r.score >= avg * 1.5 && r.score >= 8) || r.overdue >= 3) r.status = 'overloaded';
    // «Свободен»: заметно ниже среднего, когда в команде есть что делить
    else if (avg >= 4 && r.score <= avg * 0.5) r.status = 'free';
  }
  rows.sort((a, b) => b.score - a.score);
  return { rows, unassigned };
}

export type RiskLevel = 'overdue' | 'high' | 'medium';

export interface RiskRow {
  taskId: string;
  title: string;
  level: RiskLevel;
  daysLeft: number;
  reason: string;
}

/** Средний «жизненный цикл» задачи в днях по завершённым; без истории — 5 дней. */
export function averageCycleDays(tasks: ATask[], cols: ACol[]): number {
  const done = new Set(cols.filter((c) => c.isDone).map((c) => c.id));
  const cycles = tasks
    .filter((t) => done.has(t.columnId))
    .map((t) => (Date.parse(t.movedAt) - Date.parse(t.createdAt)) / DAY_MS)
    .filter((d) => Number.isFinite(d) && d > 0);
  if (cycles.length < 3) return 5;
  cycles.sort((a, b) => a - b);
  const median = cycles[Math.floor(cycles.length / 2)];
  return Math.min(Math.max(median, 1), 30);
}

/**
 * Оценка риска срыва срока.
 * Остаток работы ≈ средний цикл × доля пути до «Готово». Если это больше оставшихся дней — риск высокий.
 */
export function computeDeadlineRisks(tasks: ATask[], cols: ACol[], now: Date): RiskRow[] {
  const ordered = [...cols].sort((a, b) => a.position - b.position);
  const doneIdx = ordered.findIndex((c) => c.isDone);
  const lastIdx = doneIdx >= 0 ? doneIdx : ordered.length - 1;
  const doneIds = new Set(cols.filter((c) => c.isDone).map((c) => c.id));
  const cycle = averageCycleDays(tasks, cols);
  const out: RiskRow[] = [];

  for (const t of tasks) {
    if (!t.dueDate || doneIds.has(t.columnId)) continue;
    const left = daysUntil(t.dueDate, now);
    const stuck = Math.floor((now.getTime() - Date.parse(t.movedAt)) / DAY_MS);

    if (left < 0) {
      out.push({
        taskId: t.id,
        title: t.title,
        level: 'overdue',
        daysLeft: left,
        reason: `просрочена на ${-left} дн.`,
      });
      continue;
    }

    const idx = Math.max(ordered.findIndex((c) => c.id === t.columnId), 0);
    const remainingShare = lastIdx > 0 ? Math.max(0, (lastIdx - idx) / lastIdx) : 1;
    const needed = Math.ceil(cycle * remainingShare);

    if (needed > left) {
      out.push({
        taskId: t.id,
        title: t.title,
        level: 'high',
        daysLeft: left,
        reason: `до срока ${left} дн., а обычно на остаток пути нужно около ${needed} дн.`,
      });
    } else if (stuck >= 3 && left <= 7) {
      out.push({
        taskId: t.id,
        title: t.title,
        level: 'medium',
        daysLeft: left,
        reason: `${stuck} дн. без движения, до срока ${left} дн.`,
      });
    } else if (needed > left * 0.6 && left <= 3) {
      out.push({
        taskId: t.id,
        title: t.title,
        level: 'medium',
        daysLeft: left,
        reason: `срок через ${left} дн., запас небольшой`,
      });
    }
  }

  const rank: Record<RiskLevel, number> = { overdue: 0, high: 1, medium: 2 };
  out.sort((a, b) => rank[a.level] - rank[b.level] || a.daysLeft - b.daysLeft);
  return out;
}

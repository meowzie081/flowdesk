import { describe, expect, it } from 'vitest';
import { averageCycleDays, computeDeadlineRisks, computeWorkload, daysUntil, type ACol, type ATask } from './analytics';

const now = new Date(2026, 9, 12, 15, 0);
const cols: ACol[] = [
  { id: 'c1', position: 0, isDone: false },
  { id: 'c2', position: 1, isDone: false },
  { id: 'c3', position: 2, isDone: false },
  { id: 'c4', position: 3, isDone: true },
];
function task(id: string, col: string, as: string | null, pr: ATask['priority'], due: string | null, moved = '2026-10-11T10:00:00Z'): ATask {
  return { id, title: id, columnId: col, assigneeId: as, priority: pr, dueDate: due, createdAt: '2026-10-01T10:00:00Z', movedAt: moved };
}

describe('daysUntil', () => {
  it('считает календарные дни', () => {
    expect(daysUntil('2026-10-12', now)).toBe(0);
    expect(daysUntil('2026-10-10', now)).toBe(-2);
    expect(daysUntil('2026-10-15', now)).toBe(3);
  });
});

describe('computeWorkload', () => {
  const tasks = [
    ...Array.from({ length: 6 }, (_, i) => task('a' + i, 'c1', 'u1', 'high', '2026-10-11')),
    task('b1', 'c2', 'u2', 'low', null),
    task('b2', 'c1', 'u2', 'medium', null),
    task('c1', 'c2', 'u3', 'low', null),
    task('d1', 'c4', 'u1', 'high', null), // завершена — не считается
    task('x', 'c1', null, 'low', null),
  ];
  const { rows, unassigned } = computeWorkload(tasks, cols, ['u1', 'u2', 'u3', 'u4'], now);

  it('находит перегруженного и свободных', () => {
    expect(rows[0].userId).toBe('u1');
    expect(rows[0].status).toBe('overloaded');
    expect(rows[0].overdue).toBe(6);
    expect(rows.find((r) => r.userId === 'u4')?.status).toBe('free');
  });
  it('считает задачи без исполнителя и не берёт завершённые', () => {
    expect(unassigned).toBe(1);
    expect(rows[0].open).toBe(6);
  });
});

describe('computeDeadlineRisks', () => {
  it('сортирует: просрочено, высокий риск, средний; безопасные не показывает', () => {
    const risks = computeDeadlineRisks(
      [
        task('o', 'c2', null, 'low', '2026-10-10'),
        task('h', 'c1', null, 'low', '2026-10-13'),
        task('ok', 'c3', null, 'low', '2026-10-30'),
        task('m', 'c3', null, 'low', '2026-10-17', '2026-10-05T00:00:00Z'),
      ],
      cols,
      now,
    );
    expect(risks.map((r) => r.taskId)).toEqual(['o', 'h', 'm']);
    expect(risks.map((r) => r.level)).toEqual(['overdue', 'high', 'medium']);
  });
  it('без истории средний цикл — 5 дней', () => {
    expect(averageCycleDays([], cols)).toBe(5);
  });
});

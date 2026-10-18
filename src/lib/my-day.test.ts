import { describe, it, expect } from 'vitest';
import { localDay, todayTasks, type DayTask } from './my-day';
const task = (id: string, due_date: string | null, priority: DayTask['priority'] = 'medium', planned = false): DayTask => ({ id, title: id, due_date, priority, planned, blocked_reason: null });
describe('Мой день', () => {
    it('includes overdue, today and planned tasks, keeps unscheduled work outside', () => { expect(todayTasks([task('later', '2026-10-19'), task('overdue', '2026-10-17'), task('today', '2026-10-18'), task('manual', null, 'low', true), task('unscheduled', null)], '2026-10-18').map(t => t.id)).toEqual(['overdue', 'today', 'manual']); });
    it('sorts equal deadlines by priority without mutating input', () => { const items = [task('low', '2026-10-18', 'low'), task('high', '2026-10-18', 'high')]; expect(todayTasks(items, '2026-10-18')[0].id).toBe('high'); expect(items[0].id).toBe('low'); });
    it('uses local calendar fields at year boundaries', () => { expect(localDay(new Date(2027, 0, 1, 0, 1))).toBe('2027-01-01'); expect(localDay(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31'); });
});

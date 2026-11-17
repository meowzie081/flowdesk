import { describe, expect, it } from 'vitest';
import { applyColumnChange, applyTaskChange, mergeFetchedTasks, type RealtimeChange } from './board-sync';

const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  column_id: 'c1',
  position: 0,
  title: `Задача ${id}`,
  archived_at: null as string | null,
  task_checklist: [{ id: 'ch1', title: 'Шаг', is_done: false, position: 0 }],
  ...extra,
});

const change = (eventType: RealtimeChange['eventType'], row: Record<string, unknown>, old: Record<string, unknown> = {}): RealtimeChange => ({
  eventType,
  new: row,
  old,
});

describe('applyTaskChange', () => {
  it('INSERT требует догрузки строки с чек-листом', () => {
    const prev = [task('1')];
    const out = applyTaskChange(prev, change('INSERT', { id: '2' }));
    expect(out.rows).toBe(prev);
    expect(out.fetchIds).toEqual(['2']);
  });

  it('UPDATE сливает поля, сохраняя вложенный чек-лист', () => {
    const prev = [task('1')];
    const out = applyTaskChange(prev, change('UPDATE', { id: '1', column_id: 'c2', position: 3, title: 'Новое имя' }));
    expect(out.fetchIds).toEqual([]);
    expect(out.rows[0]).toMatchObject({ id: '1', column_id: 'c2', position: 3, title: 'Новое имя' });
    expect(out.rows[0].task_checklist).toEqual(prev[0].task_checklist);
  });

  it('UPDATE неизвестной строки требует догрузки', () => {
    const out = applyTaskChange([task('1')], change('UPDATE', { id: '9', position: 1 }));
    expect(out.fetchIds).toEqual(['9']);
  });

  it('UPDATE с archived_at скрывает карточку без удаления из состояния', () => {
    const prev = [task('1')];
    const out = applyTaskChange(prev, change('UPDATE', { id: '1', archived_at: '2026-11-17T10:00:00Z' }));
    expect(out.rows[0].archived_at).toBe('2026-11-17T10:00:00Z');
  });

  it('DELETE удаляет по old.id', () => {
    const out = applyTaskChange([task('1'), task('2')], change('DELETE', {}, { id: '1' }));
    expect(out.rows.map((t) => t.id)).toEqual(['2']);
  });

  it('событие без id не меняет состояние', () => {
    const prev = [task('1')];
    expect(applyTaskChange(prev, change('UPDATE', {})).rows).toBe(prev);
    expect(applyTaskChange(prev, change('DELETE', {}, {})).rows).toBe(prev);
  });
});

describe('applyColumnChange', () => {
  const col = (id: string, position: number) => ({ id, position, name: `Колонка ${id}`, is_done: false });

  it('INSERT добавляет и сортирует по position', () => {
    const out = applyColumnChange([col('a', 1), col('c', 3)], change('INSERT', col('b', 2)));
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('INSERT существующей колонки не дублирует', () => {
    const out = applyColumnChange([col('a', 1)], change('INSERT', { ...col('a', 1), name: 'Имя' }));
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Имя');
  });

  it('UPDATE меняет поля и пересортировывает', () => {
    const out = applyColumnChange([col('a', 1), col('b', 2)], change('UPDATE', { ...col('a', 5) }));
    expect(out.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('DELETE удаляет по old.id', () => {
    const out = applyColumnChange([col('a', 1), col('b', 2)], change('DELETE', {}, { id: 'a' }));
    expect(out.map((c) => c.id)).toEqual(['b']);
  });
});

describe('mergeFetchedTasks', () => {
  it('догруженная строка заменяет текущую и не дублируется', () => {
    const current = [task('1'), task('2')];
    const fetched = [task('2', { title: 'Свежие данные' }), task('3')];
    const out = mergeFetchedTasks(current, fetched);
    expect(out.map((t) => t.id).sort()).toEqual(['1', '2', '3']);
    expect(out.find((t) => t.id === '2')?.title).toBe('Свежие данные');
  });
});
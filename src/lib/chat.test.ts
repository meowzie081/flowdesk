import { describe, expect, it } from 'vitest';
import { mergeMessages, reconcileMessages } from './chat';

const m = (id: string, t: string) => ({ id, created_at: t });

describe('mergeMessages', () => {
  it('не дублирует сообщение, пришедшее дважды', () => {
    const prev = [m('1', '2026-10-12T10:00:00Z')];
    const out = mergeMessages(prev, [m('1', '2026-10-12T10:00:00Z'), m('2', '2026-10-12T10:01:00Z')]);
    expect(out.map((x) => x.id)).toEqual(['1', '2']);
  });
  it('сортирует по времени', () => {
    const out = mergeMessages([m('2', '2026-10-12T10:05:00Z')], [m('1', '2026-10-12T10:01:00Z')]);
    expect(out.map((x) => x.id)).toEqual(['1', '2']);
  });
  it('без новых сообщений возвращает тот же массив', () => {
    const prev = [m('1', '2026-10-12T10:00:00Z')];
    expect(mergeMessages(prev, [m('1', '2026-10-12T10:00:00Z')])).toBe(prev);
    expect(mergeMessages(prev, [])).toBe(prev);
  });
});


describe('reconcileMessages', () => {
  const row = { id: '1', created_at: '2026-10-12T10:00:00Z', deleted_at: null as string | null, body: 'Hello' };
  it('applies a deletion received from polling', () => {
    expect(reconcileMessages([row], [{ ...row, deleted_at: '2026-10-12T11:00:00Z', body: 'Сообщение удалено' }])[0].deleted_at).toBeTruthy();
  });
  it('does not resurrect a deletion with an older in-flight response', () => {
    const deleted = { ...row, deleted_at: '2026-10-12T11:00:00Z' };
    expect(reconcileMessages([deleted], [row])[0]).toEqual(deleted);
  });
  it('retains older history and deduplicates incoming events', () => {
    const newer = { ...row, id: '2', created_at: '2026-10-12T12:00:00Z' };
    expect(reconcileMessages([row], [newer, newer]).map(m => m.id)).toEqual(['1', '2']);
  });
});

import { describe, expect, it } from 'vitest';
import { csvToPayload, normalizeDate, normalizePriority, parseCsv, trelloToPayload, MAX_TASKS } from './import';

describe('parseCsv', () => {
  it('простые строки и CRLF', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('кавычки, запятые и переносы внутри поля', () => {
    expect(parseCsv('title,desc\n"Hello, world","line1\nline2"\n')).toEqual([
      ['title', 'desc'],
      ['Hello, world', 'line1\nline2'],
    ]);
  });
  it('экранированные кавычки и BOM', () => {
    expect(parseCsv('﻿a,b\n"say ""hi""",x')).toEqual([['a', 'b'], ['say "hi"', 'x']]);
  });
  it('пустые строки отбрасываются', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('normalizePriority', () => {
  it('русские и jira-значения', () => {
    expect(normalizePriority('Высокий')).toBe('high');
    expect(normalizePriority('Низкий')).toBe('low');
    expect(normalizePriority('Blocker')).toBe('high');
    expect(normalizePriority('Minor')).toBe('low');
    expect(normalizePriority('Medium')).toBe('medium');
    expect(normalizePriority('')).toBe('medium');
    expect(normalizePriority(null)).toBe('medium');
  });
});

describe('normalizeDate', () => {
  it('ISO и дата-время', () => {
    expect(normalizeDate('2026-12-01')).toBe('2026-12-01');
    expect(normalizeDate('2026-12-01T10:00:00.000Z')).toBe('2026-12-01');
  });
  it('мусор отбрасывается', () => {
    expect(normalizeDate('01/Dec/26')).toBeNull();
    expect(normalizeDate('')).toBeNull();
    expect(normalizeDate('2026-13-40')).toBeNull();
  });
});

describe('trelloToPayload', () => {
  const board = {
    name: 'Моя доска',
    lists: [
      { id: 'l1', name: 'Backlog', closed: false, pos: 2 },
      { id: 'l2', name: 'Готово', closed: false, pos: 1 },
      { id: 'l3', name: 'Архив', closed: true, pos: 3 },
    ],
    cards: [
      { id: 'c1', name: 'Задача 1', desc: 'описание', idList: 'l1', closed: false, due: '2026-12-01T10:00:00Z', pos: 1 },
      { id: 'c2', name: 'Задача 2', desc: '', idList: 'l2', closed: false, due: null, pos: 2 },
      { id: 'c3', name: 'Скрытая', idList: 'l1', closed: true, pos: 3 },
    ],
  };
  it('сортирует колонки по pos и маппит карточки', () => {
    const p = trelloToPayload(board);
    expect(p.board_name).toBe('Моя доска');
    expect(p.columns.map((c) => c.name)).toEqual(['Готово', 'Backlog']);
    expect(p.columns[0].is_done).toBe(true);
    expect(p.tasks).toHaveLength(2);
    expect(p.tasks[0]).toMatchObject({ title: 'Задача 1', column: 'Backlog', due_date: '2026-12-01' });
    expect(p.tasks[1].column).toBe('Готово');
  });
  it('не-Trello JSON отклоняется', () => {
    expect(() => trelloToPayload({ foo: 1 })).toThrow(/Trello/);
  });
});

describe('csvToPayload', () => {
  it('FlowDesk-экспорт', () => {
    const rows = parseCsv('Задача,Колонка,Приоритет,Исполнитель,Срок,Метки,Создана,Последнее движение,Описание\nДелать,В работе,Высокий,,2026-12-01,,2026-01-01,2026-01-02,текст\n');
    const p = csvToPayload(rows);
    expect(p.columns.map((c) => c.name)).toEqual(['В работе']);
    expect(p.tasks[0]).toMatchObject({ title: 'Делать', column: 'В работе', priority: 'high', due_date: '2026-12-01', description: 'текст' });
  });
  it('Jira CSV', () => {
    const rows = parseCsv('Summary,Status,Priority,Description,Due date\nFix bug,In Progress,High,desc,2026-11-20\n');
    const p = csvToPayload(rows);
    expect(p.tasks[0]).toMatchObject({ title: 'Fix bug', column: 'In Progress', priority: 'high', due_date: '2026-11-20' });
  });
  it('CSV без колонки статуса кладёт всё в Backlog', () => {
    const p = csvToPayload(parseCsv('title,description\nA,desc\nB,\n'));
    expect(p.columns.map((c) => c.name)).toEqual(['Backlog']);
    expect(p.tasks.map((t) => t.column)).toEqual(['Backlog', 'Backlog']);
  });
  it('без заголовка названия — ошибка', () => {
    expect(() => csvToPayload(parseCsv('foo,bar\n1,2\n'))).toThrow(/названием задачи/);
  });
  it('лимит задач', () => {
    const lines = ['title'];
    for (let i = 0; i <= MAX_TASKS; i++) lines.push(`T${i}`);
    expect(() => csvToPayload(parseCsv(lines.join('\n')))).toThrow(/Слишком много задач/);
  });
});
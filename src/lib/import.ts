export type ImportPriority = 'low' | 'medium' | 'high';
export type ImportColumn = { name: string; is_done: boolean };
export type ImportTask = {
  title: string;
  description: string;
  column: string;
  priority: ImportPriority;
  due_date: string | null;
};
export type ImportPayload = { board_name: string; columns: ImportColumn[]; tasks: ImportTask[] };

export const MAX_COLUMNS = 50;
export const MAX_TASKS = 2000;

const DONE_RE = /done|готово|заверш|complete|closed|выполн/i;

export function normalizePriority(raw: unknown): ImportPriority {
  const s = String(raw ?? '').trim().toLowerCase();
  if (/^(low|lowest|minor|trivial|низкий|низк)/.test(s)) return 'low';
  if (/^(high|highest|blocker|critical|major|высок|срочн|urgent)/.test(s)) return 'high';
  return 'medium';
}

/** Берём только безопасный ISO-префикс YYYY-MM-DD; остальное отбрасываем. */
export function normalizeDate(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  const d = new Date(m[1] + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? null : m[1];
}

function cleanName(raw: unknown, max: number): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Полноценный CSV-парсер: кавычки, экранированные кавычки, CRLF и BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') {
      if (s[i + 1] !== '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

type RawTask = { title: string; description: string; column?: string; priority?: unknown; due_date?: unknown };

function buildPayload(boardName: string, rawColumns: string[], rawTasks: RawTask[]): ImportPayload {
  const columns: ImportColumn[] = [];
  const seen = new Set<string>();
  for (const name of rawColumns) {
    const n = cleanName(name, 60);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    columns.push({ name: n, is_done: DONE_RE.test(n) });
  }
  if (columns.length === 0) columns.push({ name: 'Backlog', is_done: false });
  if (columns.length > MAX_COLUMNS) throw new Error(`Слишком много колонок: ${columns.length} (максимум ${MAX_COLUMNS}).`);
  const fallback = columns[0].name;
  const tasks: ImportTask[] = [];
  for (const t of rawTasks) {
    const title = cleanName(t.title, 200);
    if (!title) continue;
    const col = cleanName(t.column, 60);
    tasks.push({
      title,
      description: String(t.description ?? '').slice(0, 8000),
      column: seen.has(col) ? col : fallback,
      priority: normalizePriority(t.priority),
      due_date: normalizeDate(t.due_date),
    });
    if (tasks.length > MAX_TASKS) throw new Error(`Слишком много задач: больше ${MAX_TASKS}.`);
  }
  return { board_name: cleanName(boardName, 60) || 'Импорт', columns, tasks };
}

/** Экспорт доски Trello (JSON): lists → колонки, cards → задачи. */
export function trelloToPayload(json: unknown): ImportPayload {
  const obj = json as { name?: string; lists?: unknown[]; cards?: unknown[] };
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.lists) || !Array.isArray(obj.cards))
    throw new Error('Это не похоже на экспорт доски Trello (ожидаются поля lists и cards).');
  const lists = (obj.lists as { id?: string; name?: string; closed?: boolean; pos?: number }[])
    .filter((l) => !l.closed)
    .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
  const listName = new Map<string, string>();
  for (const l of lists) if (l.id) listName.set(l.id, String(l.name ?? ''));
  const cards = (obj.cards as { name?: string; desc?: string; idList?: string; closed?: boolean; due?: string | null; pos?: number }[])
    .filter((c) => !c.closed)
    .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
  return buildPayload(
    obj.name ?? 'Импорт Trello',
    lists.map((l) => String(l.name ?? '')),
    cards.map((c) => ({
      title: String(c.name ?? ''),
      description: String(c.desc ?? ''),
      column: c.idList ? listName.get(c.idList) ?? '' : '',
      priority: 'medium',
      due_date: c.due ?? null,
    })),
  );
}

const TITLE_KEYS = ['задача', 'title', 'summary', 'task', 'название', 'тема', 'name'];
const COLUMN_KEYS = ['колонка', 'column', 'status', 'статус', 'state', 'list', 'stage'];
const DESC_KEYS = ['описание', 'description', 'details', 'body'];
const PRIORITY_KEYS = ['приоритет', 'priority'];
const DUE_KEYS = ['срок', 'due date', 'due', 'deadline', 'дата завершения'];

function findIndex(header: string[], keys: string[]): number {
  return header.findIndex((h) => keys.includes(h));
}

/** CSV: FlowDesk-экспорт, Jira CSV или произвольный CSV с заголовками. */
export function csvToPayload(rows: string[][]): ImportPayload {
  if (rows.length === 0) throw new Error('CSV-файл пуст.');
  const header = rows[0].map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
  const ti = findIndex(header, TITLE_KEYS);
  if (ti < 0) throw new Error('Не найдена колонка с названием задачи (ожидаются «Задача», Summary или Title).');
  const ci = findIndex(header, COLUMN_KEYS);
  const di = findIndex(header, DESC_KEYS);
  const pi = findIndex(header, PRIORITY_KEYS);
  const ui = findIndex(header, DUE_KEYS);
  const cell = (r: string[], i: number) => (i >= 0 ? r[i] ?? '' : '');
  const columnOrder: string[] = [];
  const rawTasks = rows.slice(1).map((r) => {
    const column = ci >= 0 ? cell(r, ci) : 'Backlog';
    if (ci >= 0 && column.trim()) columnOrder.push(column);
    return {
      title: cell(r, ti),
      description: cell(r, di),
      column,
      priority: normalizePriority(cell(r, pi)),
      due_date: normalizeDate(cell(r, ui)),
    };
  });
  return buildPayload('Импорт CSV', ci >= 0 ? columnOrder : ['Backlog'], rawTasks);
}
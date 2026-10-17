export interface ChecklistItem { id: string; title: string; is_done: boolean; position: number }
export interface ReadInfo { count: number; first_id: string | null; last_read_at: string; last_read_id: string }
export const CHAT_FIELDS = 'id, author_id, body, is_ai, created_at, files, deleted_at, parent_id, mentions, is_pinned, reply_count';

export function checklistProgress(items: ChecklistItem[] = []) {
  const done = items.filter(i => i.is_done).length;
  return { done, total: items.length, percent: items.length ? Math.round(done / items.length * 100) : 0 };
}

export function mentionToken(id: string, name: string) {
  return `@[${name.replace(/[\[\]@]/g, '').trim() || 'Участник'}](${id})`;
}
export function extractMentions(text: string, memberIds: string[]) {
  const allowed = new Set(memberIds);
  const ids = Array.from(text.matchAll(/@\[[^\]]+\]\(([0-9a-f-]{36})\)/gi)).map(m => m[1]);
  return [...new Set(ids.filter(id => allowed.has(id)))];
}
export function displayMentions(text: string) {
  return text.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/gi, '@$1');
}
export function moscowDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function dayBounds(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Некорректная дата');
  const start = new Date(`${date}T00:00:00+03:00`);
  if (!Number.isFinite(start.getTime()) || moscowDay(start) !== date) throw new Error('Некорректная дата');
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}
export function columnLoad(count: number, limit: number | null | undefined) {
  return { exceeded: !!limit && count > limit, label: limit ? `${count} / ${limit}` : String(count) };
}

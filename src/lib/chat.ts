export interface ChatMsg {
  id: string;
  created_at: string;
}

/** Добавляет новые сообщения в список без дублей (одно сообщение может прийти и из ответа на отправку, и из Realtime, и из опроса) и сортирует по времени. */
export function mergeMessages<T extends ChatMsg>(prev: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return prev;
  const known = new Set(prev.map((m) => m.id));
  const fresh = incoming.filter((m) => !known.has(m.id));
  if (fresh.length === 0) return prev;
  // фильтр по id выше уже убрал дубли среди пришедших и старых; дубли внутри fresh убираем здесь
  const seen = new Set<string>();
  const unique = fresh.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  return [...prev, ...unique].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

/** Refresh loaded rows, preserving deletions against an older in-flight poll. */
export function reconcileMessages<T extends ChatMsg & { deleted_at: string | null }>(prev: T[], incoming: T[]): T[] {
  const byId = new Map(prev.map(m => [m.id, m]));
  for (const message of incoming) {
    const old = byId.get(message.id);
    if (!old?.deleted_at || message.deleted_at) byId.set(message.id, message);
  }
  return [...byId.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
}

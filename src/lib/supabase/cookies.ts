const AUTH_COOKIE = /^(sb-.+-auth-token)(?:\.(\d+))?$/;

function parsesSession(value: string): boolean {
  try {
    const raw = value.startsWith('base64-') ? value.slice(7) : value;
    const json = raw.startsWith('{') ? raw : atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(json);
    return !!parsed && typeof parsed === 'object';
  } catch {
    return false;
  }
}

/**
 * supabase/ssr бросает исключение на повреждённой cookie сессии (500 вместо экрана входа).
 * Невалидные auth-cookie считаем отсутствующими: пользователь увидит login, а не ошибку.
 * Чанки (.0, .1, …) проверяются собранной строкой, иначе осколок не отличить от мусора.
 */
export function sanitizeAuthCookies<T extends { name: string; value: string }>(cookies: T[]): T[] {
  const kept: T[] = [];
  const chunks = new Map<string, { index: number; cookie: T }[]>();
  for (const cookie of cookies) {
    const match = cookie.name.match(AUTH_COOKIE);
    if (!match) {
      kept.push(cookie);
      continue;
    }
    if (match[2] === undefined) {
      if (parsesSession(cookie.value)) kept.push(cookie);
      continue;
    }
    const list = chunks.get(match[1]) ?? [];
    list.push({ index: Number(match[2]), cookie });
    chunks.set(match[1], list);
  }
  for (const list of chunks.values()) {
    const joined = list
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.cookie.value)
      .join('');
    if (parsesSession(joined)) kept.push(...list.map((entry) => entry.cookie));
  }
  return kept;
}

export function parseDocumentCookies(): { name: string; value: string }[] {
  return document.cookie
    .split('; ')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=');
      return { name: pair.slice(0, eq), value: decodeURIComponent(pair.slice(eq + 1)) };
    });
}

/** Удаляет повреждённые auth-cookie в браузере до создания клиента Supabase. */
export function purgeInvalidAuthCookies(): void {
  // Клиентские компоненты вызывают createClient() и при SSR — там document нет.
  if (typeof document === 'undefined') return;
  const all = parseDocumentCookies();
  const valid = new Set(sanitizeAuthCookies(all).map((c) => c.name));
  for (const cookie of all) {
    if (AUTH_COOKIE.test(cookie.name) && !valid.has(cookie.name)) {
      document.cookie = `${cookie.name}=; Max-Age=0; path=/`;
    }
  }
}
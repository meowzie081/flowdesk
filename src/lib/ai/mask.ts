/**
 * Автомаскирование персональных данных и секретов перед отправкой в ИИ.
 * Чистая функция: без побочных эффектов, легко тестируется.
 */

export type MaskKind = 'email' | 'phone' | 'token';

export interface MaskMatch {
  kind: MaskKind;
  placeholder: string;
  original: string;
}

export interface MaskResult {
  text: string;
  matches: MaskMatch[];
  counts: Record<MaskKind, number>;
}

// Порядок важен: токены → email → телефоны (чтобы цифры токена не стали «телефоном»)
const RULES: { kind: MaskKind; label: string; re: RegExp }[] = [
  {
    kind: 'token',
    label: 'TOKEN',
    // sk-..., ghp_..., gsk_..., AIza..., JWT, длинные hex/base64-строки
    re: /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{32,})\b/g,
  },
  {
    kind: 'email',
    label: 'EMAIL',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    kind: 'phone',
    label: 'PHONE',
    // +7 (999) 123-45-67, 8 999 123 45 67, +31 6 12345678 и т.п. (10–15 цифр)
    re: /(?<![\w])(?:\+?\d[\d\s().-]{8,16}\d)(?![\w])/g,
  },
];

function digitsCount(s: string): number {
  return (s.match(/\d/g) ?? []).length;
}

export function maskSensitive(input: string): MaskResult {
  const counts: Record<MaskKind, number> = { email: 0, phone: 0, token: 0 };
  const matches: MaskMatch[] = [];
  // один и тот же оригинал получает один и тот же плейсхолдер
  const seen = new Map<string, string>();
  let text = input;

  for (const rule of RULES) {
    text = text.replace(rule.re, (found) => {
      if (rule.kind === 'phone') {
        const d = digitsCount(found);
        if (d < 10 || d > 15) return found; // не телефон (дата, сумма и т.д.)
      }
      const key = `${rule.kind}:${found}`;
      let placeholder = seen.get(key);
      if (!placeholder) {
        counts[rule.kind] += 1;
        placeholder = `[${rule.label}_${counts[rule.kind]}]`;
        seen.set(key, placeholder);
        matches.push({ kind: rule.kind, placeholder, original: found });
      }
      return placeholder;
    });
  }

  return { text, matches, counts };
}

/** Обратная подстановка: ответ ИИ может ссылаться на плейсхолдеры. */
export function unmask(text: string, matches: MaskMatch[]): string {
  return matches.reduce(
    (acc, m) => acc.split(m.placeholder).join(m.original),
    text,
  );
}

export function totalMasked(counts: Record<MaskKind, number>): number {
  return counts.email + counts.phone + counts.token;
}

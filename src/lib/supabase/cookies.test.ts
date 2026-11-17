import { describe, expect, it } from 'vitest';
import { sanitizeAuthCookies } from './cookies';

const NAME = 'sb-project-auth-token';

function b64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

const session = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ access_token: 'token', refresh_token: 'refresh', user: { id: 'u1' }, ...extra });

describe('sanitizeAuthCookies', () => {
  it('пропускает валидную base64-сессию', () => {
    const cookies = [{ name: NAME, value: `base64-${b64url(session())}` }];
    expect(sanitizeAuthCookies(cookies)).toEqual(cookies);
  });

  it('пропускает legacy JSON-сессию без префикса', () => {
    const cookies = [{ name: NAME, value: session() }];
    expect(sanitizeAuthCookies(cookies)).toEqual(cookies);
  });

  it('удаляет cookie с невалидным base64 (причина 500 в middleware)', () => {
    expect(sanitizeAuthCookies([{ name: NAME, value: 'base64-!!!invalid!!!' }])).toEqual([]);
  });

  it('удаляет cookie с валидным base64, но не JSON', () => {
    expect(sanitizeAuthCookies([{ name: NAME, value: `base64-${b64url('not json')}` }])).toEqual([]);
  });

  it('собирает чанки и пропускает валидную длинную сессию', () => {
    const value = `base64-${b64url(session({ big: 'x'.repeat(5000) }))}`;
    const cookies = [
      { name: `${NAME}.0`, value: value.slice(0, 3000) },
      { name: `${NAME}.1`, value: value.slice(3000) },
    ];
    expect(sanitizeAuthCookies(cookies)).toHaveLength(2);
  });

  it('удаляет все чанки, если собранный фрагмент повреждён', () => {
    const value = `base64-${b64url(session())}`;
    const cookies = [
      { name: `${NAME}.0`, value: value.slice(0, 20) },
      { name: `${NAME}.1`, value: '!!!' },
    ];
    expect(sanitizeAuthCookies(cookies)).toEqual([]);
  });

  it('не трогает посторонние cookie', () => {
    const cookies = [
      { name: 'theme', value: 'dark' },
      { name: `${NAME}-code-verifier`, value: 'plain-verifier' },
    ];
    expect(sanitizeAuthCookies(cookies)).toEqual(cookies);
  });

  it('смешанный набор: мусор удалён, валидное осталось', () => {
    const good = { name: NAME, value: `base64-${b64url(session())}` };
    const out = sanitizeAuthCookies([{ name: 'theme', value: 'dark' }, { name: NAME, value: 'base64-!!' }, good]);
    expect(out).toEqual([{ name: 'theme', value: 'dark' }, good]);
  });
});
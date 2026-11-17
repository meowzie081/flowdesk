import { describe, expect, it } from 'vitest';
import { en, ru, translate } from './dictionary';

describe('i18n dictionary', () => {
  it('ru and en have identical key sets', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
  });

  it('has no empty values', () => {
    for (const [key, value] of Object.entries(ru)) expect(value.trim(), `ru ${key}`).not.toBe('');
    for (const [key, value] of Object.entries(en)) expect(value.trim(), `en ${key}`).not.toBe('');
  });

  it('translates per language', () => {
    expect(translate('ru', 'common.signIn')).toBe('Войти');
    expect(translate('en', 'common.signIn')).toBe('Sign in');
  });

  it('falls back en → ru → key', () => {
    expect(translate('en', 'no.such.key')).toBe('no.such.key');
    const ruOnly = 'test.ruOnly';
    ru[ruOnly] = 'только по-русски';
    try {
      expect(translate('en', ruOnly)).toBe('только по-русски');
      expect(translate('ru', ruOnly)).toBe('только по-русски');
    } finally {
      delete ru[ruOnly];
    }
  });

  it('interpolates variables, including repeated ones', () => {
    expect(translate('en', 'auth.noticeSent', { email: 'a@b.c' })).toContain('a@b.c');
    expect(translate('ru', 'bell.unreadMessages', { count: 3 })).toBe('3 непрочитанных сообщений');
    const key = 'test.repeat';
    ru[key] = '{x} и {x}';
    try {
      expect(translate('ru', key, { x: '1' })).toBe('1 и 1');
    } finally {
      delete ru[key];
    }
  });
});
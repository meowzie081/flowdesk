import { describe, expect, it } from 'vitest';
import { chunk, confirmationMatches } from './departments';

describe('confirmationMatches', () => {
  it('совпадает без учёта регистра и пробелов по краям', () => {
    expect(confirmationMatches('  it-отдел ', 'IT-отдел')).toBe(true);
  });
  it('пустой ввод и другое название не подходят', () => {
    expect(confirmationMatches('', 'Design')).toBe(false);
    expect(confirmationMatches('   ', '   ')).toBe(false);
    expect(confirmationMatches('Desig', 'Design')).toBe(false);
  });
});

describe('chunk', () => {
  it('режет на пачки', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { csvCell, csvRow, toCsv } from './csv';

describe('csvCell', () => {
  it('оборачивает в кавычки и удваивает кавычки внутри', () => {
    expect(csvCell('Сказал "привет"')).toBe('"Сказал ""привет"""');
  });

  it('пустые значения дают пустую ячейку', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it('защищает от CSV-инъекции', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe('"\'=SUM(A1:A9)"');
    expect(csvCell('+7 999 123-45-67')).toBe('"\'+7 999 123-45-67"');
    expect(csvCell('@cmd')).toBe('"\'@cmd"');
  });

  it('обычный текст и числа не меняются', () => {
    expect(csvCell('Релиз')).toBe('"Релиз"');
    expect(csvCell(5)).toBe('"5"');
  });
});

describe('toCsv', () => {
  it('собирает файл с BOM и переносами строк', () => {
    const out = toCsv(['a', 'b'], [['1', 'x,y']]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out).toBe('﻿"a","b"\r\n"1","x,y"\r\n');
  });

  it('csvRow склеивает ячейки запятыми', () => {
    expect(csvRow(['a', 'b'])).toBe('"a","b"');
  });
});

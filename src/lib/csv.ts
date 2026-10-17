/**
 * Ячейка CSV для открытия в Excel/Numbers.
 * Значения, начинающиеся с = + - @ (или табуляции), экранируются апострофом:
 * иначе таблица выполнит их как формулу (CSV-инъекция).
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}

/** Файл с BOM, чтобы кириллица открывалась в Excel корректно. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return '﻿' + [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}

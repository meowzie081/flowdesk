/** Подтверждение удаления: нужно точно ввести название отдела (пробелы по краям и регистр не важны). */
export function confirmationMatches(input: string, departmentName: string): boolean {
  const a = input.trim().toLowerCase();
  return a.length > 0 && a === departmentName.trim().toLowerCase();
}

/** Режет список на пачки (Storage удаляет файлы пачками). */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

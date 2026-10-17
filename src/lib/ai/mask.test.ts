import { describe, expect, it } from 'vitest';
import { maskSensitive, totalMasked, unmask } from './mask';

describe('maskSensitive', () => {
  it('маскирует email', () => {
    const r = maskSensitive('Напиши на ivan.petrov@example.com завтра');
    expect(r.text).toBe('Напиши на [EMAIL_1] завтра');
    expect(r.counts.email).toBe(1);
  });

  it('маскирует телефоны в разных форматах', () => {
    const r = maskSensitive('Звони +7 (999) 123-45-67 или 8 999 765 43 21');
    expect(r.text).toBe('Звони [PHONE_1] или [PHONE_2]');
    expect(r.counts.phone).toBe(2);
  });

  it('не принимает дату и короткие числа за телефон', () => {
    const r = maskSensitive('Релиз 13.10.2026, бюджет 150000 руб.');
    expect(r.text).toBe('Релиз 13.10.2026, бюджет 150000 руб.');
    expect(totalMasked(r.counts)).toBe(0);
  });

  it('маскирует токены и ключи', () => {
    const r = maskSensitive(
      'key=sk-abcdefghijklmnop1234567890 и gsk_abcdefghijklmnopqrstuvwxyz12',
    );
    expect(r.counts.token).toBe(2);
    expect(r.text).not.toContain('sk-abcdef');
    expect(r.text).not.toContain('gsk_abcdef');
  });

  it('один оригинал получает один плейсхолдер', () => {
    const r = maskSensitive('a@b.com, потом снова a@b.com');
    expect(r.text).toBe('[EMAIL_1], потом снова [EMAIL_1]');
    expect(r.counts.email).toBe(1);
  });

  it('unmask возвращает оригиналы', () => {
    const r = maskSensitive('Свяжись с a@b.com');
    expect(unmask('Ответ для [EMAIL_1]', r.matches)).toBe('Ответ для a@b.com');
  });
});

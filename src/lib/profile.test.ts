import { describe, expect, it } from 'vitest';
import { COLORS, contrastRatio, isReadableColor, lookFromRow, profileSchema } from './profile';

describe('цвет ника', () => {
  it('контраст чёрного и белого — 21', () => {
    expect(Math.round(contrastRatio('#000000', '#ffffff'))).toBe(21);
  });
  it('все готовые цвета читаются на обеих темах', () => {
    for (const c of COLORS) expect(isReadableColor(c)).toBe(true);
  });
  it('почти белый и почти чёрный отклоняются', () => {
    expect(isReadableColor('#fefefe')).toBe(false);
    expect(isReadableColor('#050505')).toBe(false);
  });
  it('не-hex отклоняется', () => {
    expect(isReadableColor('red')).toBe(false);
    expect(isReadableColor('#12345')).toBe(false);
  });
});

describe('profileSchema', () => {
  it('принимает корректный профиль', () => {
    expect(profileSchema.safeParse({ full_name: ' Камиль ', avatar_icon: '🦊', name_color: '#2563eb' }).success).toBe(true);
  });
  it('отклоняет пустое имя и нечитаемый цвет', () => {
    expect(profileSchema.safeParse({ full_name: ' ', avatar_icon: null, name_color: null }).success).toBe(false);
    expect(profileSchema.safeParse({ full_name: 'A', avatar_icon: null, name_color: '#ffffff' }).success).toBe(false);
  });
});

describe('lookFromRow', () => {
  it('понимает массив и объект, подставляет имя по умолчанию', () => {
    expect(lookFromRow([{ full_name: 'Аня', avatar_icon: '🐱', name_color: '#dc2626' }], 'x')).toEqual({
      name: 'Аня',
      icon: '🐱',
      color: '#dc2626',
    });
    expect(lookFromRow(null, 'abcd1234')).toEqual({ name: 'abcd1234', icon: null, color: null });
  });
  it('игнорирует некорректный цвет', () => {
    expect(lookFromRow({ full_name: 'B', name_color: 'javascript:1' }, 'x').color).toBeNull();
  });
});

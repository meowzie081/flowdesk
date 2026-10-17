import { describe, expect, it } from 'vitest';
import { meetingMessage, parseMeeting } from './meeting';

describe('parseMeeting', () => {
  it('достаёт JSON из блока кода и подставляет значения по умолчанию', () => {
    const m = parseMeeting('Вот:\n```json\n{"summary":"s","decisions":["d1"],"tasks":[{"title":"t"}]}\n```');
    expect(m?.tasks[0]).toEqual({ title: 't', description: '', priority: 'medium' });
    expect(m?.decisions).toEqual(['d1']);
  });
  it('мусор даёт null', () => {
    expect(parseMeeting('чепуха')).toBeNull();
    expect(parseMeeting('{сломано}')).toBeNull();
  });
  it('формирует сообщение с решениями', () => {
    const text = meetingMessage({ summary: 'Обсудили релиз', decisions: ['Релиз в пятницу'], tasks: [] });
    expect(text).toContain('Итоги встречи');
    expect(text).toContain('- Релиз в пятницу');
  });
});

import { describe, expect, it } from 'vitest';
import { parseSlash } from './commands';

describe('parseSlash', () => {
  it('разбирает команду с аргументами', () => {
    expect(parseSlash('/task сделать отчёт')).toEqual({
      command: 'task',
      args: 'сделать отчёт',
    });
  });

  it('команда без аргументов', () => {
    expect(parseSlash('/standup')).toEqual({ command: 'standup', args: '' });
  });

  it('игнорирует неизвестные команды и обычный текст', () => {
    expect(parseSlash('/unknown x')).toBeNull();
    expect(parseSlash('привет')).toBeNull();
  });
});

import { usesBoardData } from './commands';

describe('usesBoardData', () => {
  it('данные доски нужны только для /ask и /standup', () => {
    expect(usesBoardData('ask')).toBe(true);
    expect(usesBoardData('standup')).toBe(true);
    expect(usesBoardData('summary')).toBe(false);
    expect(usesBoardData('task')).toBe(false);
  });
});

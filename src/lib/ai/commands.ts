export type SlashCommand = 'task' | 'summary' | 'ask' | 'standup' | 'meeting';

/** Все команды сервера ИИ: слэш-команды чата + служебные (дайджест, блокеры). */
export type AiCommand = SlashCommand | 'digest' | 'blocker' | 'report';

export interface ParsedCommand {
  command: SlashCommand;
  args: string;
}

const COMMANDS: SlashCommand[] = ['task', 'summary', 'ask', 'standup', 'meeting'];

/** Разбирает "/task сделать отчёт" → { command: 'task', args: 'сделать отчёт' } */
export function parseSlash(input: string): ParsedCommand | null {
  const m = input.trim().match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const command = m[1].toLowerCase() as SlashCommand;
  if (!COMMANDS.includes(command)) return null;
  return { command, args: (m[2] ?? '').trim() };
}

export const COMMAND_HELP: Record<SlashCommand, string> = {
  task: '/task <текст> — создать черновик карточки',
  summary: '/summary — краткое резюме последних сообщений',
  ask: '/ask <вопрос> — вопрос ИИ по доске и чату отдела',
  standup: '/standup — сводка для стендапа по данным доски',
  meeting: '/meeting <заметки> — решения и задачи из заметок встречи (Shift+Enter — новая строка)',
};

/** Команды, для которых сервер добавляет данные доски. */
export function usesBoardData(command: SlashCommand): boolean {
  return command === 'ask' || command === 'standup';
}

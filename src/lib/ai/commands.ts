export type SlashCommand = 'task' | 'summary' | 'ask' | 'standup' | 'meeting';

/** Все команды сервера ИИ: слэш-команды чата + служебные (дайджест, блокеры). */
export type AiCommand = SlashCommand | 'digest' | 'blocker' | 'report';

export interface ParsedCommand {
  command: SlashCommand;
  args: string;
}

export const SLASH_COMMANDS: SlashCommand[] = ['task', 'summary', 'ask', 'standup', 'meeting'];

/** Разбирает "/task сделать отчёт" → { command: 'task', args: 'сделать отчёт' } */
export function parseSlash(input: string): ParsedCommand | null {
  const m = input.trim().match(/^\/([a-z]+)(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const command = m[1].toLowerCase() as SlashCommand;
  if (!SLASH_COMMANDS.includes(command)) return null;
  return { command, args: (m[2] ?? '').trim() };
}

/** Команды, для которых сервер добавляет данные доски. */
export function usesBoardData(command: SlashCommand): boolean {
  return command === 'ask' || command === 'standup';
}

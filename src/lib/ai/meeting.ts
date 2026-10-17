import { z } from 'zod';

const taskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().default(''),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

const meetingSchema = z.object({
  summary: z.string().default(''),
  decisions: z.array(z.string()).default([]),
  tasks: z.array(taskSchema).default([]),
});

export type MeetingResult = z.infer<typeof meetingSchema>;

/** Достаёт JSON из ответа модели (она может обернуть его в ```json или добавить пояснение). */
export function parseMeeting(raw: string): MeetingResult | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = meetingSchema.safeParse(JSON.parse(raw.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Текст сообщения в чат: резюме и решения (задачи показываются отдельно как черновики). */
export function meetingMessage(m: MeetingResult): string {
  const parts: string[] = ['**Итоги встречи**'];
  if (m.summary.trim()) parts.push(m.summary.trim());
  if (m.decisions.length) {
    parts.push('**Решения:**\n' + m.decisions.map((d) => `- ${d}`).join('\n'));
  }
  if (m.tasks.length) parts.push(`Задач предложено: ${m.tasks.length} — подтвердите их ниже.`);
  return parts.join('\n\n').slice(0, 4000);
}

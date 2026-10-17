import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { maskSensitive, totalMasked, unmask } from '@/lib/ai/mask';
import { callLLM, currentProvider } from '@/lib/ai/provider';
import { SYSTEM } from '@/lib/ai/prompts';
import {
  buildBoardContext,
  buildDigestContext,
  buildReportContext,
  buildTaskContext,
} from '@/lib/ai/boardContext';

const RATE_LIMIT_PER_MINUTE = 10;
const DAY_MS = 86_400_000;

const bodySchema = z.object({
  departmentId: z.string().uuid(),
  command: z.enum(['task', 'summary', 'ask', 'standup', 'digest', 'blocker', 'meeting', 'report']),
  input: z.string().max(8000).default(''),
  context: z.string().max(16000).default(''),
  // для digest: с какого момента собирать события
  since: z.string().max(40).optional(),
  // для blocker: какая задача
  taskId: z.string().uuid().optional(),
  // режим предпросмотра: показать, что уйдёт в ИИ, не вызывая модель
  dryRun: z.boolean().default(false),
});

function parseSince(value?: string): string {
  const t = value ? Date.parse(value) : NaN;
  return new Date(Number.isFinite(t) ? t : Date.now() - 7 * DAY_MS).toISOString();
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { departmentId, command, input, context, since, taskId, dryRun } = parsed.data;

  // Проверка прав: viewer не может вызывать ИИ (RLS на ai_logs это тоже гарантирует)
  const { data: membership } = await supabase
    .from('department_members')
    .select('role')
    .eq('department_id', departmentId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership || membership.role === 'viewer') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Ограничение частоты: бесплатные ключи легко исчерпать
  if (!dryRun) {
    const { count } = await supabase
      .from('ai_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - 60_000).toISOString());
    if ((count ?? 0) >= RATE_LIMIT_PER_MINUTE) {
      return NextResponse.json(
        { error: 'rate_limited', detail: 'Слишком много запросов к ИИ, подождите минуту' },
        { status: 429 },
      );
    }
  }

  // Данные из базы собирает сервер (с правами пользователя), клиентам они не доверяются
  let serverContext = '';
  if (command === 'standup' || command === 'ask') {
    serverContext = await buildBoardContext(supabase, departmentId);
  } else if (command === 'digest') {
    serverContext = await buildDigestContext(supabase, departmentId, parseSince(since));
  } else if (command === 'report') {
    serverContext = await buildReportContext(supabase, departmentId, parseSince(since));
  } else if (command === 'blocker') {
    if (!taskId) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    serverContext = await buildTaskContext(supabase, departmentId, taskId);
    if (!serverContext) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const payload = [
    serverContext && `Данные из системы:\n${serverContext}`,
    context && `Контекст чата:\n${context}`,
    input && `Запрос:\n${input}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  if (!payload.trim()) {
    return NextResponse.json(
      { error: 'empty', detail: 'Нет данных для обработки' },
      { status: 400 },
    );
  }

  const masked = maskSensitive(payload);

  // Индикатор «что уйдёт в ИИ»
  const preview = {
    text: masked.text,
    maskedCount: totalMasked(masked.counts),
    counts: masked.counts,
    sentChars: masked.text.length,
    provider: currentProvider(),
  };
  if (dryRun) return NextResponse.json({ preview });

  let answer: string;
  try {
    answer = await callLLM(SYSTEM[command], masked.text);
  } catch (e) {
    console.error('[ai] ошибка вызова модели:', e);
    return NextResponse.json(
      { error: 'ai_unavailable', detail: e instanceof Error ? e.message : 'unknown' },
      { status: 502 },
    );
  }

  await supabase.from('ai_logs').insert({
    department_id: departmentId,
    user_id: user.id,
    command,
    masked_count: preview.maskedCount,
    sent_chars: preview.sentChars,
    provider: preview.provider,
  });

  return NextResponse.json({
    answer: unmask(answer, masked.matches),
    preview: { ...preview, text: undefined },
  });
}

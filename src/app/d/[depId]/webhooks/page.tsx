import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

const EVENTS = ['task.created', 'task.moved', 'task.done', 'task.assigned', 'task.commented'] as const;
const EVENT_LABELS: Record<string, string> = {
  'task.created': 'создание задачи',
  'task.moved': 'перемещение',
  'task.done': 'завершение',
  'task.assigned': 'назначение',
  'task.commented': 'комментарий',
};

const NOTICE: Record<string, { text: string; error?: boolean }> = {
  created: { text: 'Вебхук создан. Секрет показан ниже — скопируйте его в принимающий сервис.' },
  invalid: { text: 'Нужен HTTPS-адрес (до 2000 символов) и хотя бы одно событие.', error: true },
  limit: { text: 'Не более пяти вебхуков на отдел. Удалите неиспользуемый.', error: true },
  error: { text: 'Не удалось сохранить вебхук. Настраивать вебхуки может только владелец отдела.', error: true },
};

export default async function WebhooksPage({
  params,
  searchParams,
}: {
  params: { depId: string };
  searchParams: { hook?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from('department_members')
    .select('role')
    .eq('department_id', params.depId)
    .eq('user_id', user!.id)
    .maybeSingle();

  if (membership?.role !== 'owner') {
    return (
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Вебхуки</h1>
        <p className="mt-2 text-sm text-mute">Вебхуки на события отдела настраивает владелец отдела.</p>
      </div>
    );
  }

  const { data: hooks, error } = await supabase
    .from('api_webhooks')
    .select('id,url,secret,events,active,created_at')
    .eq('department_id', params.depId)
    .order('created_at');

  async function createHook(formData: FormData) {
    'use server';
    const url = String(formData.get('url') ?? '').trim();
    const events = formData.getAll('events').map(String).filter((e) => (EVENTS as readonly string[]).includes(e));
    if (!/^https:\/\/\S{1,1990}$/.test(url) || url.length > 2000 || events.length === 0) {
      redirect(`/d/${params.depId}/webhooks?hook=invalid`);
    }
    const sb = createClient();
    const {
      data: { user: actor },
    } = await sb.auth.getUser();
    const { error: insertError } = await sb.from('api_webhooks').insert({
      department_id: params.depId,
      url,
      secret: 'whsec_' + randomBytes(24).toString('base64url'),
      events,
      created_by: actor!.id,
    });
    if (insertError) {
      redirect(`/d/${params.depId}/webhooks?hook=${insertError.message.includes('пяти вебхуков') ? 'limit' : 'error'}`);
    }
    revalidatePath(`/d/${params.depId}/webhooks`);
    redirect(`/d/${params.depId}/webhooks?hook=created`);
  }

  async function toggleHook(formData: FormData) {
    'use server';
    const id = String(formData.get('id'));
    const active = String(formData.get('active')) === 'true';
    const sb = createClient();
    await sb.from('api_webhooks').update({ active }).eq('id', id).eq('department_id', params.depId);
    revalidatePath(`/d/${params.depId}/webhooks`);
  }

  async function deleteHook(formData: FormData) {
    'use server';
    const id = String(formData.get('id'));
    const sb = createClient();
    await sb.from('api_webhooks').delete().eq('id', id).eq('department_id', params.depId);
    revalidatePath(`/d/${params.depId}/webhooks`);
  }

  const notice = searchParams.hook ? NOTICE[searchParams.hook] : undefined;

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Вебхуки</h1>
      <p className="mt-2 max-w-2xl text-sm text-mute">
        FlowDesk отправляет POST-запросы на ваш HTTPS-адрес при событиях с задачами отдела. Каждый запрос подписан секретом
        (заголовок X-FlowDesk-Signature). Доставка повторяется при сбоях до 5 попыток. Формат и проверка подписи — docs/API.md.
      </p>

      {error ? (
        <p className="mt-4 rounded-lg border border-line p-4 text-sm text-mute">
          Вебхуки ещё не включены в этой базе. Примените миграцию 0024 в Supabase SQL Editor.
        </p>
      ) : (
        <>
          <form action={createHook} className="mt-6 rounded-lg border border-line p-4">
            <h2 className="text-sm font-medium">Новый вебхук</h2>
            <input name="url" type="url" required maxLength={2000} placeholder="https://example.com/flowdesk" className="input mt-2 w-full max-w-md" />
            <fieldset className="mt-3">
              <legend className="text-xs text-mute">События</legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {EVENTS.map((e) => (
                  <label key={e} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="events" value={e} defaultChecked />
                    {EVENT_LABELS[e]}
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="btn-solid mt-3">Добавить</button>
            {notice && <p className={`mt-2 text-sm ${notice.error ? 'text-red-600' : 'text-mute'}`}>{notice.text}</p>}
          </form>

          {(hooks ?? []).length > 0 && (
            <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-white">
              {(hooks ?? []).map((h) => (
                <li key={h.id} className="p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="break-all text-xs">{h.url}</code>
                    <span className={`text-xs ${h.active ? 'text-green-700' : 'text-mute'}`}>{h.active ? 'активен' : 'выключен'}</span>
                  </div>
                  <p className="mt-1 text-xs text-mute">{(h.events as string[]).map((e) => EVENT_LABELS[e] ?? e).join(', ')}</p>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-mute underline">Секрет для проверки подписи</summary>
                    <code className="mt-1 block break-all rounded bg-neutral-100 p-2 text-xs">{h.secret}</code>
                  </details>
                  <div className="mt-2 flex gap-2">
                    <form action={toggleHook}>
                      <input type="hidden" name="id" value={h.id} />
                      <input type="hidden" name="active" value={h.active ? 'false' : 'true'} />
                      <button className="btn py-1">{h.active ? 'Выключить' : 'Включить'}</button>
                    </form>
                    <form action={deleteHook}>
                      <input type="hidden" name="id" value={h.id} />
                      <button className="btn py-1">Удалить</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
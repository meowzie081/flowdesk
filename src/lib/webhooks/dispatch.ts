import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { SupabaseClient } from '@supabase/supabase-js';

export class WebhookDeliveryError extends Error {
  constructor(public code: string, public retry: boolean) { super(code); }
}

export function signWebhookPayload(secret: string, timestamp: number, body: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function isPrivateAddress(address: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const lower = address.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (mapped) return isPrivateAddress(mapped[1]);
  return lower.startsWith('fc') || lower.startsWith('fd')
    || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb');
}

/** Владелец отдела задаёт URL сам, поэтому воркер не должен ходить во внутреннюю сеть.
 * Проверка DNS + запрет редиректов закрывают базовый SSRF; закрепление IP за соединением
 * (защита от DNS rebinding) требует собственного агента и здесь не делается. */
export async function assertSafeWebhookUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new WebhookDeliveryError('invalid_url', false); }
  if (url.protocol !== 'https:' || !url.hostname) throw new WebhookDeliveryError('https_required', false);
  let addresses: { address: string }[];
  try { addresses = await lookup(url.hostname, { all: true }); }
  catch { throw new WebhookDeliveryError('dns_failed', true); }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new WebhookDeliveryError('blocked_address', false);
  return url;
}

export async function dispatchWebhooks(db: SupabaseClient) {
  const { data: jobs, error } = await db.rpc('claim_webhook_deliveries', { batch_size: 5 });
  if (error) throw new WebhookDeliveryError('database_unavailable', true);
  const counts = { sent: 0, skipped: 0, pending: 0, failed: 0 };
  for (const job of jobs ?? []) {
    let status: keyof typeof counts = 'skipped';
    let reason: string | null = null;
    try {
      const [{ data: hook, error: he }, { data: event, error: ee }] = await Promise.all([
        db.from('api_webhooks').select('id,url,secret,active,department_id').eq('id', job.webhook_id).maybeSingle(),
        db.from('task_events').select('id,kind,payload,task_id,department_id,created_at').eq('id', job.event_id).maybeSingle(),
      ]);
      if (he || ee) throw new WebhookDeliveryError('database_unavailable', true);
      if (!hook || !hook.active) reason = 'webhook_inactive';
      else if (!event) reason = 'event_deleted';
      else {
        const eventName = `task.${event.kind}`;
        const body = JSON.stringify({
          id: event.id,
          event: eventName,
          department_id: event.department_id,
          occurred_at: event.created_at,
          data: { task_id: event.task_id, ...(event.payload as Record<string, unknown>) },
        });
        const timestamp = Math.floor(Date.now() / 1000);
        await assertSafeWebhookUrl(hook.url);
        const response = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'FlowDesk-Webhooks/1',
            'X-FlowDesk-Event': eventName,
            'X-FlowDesk-Delivery': job.id,
            'X-FlowDesk-Signature': `t=${timestamp},v1=${signWebhookPayload(hook.secret, timestamp, body)}`,
          },
          body,
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        });
        if (response.ok) status = 'sent';
        else if (response.status === 429 || response.status >= 500) throw new WebhookDeliveryError(`http_${response.status}`, true);
        else throw new WebhookDeliveryError(`http_${response.status}`, false);
      }
    } catch (e) {
      const failure = e instanceof WebhookDeliveryError ? e : new WebhookDeliveryError('network_error', true);
      status = failure.retry && job.attempts < 5 ? 'pending' : 'failed';
      reason = failure.code;
    }
    const delay = Math.min(3600, 30 * 2 ** job.attempts);
    const { error: finishError } = await db.from('webhook_deliveries').update({
      status,
      last_error: reason,
      available_at: new Date(Date.now() + delay * 1000).toISOString(),
      finished_at: status === 'pending' ? null : new Date().toISOString(),
      lock_token: null,
    }).eq('id', job.id).eq('lock_token', job.lock_token).eq('status', 'processing');
    if (finishError) throw new WebhookDeliveryError('database_unavailable', true);
    counts[status]++;
  }
  return counts;
}
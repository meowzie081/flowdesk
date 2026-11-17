import { beforeEach, describe, expect, it, vi } from 'vitest';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => dns);

import { assertSafeWebhookUrl, dispatchWebhooks, signWebhookPayload, WebhookDeliveryError } from './dispatch';
import type { SupabaseClient } from '@supabase/supabase-js';

function fixture() {
  const rows: Record<string, any> = {
    api_webhooks: { id: 'hook', url: 'https://hooks.example.com/flowdesk', secret: 'whsec_test', active: true, department_id: 'dep' },
    task_events: { id: 'event', kind: 'created', payload: { title: 'T' }, task_id: 'task', department_id: 'dep', created_at: '2026-11-17T00:00:00Z' },
  };
  const updates: any[] = [];
  const errors: Record<string, unknown> = {};
  const job = { id: 'delivery', webhook_id: 'hook', event_id: 'event', attempts: 1, lock_token: 'lease' };
  const db = {
    rpc: vi.fn().mockResolvedValue({ data: [job], error: null }),
    from: vi.fn((table: string) => {
      const query: any = {
        select: () => query, eq: () => query,
        update: (value: any) => { updates.push({ table, value }); return query; },
        maybeSingle: async () => ({ data: rows[table], error: errors[table] ?? null }),
        then: (resolve: any) => Promise.resolve({ data: null, error: errors[table] ?? null }).then(resolve),
      };
      return query;
    }),
  };
  return { db: db as unknown as SupabaseClient, rows, job, updates, errors };
}

beforeEach(() => {
  vi.clearAllMocks();
  dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});

describe('webhook signature', () => {
  it('signs timestamp.body with HMAC-SHA256', () => {
    expect(signWebhookPayload('whsec_test', 1700000000, '{"a":1}')).toBe('38877139021993b830af32feea6e18a8da83eb2f6e49ee50bd9e4cf4ca4d3789');
  });
});

describe('SSRF guard', () => {
  it('requires https', async () => {
    await expect(assertSafeWebhookUrl('http://hooks.example.com/x')).rejects.toMatchObject({ code: 'https_required', retry: false });
  });
  it('blocks private, loopback, link-local and mapped addresses', async () => {
    for (const address of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.1.1', '172.16.0.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      dns.lookup.mockResolvedValueOnce([{ address, family: address.includes(':') ? 6 : 4 }]);
      await expect(assertSafeWebhookUrl('https://hooks.example.com/x')).rejects.toMatchObject({ code: 'blocked_address', retry: false });
    }
  });
  it('allows a public address', async () => {
    expect((await assertSafeWebhookUrl('https://hooks.example.com/x')).hostname).toBe('hooks.example.com');
  });
  it('treats DNS failure as retryable', async () => {
    dns.lookup.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(assertSafeWebhookUrl('https://missing.example.com/x')).rejects.toMatchObject({ code: 'dns_failed', retry: true });
  });
});

describe('webhook delivery worker', () => {
  it('delivers a signed event and finishes the lease', async () => {
    const f = fixture();
    expect((await dispatchWebhooks(f.db)).sent).toBe(1);
    const call = (fetch as any).mock.calls[0];
    expect(call[0]).toBe('https://hooks.example.com/flowdesk');
    expect(call[1].redirect).toBe('manual');
    expect(call[1].headers['X-FlowDesk-Event']).toBe('task.created');
    expect(call[1].headers['X-FlowDesk-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    const body = JSON.parse(call[1].body);
    expect(body.event).toBe('task.created');
    expect(body.data).toEqual({ task_id: 'task', title: 'T' });
    expect(f.updates[0]).toMatchObject({ table: 'webhook_deliveries', value: { status: 'sent', lock_token: null } });
  });
  it('skips inactive webhooks and deleted events without calling fetch', async () => {
    const inactive = fixture(); inactive.rows.api_webhooks.active = false;
    expect((await dispatchWebhooks(inactive.db)).skipped).toBe(1);
    const missing = fixture(); missing.rows.task_events = null;
    expect((await dispatchWebhooks(missing.db)).skipped).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retries 5xx and 429 with backoff, caps attempts at five', async () => {
    for (const attempts of [1, 5]) {
      const f = fixture(); f.job.attempts = attempts;
      (fetch as any).mockResolvedValueOnce({ ok: false, status: 503 });
      const outcome = await dispatchWebhooks(f.db);
      expect(outcome[attempts === 5 ? 'failed' : 'pending']).toBe(1);
      expect(f.updates[0].value.last_error).toBe('http_503');
    }
  });
  it('does not retry client errors or redirects', async () => {
    for (const status of [404, 302]) {
      const f = fixture();
      (fetch as any).mockResolvedValueOnce({ ok: false, status });
      expect((await dispatchWebhooks(f.db)).failed).toBe(1);
    }
  });
  it('never fetches a private address even if the stored url passes the https check', async () => {
    const f = fixture();
    dns.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    expect((await dispatchWebhooks(f.db)).failed).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(f.updates[0].value.last_error).toBe('blocked_address');
  });
  it('does not mistake a database error for a missing webhook', async () => {
    const f = fixture(); f.errors.api_webhooks = { message: 'offline' };
    expect((await dispatchWebhooks(f.db)).pending).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('surfaces claim failures as a retryable delivery error', async () => {
    const f = fixture();
    (f.db.rpc as any).mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await expect(dispatchWebhooks(f.db)).rejects.toBeInstanceOf(WebhookDeliveryError);
  });
});
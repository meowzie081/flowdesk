import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
import { createAdminClient } from '@/lib/supabase/admin';
import { authenticateApi, apiMembership, boardLimitError, canWriteRole } from './auth';

const TOKEN = 'fd_' + 'a'.repeat(43);

function mockAdmin(responses: Record<string, any[]>, count = 0) {
  const calls: any[] = [];
  const client = {
    from: vi.fn((table: string) => {
      const call: any = { table, eqs: [], updates: [] };
      calls.push(call);
      const queue = responses[table] ?? [];
      const next = () => queue.shift() ?? null;
      const query: any = {
        select: () => query,
        eq: (f: string, v: any) => { call.eqs.push([f, v]); return query; },
        in: (f: string, v: any) => { call.eqs.push([f, v]); return query; },
        is: () => query, order: () => query, limit: () => query,
        update: (v: any) => { call.updates.push(v); return query; },
        maybeSingle: async () => ({ data: next(), error: null }),
        single: async () => ({ data: next(), error: null }),
        then: (resolve: any) => Promise.resolve({ data: next(), error: null, count }).then(resolve),
      };
      return query;
    }),
  };
  return { client, calls };
}

function requestWith(token: string | null) {
  return new Request('https://flowdesk.example/api/v1/departments', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => vi.clearAllMocks());

describe('authenticateApi', () => {
  it('rejects missing and malformed tokens without touching the database', async () => {
    expect(await authenticateApi(requestWith(null))).toBeNull();
    expect(await authenticateApi(requestWith('Bearer basic_abc'))).toBeNull();
    expect(await authenticateApi(requestWith('Bearer fd_short'))).toBeNull();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it('looks up the sha256 hash, not the raw token', async () => {
    const { client, calls } = mockAdmin({ api_tokens: [{ id: 'tok', user_id: 'user', last_used_at: null }] });
    (createAdminClient as any).mockReturnValue(client);
    const ctx = await authenticateApi(requestWith(TOKEN));
    expect(ctx).toMatchObject({ userId: 'user', tokenId: 'tok' });
    expect(calls[0].eqs).toContainEqual(['token_hash', createHash('sha256').update(TOKEN).digest('hex')]);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
    expect(calls[1].updates.length).toBe(1);
  });
  it('throttles last_used_at writes to once a minute', async () => {
    const { client, calls } = mockAdmin({ api_tokens: [{ id: 'tok', user_id: 'user', last_used_at: new Date().toISOString() }] });
    (createAdminClient as any).mockReturnValue(client);
    await authenticateApi(requestWith(TOKEN));
    expect(calls.length).toBe(1);
  });
  it('rejects unknown hashes and missing service key', async () => {
    const { client } = mockAdmin({ api_tokens: [] });
    (createAdminClient as any).mockReturnValue(client);
    expect(await authenticateApi(requestWith(TOKEN))).toBeNull();
    (createAdminClient as any).mockReturnValue(null);
    expect(await authenticateApi(requestWith(TOKEN))).toBeNull();
  });
});

describe('apiMembership', () => {
  it('returns the role and blocks suspended members', async () => {
    const { client } = mockAdmin({ department_members: [{ role: 'member', blocked_at: null }, { role: 'owner', blocked_at: '2026-01-01' }, null] });
    expect(await apiMembership(client as any, 'user', 'dep')).toBe('member');
    expect(await apiMembership(client as any, 'user', 'dep')).toBeNull();
    expect(await apiMembership(client as any, 'user', 'dep')).toBeNull();
    expect(canWriteRole('viewer')).toBe(false);
    expect(canWriteRole('owner')).toBe(true);
    expect(canWriteRole(null)).toBe(false);
  });
});

describe('boardLimitError', () => {
  it('skips departments without an organization', async () => {
    const { client } = mockAdmin({ departments: [{ organization_id: null }] });
    expect(await boardLimitError(client as any, 'dep')).toBeNull();
  });
  it('enforces the free plan board cap for API clients', async () => {
    const { client } = mockAdmin({
      departments: [{ organization_id: 'org' }, [{ id: 'd1' }, { id: 'd2' }]],
      subscriptions: [{ plan_id: 'free', plans: { max_boards: 2, name: 'Free' } }],
    }, 2);
    expect(await boardLimitError(client as any, 'dep')).toContain('Тариф «Free»');
  });
  it('allows creation within the paid plan', async () => {
    const { client } = mockAdmin({
      departments: [{ organization_id: 'org' }, [{ id: 'd1' }]],
      subscriptions: [{ plan_id: 'team', plans: { max_boards: 100, name: 'Team' } }],
    }, 1);
    expect(await boardLimitError(client as any, 'dep')).toBeNull();
  });
});
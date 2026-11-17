import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const f = vi.hoisted(() => ({admin: {rpc: vi.fn()}}));
vi.mock('@/lib/supabase/admin', () => ({createAdminClient: () => f.admin}));
vi.mock('@/lib/supabase/server', () => ({createClient: () => ({auth: {getUser: vi.fn()}})}));
import {POST as run} from '@/app/api/recurrence/run/route';
const req = (auth?: string) => new Request('https://flowdesk.example/api/recurrence/run', {method: 'POST', headers: auth ? {authorization: auth} : {}});
beforeEach(() => {vi.clearAllMocks(); f.admin.rpc.mockResolvedValue({data: {created: 0, failed: 0}, error: null});});
afterEach(() => {vi.unstubAllEnvs();});
describe('recurrence cron route', () => {
  it('returns 503 when the cron secret is not configured', async () => {
    vi.stubEnv('NOTIFICATION_CRON_SECRET', '');
    expect((await run(req())).status).toBe(503);
    expect(f.admin.rpc).not.toHaveBeenCalled();
  });
  it('rejects requests without the bearer secret', async () => {
    vi.stubEnv('NOTIFICATION_CRON_SECRET', 'a'.repeat(40));
    expect((await run(req())).status).toBe(401);
    expect((await run(req('Bearer wrong'))).status).toBe(401);
    expect(f.admin.rpc).not.toHaveBeenCalled();
  });
  it('runs the RPC with the correct secret and returns counters', async () => {
    vi.stubEnv('NOTIFICATION_CRON_SECRET', 'a'.repeat(40));
    f.admin.rpc.mockResolvedValue({data: {created: 2, failed: 1}, error: null});
    const res = await run(req(`Bearer ${'a'.repeat(40)}`));
    expect(res.status).toBe(200);
    expect(f.admin.rpc).toHaveBeenCalledWith('run_due_recurring');
    expect(await res.json()).toEqual({created: 2, failed: 1});
  });
  it('does not leak database errors to the caller', async () => {
    vi.stubEnv('NOTIFICATION_CRON_SECRET', 'a'.repeat(40));
    f.admin.rpc.mockResolvedValue({data: null, error: {message: 'SECRET_DB_DETAIL'}});
    const res = await run(req(`Bearer ${'a'.repeat(40)}`));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('SECRET_DB_DETAIL');
  });
});
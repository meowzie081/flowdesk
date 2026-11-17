import {beforeEach, describe, expect, it, vi} from 'vitest';
vi.mock('server-only', () => ({}));
const f = vi.hoisted(() => ({admin: {rpc: vi.fn()}, hasAdmin: true}));
vi.mock('@/lib/supabase/admin', () => ({createAdminClient: () => (f.hasAdmin ? f.admin : null)}));
import {checkRateLimit, tooManyRequests} from '@/lib/rate-limit';
beforeEach(() => {vi.clearAllMocks(); f.hasAdmin = true; f.admin.rpc.mockResolvedValue({data: true, error: null});});
describe('checkRateLimit', () => {
  it('allows when the admin client is unavailable (fail open)', async () => {
    f.hasAdmin = false;
    expect(await checkRateLimit('k', 5, 60)).toBe(true);
    expect(f.admin.rpc).not.toHaveBeenCalled();
  });
  it('allows when the RPC errors (fail open)', async () => {
    f.admin.rpc.mockResolvedValue({data: null, error: {message: 'boom'}});
    expect(await checkRateLimit('k', 5, 60)).toBe(true);
  });
  it('passes key/limit/window to the RPC and maps the boolean', async () => {
    f.admin.rpc.mockResolvedValue({data: false, error: null});
    expect(await checkRateLimit('admin-users:u1', 10, 60)).toBe(false);
    expect(f.admin.rpc).toHaveBeenCalledWith('check_rate_limit', {p_key: 'admin-users:u1', p_limit: 10, p_window_seconds: 60});
    f.admin.rpc.mockResolvedValue({data: true, error: null});
    expect(await checkRateLimit('k', 10, 60)).toBe(true);
  });
});
describe('tooManyRequests', () => {
  it('returns 429 with Retry-After and no-store', async () => {
    const res = tooManyRequests(30);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const f = vi.hoisted(() => ({result: {error: null} as {error: {message: string} | null}, throws: false}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({select: () => ({limit: () => ({abortSignal: () => {
      if (f.throws) throw new Error('timeout');
      return Promise.resolve(f.result);
    }})})}),
  }),
}));
import {GET} from '../app/api/health/route';
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  f.result = {error: null};
  f.throws = false;
});
afterEach(() => vi.unstubAllEnvs());
describe('health endpoint', () => {
  it('reports ok when the database answers', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ok: true, database: 'up'});
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
  it('returns 503 when the query fails', async () => {
    f.result = {error: {message: 'relation missing'}};
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ok: false, database: 'down'});
  });
  it('returns 503 when the probe times out', async () => {
    f.throws = true;
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).database).toBe('down');
  });
  it('stays ok without Supabase configuration (web process is alive)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ok: true, database: 'unconfigured'});
  });
});
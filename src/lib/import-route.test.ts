import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));
const f = vi.hoisted(() => ({
  session: { auth: { getUser: vi.fn() }, from: vi.fn(), rpc: vi.fn() },
  member: { data: { role: 'owner' } } as { data: { role: string } | null },
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => f.session }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => null }));
import { POST } from '../app/api/import/route';

const uid = '00000000-0000-4000-8000-000000000001';
const dep = '00000000-0000-4000-8000-000000000010';
const payload = {
  board_name: 'Импорт',
  columns: [{ name: 'Backlog', is_done: false }],
  tasks: [{ title: 'T', description: '', column: 'Backlog', priority: 'medium', due_date: null }],
};
const request = (body: unknown) =>
  new Request('https://flowdesk.test/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  f.member = { data: { role: 'owner' } };
  f.session.auth.getUser.mockResolvedValue({ data: { user: { id: uid } } });
  f.session.from.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(f.member) }) }) }) });
  f.session.rpc.mockResolvedValue({ data: 'board-id', error: null });
});

describe('import endpoint', () => {
  it('requires authentication', async () => {
    f.session.auth.getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(request({ dep, payload }))).status).toBe(401);
  });
  it('rejects an invalid payload', async () => {
    expect((await POST(request({ dep, payload: { ...payload, columns: [] } }))).status).toBe(400);
    expect((await POST(request({ dep: 'not-uuid', payload }))).status).toBe(400);
  });
  it('forbids viewers and non-members', async () => {
    f.member = { data: { role: 'viewer' } };
    expect((await POST(request({ dep, payload }))).status).toBe(403);
    f.member = { data: null };
    expect((await POST(request({ dep, payload }))).status).toBe(403);
  });
  it('imports atomically via the RPC for a writer', async () => {
    const res = await POST(request({ dep, payload }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ boardId: 'board-id' });
    expect(f.session.rpc).toHaveBeenCalledWith('import_board_payload', { p_dep: dep, p_payload: payload });
  });
  it('explains when the migration is not applied yet', async () => {
    f.session.rpc.mockResolvedValue({ data: null, error: { message: 'function public.import_board_payload does not exist' } });
    const res = await POST(request({ dep, payload }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/0023/);
  });
  it('surfaces a friendly limit error from the trigger', async () => {
    f.session.rpc.mockResolvedValue({ data: null, error: { message: 'Тариф Free включает 2 доски на организацию.' } });
    const res = await POST(request({ dep, payload }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Тариф Free/);
  });
});
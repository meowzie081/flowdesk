import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const f = vi.hoisted(() => ({user: {id: 'member', email: 'member@example.com', email_confirmed_at: '2026-01-01'} as any, db: {auth: {getUser: vi.fn()}, from: vi.fn(), rpc: vi.fn()}, admin: {rpc: vi.fn(), from: vi.fn()}, dispatch: vi.fn()}));
vi.mock('@/lib/supabase/server', () => ({createClient: () => f.db}));
vi.mock('@/lib/supabase/admin', () => ({createAdminClient: () => f.admin}));
vi.mock('./dispatch', () => ({dispatchNotifications: f.dispatch}));
import {POST as preferences} from '@/app/api/notifications/preferences/route';
import {POST as subscribe} from '@/app/api/notifications/push/route';
import {POST as campaign} from '@/app/api/notifications/campaigns/route';
import {POST as progress} from '@/app/api/onboarding/route';
import {POST as dispatch} from '@/app/api/notifications/dispatch/route';
const request = (body: unknown, origin = 'https://flowdesk.example') => new Request('https://flowdesk.example/api/test', {method: 'POST', headers: {origin, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
beforeEach(() => {vi.clearAllMocks(); f.user = {id: 'member', email: 'member@example.com', email_confirmed_at: '2026-01-01'}; f.db.auth.getUser.mockImplementation(async () => ({data: {user: f.user}})); f.dispatch.mockResolvedValue({sent: 0, skipped: 0, pending: 0, failed: 0}); f.db.from.mockReturnValue({upsert: vi.fn().mockResolvedValue({error: null})}); f.db.rpc.mockResolvedValue({data: {id: 'campaign', recipients: 2}, error: null}); f.admin.rpc.mockResolvedValue({error: null});});
afterEach(() => {vi.unstubAllEnvs();});
describe('authenticated delivery routes', () => {
  it('rejects cross-origin mutations before authentication or DB access', async () => {
    for (const handler of [preferences, subscribe, campaign, progress]) expect((await handler(request({}, 'https://evil.test'))).status).toBe(403);
    expect(f.db.auth.getUser).not.toHaveBeenCalled(); expect(f.admin.rpc).not.toHaveBeenCalled();
  });
  it('requires an authenticated user', async () => {
    f.user = null;
    for (const handler of [preferences, subscribe, campaign, progress]) expect((await handler(request({}))).status).toBe(401);
  });
  it('rejects email opt-in for synthetic or unconfirmed accounts', async () => {
    f.user.email = 'member@users.flowdesk.invalid';
    expect((await preferences(request({email_events: true, email_announcements: false, push_enabled: false}))).status).toBe(400);
    f.user.email = 'real@example.com'; f.user.email_confirmed_at = null;
    expect((await preferences(request({email_events: false, email_announcements: true, push_enabled: false}))).status).toBe(400);
    expect(f.db.from).not.toHaveBeenCalled();
  });
  it('always saves preferences to the session user and rejects an injected userId', async () => {
    const prefs = {email_events: false, email_announcements: false, push_enabled: true};
    expect((await preferences(request({...prefs, userId: 'victim'}))).status).toBe(400);
    expect((await preferences(request(prefs))).status).toBe(200);
    expect(f.db.from.mock.results[0].value.upsert).toHaveBeenCalledWith({user_id: 'member', ...prefs});
  });
  it('accepts skipped onboarding and stores it for the account only', async () => {
    expect((await progress(request({status: 'skipped', userId: 'victim'}))).status).toBe(200);
    expect(f.db.from.mock.results[0].value.upsert.mock.calls[0][0].user_id).toBe('member');
    expect((await progress(request({status: 'unexpected'}))).status).toBe(400);
  });
  it('does not accept arbitrary SSRF endpoints', async () => {
    expect((await subscribe(request({endpoint: 'https://127.0.0.1/internal', keys: {p256dh: 'x'.repeat(87), auth: 'a'.repeat(22)}}))).status).toBe(400);
    expect(f.admin.rpc).not.toHaveBeenCalled();
  });
  it('refuses delivery without the dedicated cron secret', async () => {
    vi.stubEnv('NOTIFICATION_CRON_SECRET', 'a'.repeat(40));
    expect((await dispatch(request({}))).status).toBe(401); expect(f.dispatch).not.toHaveBeenCalled();
    const response = await dispatch(new Request('https://flowdesk.example/api/notifications/dispatch', {method: 'POST', headers: {authorization: `Bearer ${'a'.repeat(40)}`}}));
    expect(response.status).toBe(200); expect(f.dispatch).toHaveBeenCalledOnce();
  });
  it('does not expose transport failures or config secrets to the caller', async () => {
    vi.stubEnv('NOTIFICATION_CRON_SECRET', 'a'.repeat(40)); f.dispatch.mockRejectedValueOnce(new Error('RESEND_SECRET_TOKEN'));
    const response = await dispatch(new Request('https://flowdesk.example/api/notifications/dispatch', {method: 'POST', headers: {authorization: `Bearer ${'a'.repeat(40)}`}}));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('RESEND_SECRET_TOKEN');
  });
});

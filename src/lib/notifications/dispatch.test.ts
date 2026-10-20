import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const transport = vi.hoisted(() => ({configuredOrigin: vi.fn(() => 'https://flowdesk.example'), sendMail: vi.fn(), sendPush: vi.fn()}));
vi.mock('./transport', async importOriginal => ({...await importOriginal<typeof import('./transport')>(), ...transport}));
import {dispatchNotifications} from './dispatch';
import type {SupabaseClient} from '@supabase/supabase-js';
const uid = '00000000-0000-4000-8000-000000000001';
function fixture(channel = 'email') {
  const rows: Record<string, any> = {
    notifications: {id: 'notice', user_id: uid, department_id: uid, kind: 'assigned', task_id: uid, created_at: new Date().toISOString()},
    department_members: {blocked_at: null}, notification_preferences: {email_events: true, email_announcements: true, push_enabled: true},
    email_campaigns: {subject: 'Update', body: 'Team announcement'},
    push_subscriptions: [{id: 'device', endpoint: 'https://fcm.googleapis.com/device', p256dh: 'key', auth: 'auth'}],
  };
  const updates: any[] = [], deleted: any[] = [];
  const job = {id: 'job', notification_id: 'notice', channel, attempts: 1, lock_token: 'lease'};
  const user = {email: 'member@example.com', email_confirmed_at: '2026-01-01'};
  const errors: Record<string, unknown> = {};
  const db = {
    rpc: vi.fn().mockResolvedValue({data: [job], error: null}),
    auth: {admin: {getUserById: vi.fn(async () => ({data: {user}, error: null}))}},
    from: vi.fn((table: string) => {
      const query: any = {
        select: () => query, eq: () => query, limit: () => query,
        update: (value: any) => {updates.push({table, value}); return query;},
        delete: () => {deleted.push(table); return query;},
        maybeSingle: async () => ({data: rows[table], error: errors[table] ?? null}),
        then: (resolve: any) => Promise.resolve({data: rows[table], error: errors[table] ?? null}).then(resolve),
      }; return query;
    }),
  };
  return {db: db as unknown as SupabaseClient, rows, job, user, updates, errors, deleted};
}
beforeEach(() => {vi.clearAllMocks(); transport.sendMail.mockResolvedValue(undefined); transport.sendPush.mockResolvedValue(undefined);});
afterEach(() => {vi.unstubAllEnvs();});
describe('delivery worker', () => {
  it('skips disabled subscriptions immediately before sending', async () => {
    const f = fixture(); f.rows.notification_preferences.email_events = false;
    expect((await dispatchNotifications(f.db)).skipped).toBe(1); expect(transport.sendMail).not.toHaveBeenCalled();
  });
  it('does not send work announcements after access is blocked or removed', async () => {
    for(const member of [null, {blocked_at: '2026-01-01'}]) {
      const f = fixture(); f.rows.department_members = member;
      expect((await dispatchNotifications(f.db)).skipped).toBe(1);
    }
    expect(transport.sendMail).not.toHaveBeenCalled();
  });
  it('rejects synthetic and unverified email addresses at delivery time', async () => {
    for(const email of ['worker@users.flowdesk.invalid', 'real@example.com']) {
      const f = fixture(); f.user.email = email; if(email.startsWith('real')) f.user.email_confirmed_at = '';
      expect((await dispatchNotifications(f.db)).skipped).toBe(1);
    }
    expect(transport.sendMail).not.toHaveBeenCalled();
  });
  it('sends only to the authenticated directory email, with the job id as idempotency identity', async () => {
    const f = fixture(); expect((await dispatchNotifications(f.db)).sent).toBe(1);
    expect(transport.sendMail.mock.calls[0][0]).toBe('member@example.com'); expect(transport.sendMail.mock.calls[0][1]).toBe('job');
  });
  it('rechecks separate announcement consent instead of event email consent', async () => {
    const f = fixture(); f.rows.notifications.kind = 'announcement'; f.rows.notifications.campaign_id = uid;
    f.rows.notification_preferences.email_announcements = false;
    expect((await dispatchNotifications(f.db)).skipped).toBe(1); expect(transport.sendMail).not.toHaveBeenCalled();
  });
  it('does not retry old emails outside the provider idempotency window', async () => {
    const f = fixture(); f.rows.notifications.created_at = new Date(Date.now() - 23 * 3600_000).toISOString();
    expect((await dispatchNotifications(f.db)).skipped).toBe(1); expect(transport.sendMail).not.toHaveBeenCalled();
  });
  it('retries transient transport/DB errors with sanitized metadata and caps attempts', async () => {
    for(const attempts of [1, 5]) {
      const f = fixture(); f.job.attempts = attempts; transport.sendMail.mockRejectedValueOnce(new Error('private token with email'));
      const outcome = await dispatchNotifications(f.db);
      expect(outcome[attempts === 5 ? 'failed' : 'pending']).toBe(1);
      expect(JSON.stringify(f.updates)).not.toContain('private token');
    }
  });
  it('does not mistake a database error for missing consent', async () => {
    const f = fixture(); f.errors.notification_preferences = {message: 'offline'};
    expect((await dispatchNotifications(f.db)).pending).toBe(1); expect(transport.sendMail).not.toHaveBeenCalled();
  });
  it('deletes expired push subscriptions without retrying them forever', async () => {
    const f = fixture('push'); transport.sendPush.mockRejectedValueOnce({statusCode: 410});
    expect((await dispatchNotifications(f.db)).skipped).toBe(1); expect(f.deleted).toContain('push_subscriptions');
  });
  it('retries a partial push failure and does not claim full success', async () => {
    const f = fixture('push'); f.rows.push_subscriptions.push({...f.rows.push_subscriptions[0], id: 'device2'});
    transport.sendPush.mockResolvedValueOnce(undefined).mockRejectedValueOnce({statusCode: 503});
    expect((await dispatchNotifications(f.db)).pending).toBe(1);
  });
});

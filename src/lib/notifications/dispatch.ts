import type { SupabaseClient } from '@supabase/supabase-js';
import { isManagedEmail } from '@/lib/accounts';
import { emailContent } from './shared';
import { configuredOrigin, DeliveryError, sendMail, sendPush } from './transport';

function requireResult(error: unknown) { if (error) throw new DeliveryError('database_unavailable', true); }
export async function dispatchNotifications(db: SupabaseClient) {
  const origin = configuredOrigin();
  const {data: jobs, error} = await db.rpc('claim_notification_deliveries', {batch_size: 3});
  requireResult(error);
  const counts = {sent: 0, skipped: 0, pending: 0, failed: 0};
  for (const job of jobs ?? []) {
    let status: keyof typeof counts = 'skipped', reason: string | null = null;
    try {
      const {data: notice, error: ne} = await db.from('notifications').select('id,user_id,department_id,task_id,message_id,campaign_id,kind,created_at').eq('id', job.notification_id).maybeSingle();
      requireResult(ne);
      if (!notice) { reason = 'notification_deleted'; }
      else if (Date.now() - new Date(notice.created_at).getTime() >= 22 * 3600_000) { reason = 'expired'; }
      else {
        const [{data: member, error: me}, {data: prefs, error: pe}] = await Promise.all([
          db.from('department_members').select('blocked_at').eq('user_id', notice.user_id).eq('department_id', notice.department_id).maybeSingle(),
          db.from('notification_preferences').select('email_events,email_announcements,push_enabled').eq('user_id', notice.user_id).maybeSingle(),
        ]);
        requireResult(me); requireResult(pe);
        if (!member || member.blocked_at || !prefs) reason = 'access_or_preferences_removed';
        else if (job.channel === 'email') {
          const enabled = notice.kind === 'announcement' ? prefs.email_announcements : prefs.email_events;
          if (!enabled) reason = 'email_disabled';
          else {
            const {data: account, error: ae} = await db.auth.admin.getUserById(notice.user_id); requireResult(ae);
            const email = account.user?.email;
            if (!email || !account.user?.email_confirmed_at || isManagedEmail(email)) reason = 'no_verified_email';
            else {
              let campaign = null;
              if (notice.campaign_id) {
                const result = await db.from('email_campaigns').select('subject,body').eq('id', notice.campaign_id).eq('department_id', notice.department_id).maybeSingle();
                requireResult(result.error); campaign = result.data;
                if (!campaign) throw new DeliveryError('campaign_missing', false);
              }
              await sendMail(email, job.id, emailContent(origin, notice, campaign)); status = 'sent';
            }
          }
        } else if (!prefs.push_enabled) reason = 'push_disabled';
        else {
          const {data: devices, error: de} = await db.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', notice.user_id).limit(5); requireResult(de);
          if (!devices?.length) reason = 'no_devices';
          else {
            let sent = 0;
            // At most five devices; parallel timeout keeps each cron request bounded.
            const outcomes = await Promise.allSettled(devices.map(async device => {
              try { await sendPush(device, notice.id); sent++; }
              catch (e) {
                const code = (e as {statusCode?: number}).statusCode;
                if (code === 404 || code === 410) {
                  const {error: re} = await db.from('push_subscriptions').delete().eq('id', device.id); requireResult(re); return;
                }
                throw e;
              }
            }));
            if (outcomes.some(o => o.status === 'rejected')) throw new DeliveryError('push_delivery_failed', true);
            if (sent) status = 'sent'; else reason = 'subscriptions_expired';
          }
        }
      }
    } catch (e) {
      const failure = e instanceof DeliveryError ? e : new DeliveryError('transport_unavailable', true);
      status = failure.retry && job.attempts < 5 ? 'pending' : 'failed'; reason = failure.code;
    }
    const delay = Math.min(3600, 30 * 2 ** job.attempts);
    const {error: finishError} = await db.from('notification_outbox').update({
      status, last_error: reason, available_at: new Date(Date.now() + delay * 1000).toISOString(),
      finished_at: status === 'pending' ? null : new Date().toISOString(), lock_token: null,
    }).eq('id', job.id).eq('lock_token', job.lock_token).eq('status', 'processing');
    requireResult(finishError); counts[status]++;
  }
  return counts;
}

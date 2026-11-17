'use client';
import {useEffect, useState} from 'react';
import {postJSON} from '@/lib/http';
import {defaultPreferences} from '@/lib/notifications/shared';
import {nativeClient} from '@/lib/native-client';
import Icon from './Icon';
import {useI18n} from './I18nProvider';

type Preferences = typeof defaultPreferences;
type Config = {preferences: Preferences; emailEligible: boolean; emailConfigured: boolean; pushConfigured: boolean; publicKey: string | null};
function vapidBytes(key: string): Uint8Array<ArrayBuffer> {
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4));
  return Uint8Array.from(raw, ch => ch.charCodeAt(0));
}
export default function NotificationSettings() {
  const {t} = useI18n();
  const [config, setConfig] = useState<Config | null>(null);
  const [prefs, setPrefs] = useState(defaultPreferences);
  const [device, setDevice] = useState(false);
  const [support, setSupport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function load() {
    setError('');
    try {
      const response = await fetch('/api/notifications/preferences', {cache: 'no-store'});
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? t('notif.errLoad'));
      setConfig(data); setPrefs(data.preferences);
    } catch(e) { setError((e as Error).message); }
  }
  useEffect(() => {
    load();
    const supported = !nativeClient() && window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupport(supported);
    if (supported) navigator.serviceWorker.getRegistration('/').then(async registration => setDevice(!!(await registration?.pushManager.getSubscription()))).catch(() => {});
  }, []);
  async function save(next: Preferences = prefs) {
    await postJSON('/api/notifications/preferences', next); setPrefs(next);
  }
  async function saveSettings() {
    setBusy(true); setError(''); setMessage('');
    try { await save(); setMessage(t('notif.saved')); } catch(e) { setError((e as Error).message); } finally {setBusy(false);}
  }
  async function enableDevice() {
    setBusy(true); setError(''); setMessage('');
    let created: PushSubscription | null = null;
    try {
      if (!config?.publicKey) throw new Error(t('notif.errNoVapid'));
      // Called from a deliberate click; never prompt during onboarding or first load.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error(t('notif.errPermission'));
      const registration = await navigator.serviceWorker.register('/sw.js');
      await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error(t('notif.errSwTimeout'))), 10000))]);
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) { subscription = await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: vapidBytes(config.publicKey)}); created = subscription; }
      await postJSON('/api/notifications/push', subscription.toJSON());
      await save({...prefs, push_enabled: true});
      setDevice(true); setMessage(t('notif.pushEnabled'));
    } catch(e) {
      if (created) await created.unsubscribe().catch(() => {});
      setError((e as Error).message);
    } finally {setBusy(false);}
  }
  async function disableDevice() {
    setBusy(true); setError(''); setMessage('');
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch('/api/notifications/push', {method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({endpoint: subscription.endpoint})});
        if (!response.ok) throw new Error(t('notif.errDisable'));
        await subscription.unsubscribe();
      }
      setDevice(false); setMessage(t('notif.deviceDisabled'));
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <section id="notifications" className="card mt-8 scroll-mt-6">
    <div className="flex items-center gap-3"><span className="rounded-xl bg-orange-100 p-2 text-orange-700"><Icon name="bell"/></span><div><h2 className="font-semibold">{t('nav.notifications')}</h2><p className="text-sm text-mute">{t('notif.subtitle')}</p></div></div>
    {config ? <>
      <fieldset disabled={busy} className="mt-5 space-y-4">
        <legend className="text-sm font-medium">{t('notif.email')}</legend>
        {!config.emailEligible && <p className="text-sm text-mute">{t('notif.emailIneligible')}</p>}
        {!config.emailConfigured && <p className="text-sm text-mute">{t('notif.emailNotConfigured')}</p>}
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={prefs.email_events} disabled={!prefs.email_events && (!config.emailEligible || !config.emailConfigured)} onChange={e => setPrefs({...prefs, email_events: e.target.checked})}/><span>{t('notif.emailEvents')}<span className="block text-xs text-mute">{t('notif.emailEventsHint')}</span></span></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={prefs.email_announcements} disabled={!prefs.email_announcements && (!config.emailEligible || !config.emailConfigured)} onChange={e => setPrefs({...prefs, email_announcements: e.target.checked})}/><span>{t('notif.emailAnnouncements')}<span className="block text-xs text-mute">{t('notif.emailAnnouncementsHint')}</span></span></label>
        <div className="border-t border-line pt-4"><h3 className="mb-3 font-medium">{t('notif.push')}</h3>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={prefs.push_enabled} onChange={e => setPrefs({...prefs, push_enabled: e.target.checked})}/><span>{t('notif.pushLabel')}<span className="block text-xs text-mute">{t('notif.pushHint')}</span></span></label>
          <p className="mt-3 text-xs text-mute">{!support ? t('notif.unsupported') : !config.pushConfigured ? t('notif.pushNotConfigured') : device ? t('notif.subscribed') : t('notif.notConnected')}</p>
          {support && config.pushConfigured && <button className="btn mt-3" type="button" onClick={device ? disableDevice : enableDevice}>{device ? t('notif.disableDevice') : t('notif.enableDevice')}</button>}
        </div>
        <button className="btn-solid" type="button" onClick={saveSettings}>{busy ? t('common.saving') : t('notif.saveSettings')}</button>
      </fieldset>
    </> : <button className="btn mt-4" onClick={load}>{t('notif.loadSettings')}</button>}
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-mute">{message}</p>}
  </section>;
}

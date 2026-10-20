'use client';
import {useEffect, useState} from 'react';
import {postJSON} from '@/lib/http';
import {defaultPreferences} from '@/lib/notifications/shared';
import {nativeClient} from '@/lib/native-client';
import Icon from './Icon';

type Preferences = typeof defaultPreferences;
type Config = {preferences: Preferences; emailEligible: boolean; emailConfigured: boolean; pushConfigured: boolean; publicKey: string | null};
function vapidBytes(key: string): Uint8Array<ArrayBuffer> {
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4));
  return Uint8Array.from(raw, ch => ch.charCodeAt(0));
}
export default function NotificationSettings() {
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
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Не удалось загрузить настройки');
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
    try { await save(); setMessage('Настройки сохранены'); } catch(e) { setError((e as Error).message); } finally {setBusy(false);}
  }
  async function enableDevice() {
    setBusy(true); setError(''); setMessage('');
    let created: PushSubscription | null = null;
    try {
      if (!config?.publicKey) throw new Error('Сервер Web Push ещё не настроен');
      // Called from a deliberate click; never prompt during onboarding or first load.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Уведомления не разрешены. Разрешите их в настройках сайта браузера.');
      const registration = await navigator.serviceWorker.register('/sw.js');
      await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Обновите страницу и повторите подключение')), 10000))]);
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) { subscription = await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: vapidBytes(config.publicKey)}); created = subscription; }
      await postJSON('/api/notifications/push', subscription.toJSON());
      await save({...prefs, push_enabled: true});
      setDevice(true); setMessage('Push подключён на этом устройстве');
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
        if (!response.ok) throw new Error('Не удалось отключить устройство');
        await subscription.unsubscribe();
      }
      setDevice(false); setMessage('Это устройство отключено. Настройка остальных устройств сохранена.');
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <section id="notifications" className="card mt-8 scroll-mt-6">
    <div className="flex items-center gap-3"><span className="rounded-xl bg-orange-100 p-2 text-orange-700"><Icon name="bell"/></span><div><h2 className="font-semibold">Уведомления</h2><p className="text-sm text-mute">Выберите, как оставаться в курсе</p></div></div>
    {config ? <>
      <fieldset disabled={busy} className="mt-5 space-y-4">
        <legend className="text-sm font-medium">Электронная почта</legend>
        {!config.emailEligible && <p className="text-sm text-mute">Письма доступны аккаунтам с подтверждённой почтой. У пользователей с одним логином почтового адреса нет.</p>}
        {!config.emailConfigured && <p className="text-sm text-mute">Администратор ещё не подключил почтовый сервис.</p>}
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={prefs.email_events} disabled={!prefs.email_events && (!config.emailEligible || !config.emailConfigured)} onChange={e => setPrefs({...prefs, email_events: e.target.checked})}/><span>События по задачам и чату<span className="block text-xs text-mute">Назначения, комментарии, упоминания и запросы помощи. Подробности остаются в приложении.</span></span></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={prefs.email_announcements} disabled={!prefs.email_announcements && (!config.emailEligible || !config.emailConfigured)} onChange={e => setPrefs({...prefs, email_announcements: e.target.checked})}/><span>Рассылки моего отдела<span className="block text-xs text-mute">Письма с объявлениями владельца отдела.</span></span></label>
        <div className="border-t border-line pt-4"><h3 className="mb-3 font-medium">Push-уведомления</h3>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={prefs.push_enabled} onChange={e => setPrefs({...prefs, push_enabled: e.target.checked})}/><span>Получать push на подключённых устройствах<span className="block text-xs text-mute">Без текста задач и переписки на экране блокировки.</span></span></label>
          <p className="mt-3 text-xs text-mute">{!support ? 'Откройте FlowDesk в поддерживаемом браузере по HTTPS. На iPhone/iPad сначала установите сайт на экран «Домой». В Telegram и десктопной оболочке используйте внутренние уведомления.' : !config.pushConfigured ? 'Администратор ещё не настроил Web Push.' : device ? 'Подписка браузера создана. При смене аккаунта отключите её перед выходом.' : 'Это устройство пока не подключено.'}</p>
          {support && config.pushConfigured && <button className="btn mt-3" type="button" onClick={device ? disableDevice : enableDevice}>{device ? 'Отключить это устройство' : 'Подключить это устройство'}</button>}
        </div>
        <button className="btn-solid" type="button" onClick={saveSettings}>{busy ? 'Сохраняем…' : 'Сохранить настройки'}</button>
      </fieldset>
    </> : <button className="btn mt-4" onClick={load}>Загрузить настройки</button>}
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm text-mute">{message}</p>}
  </section>;
}

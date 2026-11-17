'use client';

import {nativeClient,type NativeClient} from '@/lib/native-client';
import { useEffect, useState } from 'react';
import { signInEmail, isManagedEmail } from '@/lib/accounts';
import { createClient } from '@/lib/supabase/client';
import { useI18n } from '@/components/I18nProvider';

export default function LoginPage() {
  const { t } = useI18n();
  const [client,setClient]=useState<NativeClient>(null);
  useEffect(()=>{setClient(nativeClient());const timer=setTimeout(()=>setClient(nativeClient()),500);return()=>clearTimeout(timer)},[]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    if(params.get('auth_error'))
      setError(t('auth.errLink'));
    if(params.get('mode')==='up')setMode('up');
  },[]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    let identity:string;
    try {identity = mode==='in' ? signInEmail(email) : email.trim().toLowerCase();} catch {return setError(t('auth.errIdentity'));}
    if(mode==='up'&&(!/^\S+@\S+\.\S+$/.test(identity)||isManagedEmail(identity)))return setError(t('auth.errSelfSignup'));
    if (password.length < 8) return setError(t('auth.errPasswordLen'));
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = mode === 'in'
        ? await supabase.auth.signInWithPassword({ email:identity, password })
        : await supabase.auth.signUp({ email:identity, password, options:{emailRedirectTo:`${window.location.origin}/auth/callback`} });
      if (error) {
        if(mode==='in'&&/confirm/i.test(error.message))return setError(t('auth.errUnconfirmed'));
        return setError(mode==='in'?t('auth.errSignIn'):error.message);
      }
      if (mode==='up'&&!data.session) {
        setNotice(t('auth.noticeSent',{email:identity}));
        setMode('in');
        setPassword('');
        return;
      }
      window.location.href = '/';
    } catch {setError(t('auth.errNetwork'));}
    finally {setBusy(false);}

  }

  async function google() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">FlowDesk</h1>
        <p className="mt-1 text-sm text-mute">{t('auth.tagline')}</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          className="input"
          type={mode==='in'?'text':'email'}
          aria-label={mode==='in'?t('auth.emailOrLogin'):t('auth.email')}
          placeholder={mode==='in'?t('auth.emailOrLogin'):t('auth.email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete={mode==='in'?'username':'email'}
          autoCapitalize="none"
          spellCheck={false}
        />
        <input
          className="input"
          type="password"
          aria-label={t('auth.password')}
          placeholder={t('auth.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {notice && <p className="text-sm text-ink">{notice}</p>}
        <button className="btn-solid" disabled={busy}>
          {mode === 'in' ? t('common.signIn') : t('auth.signUp')}
        </button>
        {!client&&<button type="button" className="btn" onClick={google}>
          {t('auth.google')}
        </button>}
        {client&&<p className="text-xs text-mute">{t('auth.nativeHint')}</p>}
      </form>
      <button
        className="text-left text-sm text-mute underline"
        onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
      >
        {mode === 'in' ? t('auth.noAccount') : t('auth.haveAccount')}
      </button>
    </main>
  );
}

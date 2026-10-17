'use client';

import { useState } from 'react';
import { signInEmail, isManagedEmail } from '@/lib/accounts';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    let identity:string;
    try {identity = mode==='in' ? signInEmail(email) : email.trim().toLowerCase();} catch {return setError('Введите email или логин из 3–32 латинских букв, цифр, точек, дефисов и подчёркиваний');}
    if(mode==='up'&&(!/^\S+@\S+\.\S+$/.test(identity)||isManagedEmail(identity)))return setError('Для самостоятельной регистрации нужен ваш email');
    if (password.length < 8) return setError('Пароль — минимум 8 символов');
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = mode === 'in'
        ? await supabase.auth.signInWithPassword({ email:identity, password })
        : await supabase.auth.signUp({ email:identity, password });
      if (error) return setError(mode==='in'?'Не удалось войти. Проверьте логин/email и пароль.':error.message);
      window.location.href = '/';
    } catch {setError('Не удалось связаться с сервером. Попробуйте ещё раз');}
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
        <p className="mt-1 text-sm text-mute">Задачи, чат и ИИ-помощник команды</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          className="input"
          type={mode==='in'?'text':'email'}
          aria-label={mode==='in'?'Email или логин':'Email'}
          placeholder={mode==='in'?'Email или логин':'Email'}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete={mode==='in'?'username':'email'}
          autoCapitalize="none"
          spellCheck={false}
        />
        <input
          className="input"
          type="password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-solid" disabled={busy}>
          {mode === 'in' ? 'Войти' : 'Создать аккаунт'}
        </button>
        <button type="button" className="btn" onClick={google}>
          Войти через Google
        </button>
      </form>
      <button
        className="text-left text-sm text-mute underline"
        onClick={() => setMode(mode === 'in' ? 'up' : 'in')}
      >
        {mode === 'in' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
      </button>
    </main>
  );
}

'use client';
import {useEffect, useRef, useState} from 'react';
import Icon, {type IconName} from './Icon';
import {postJSON} from '@/lib/http';

const steps: {title: string; lead: string; detail: string; icon: IconName; labels: string[]}[] = [
  {title: 'Добро пожаловать в FlowDesk', lead: 'Один отдел — одно рабочее пространство', detail: 'Выберите отдел на главной странице или создайте свой. Задачи, обсуждения и файлы команды находятся внутри отдела.', icon: 'team', labels: ['Команда', 'Задачи', 'Общение']},
  {title: 'Начните с «Моего дня»', lead: 'Понятный план вместо длинного списка', detail: 'Здесь собраны ваши задачи на сегодня, входящие обращения и запросы помощи. Добавляйте задачи в план дня — это не меняет их срок.', icon: 'calendar', labels: ['Сегодня', 'Входящие', 'Жду ответа']},
  {title: 'Двигайте работу на канбане', lead: 'От идеи до готового результата', detail: 'Создавайте карточки на доске, назначайте исполнителя и срок. Открывайте карточку, чтобы добавить чек-лист, комментарии и файлы.', icon: 'board', labels: ['К выполнению', 'В работе', 'Готово']},
  {title: 'Обсуждайте рядом с задачами', lead: 'Меньше потерянных договорённостей', detail: 'В чате отдела можно прикрепить файл, ответить на сообщение и упомянуть коллегу. Договорённость из сообщения можно превратить в задачу.', icon: 'chat', labels: ['Сообщение', 'Ответ', 'Задача']},
  {title: 'Вы управляете уведомлениями', lead: 'Нужные события удобным способом', detail: 'Колокольчик собирает события внутри приложения. В профиле можно отдельно включить email и push. Разрешение браузера запрашивается только по вашей кнопке.', icon: 'bell', labels: ['В приложении', 'Email', 'Push']},
];
export default function Onboarding({userId, auto = true}: {userId: string; auto?: boolean}) {
  const [open, setOpen] = useState(false), [step, setStep] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null), first = useRef<HTMLHeadingElement>(null);
  const localKey = `flowdesk:onboarding:v1:${userId}`;
  useEffect(() => {
    if (!auto) return;
    let alive = true;
    fetch('/api/onboarding', {cache: 'no-store'}).then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      let locallyFinished = false; try {locallyFinished = !!localStorage.getItem(localKey);} catch {}
      if (alive && data.status === 'new' && !locallyFinished) setOpen(true);
    }).catch(() => {});
    return () => {alive = false;};
  }, [auto, localKey]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; first.current?.focus();
    return () => {document.body.style.overflow = overflow; previous?.focus();};
  }, [open]);
  useEffect(() => {if (open) first.current?.focus();}, [open, step]);
  async function finish(status: 'skipped' | 'completed') {
    if (busy) return; setBusy(true); setError('');
    try {
      await postJSON('/api/onboarding', {status});
      try {localStorage.setItem(localKey, status);} catch {}
      setOpen(false);
    } catch {setError('Не удалось сохранить. Повторите или закройте обучение на этом устройстве.');}
    finally {setBusy(false);}
  }
  function closeLocally() {try {localStorage.setItem(localKey, 'skipped');} catch {} setOpen(false);}
  const current = steps[step];
  return <>
    {!auto && <section className="card mt-8"><h2 className="font-semibold">Знакомство с FlowDesk</h2><p className="mt-1 text-sm text-mute">Пять коротких шагов. Можно пропустить в любой момент.</p><button className="btn mt-3" onClick={() => {setStep(0); setError(''); setOpen(true);}}>Пройти обучение снова</button></section>}
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-sm">
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-description" className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-3xl border border-line bg-white shadow-2xl" onKeyDown={e => {
        if(e.key === 'Escape') {e.preventDefault(); finish('skipped');}
        if(e.key === 'Tab') {
          const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]') ?? []);
          const head = controls[0], tail = controls[controls.length - 1];
          if(e.shiftKey && (document.activeElement === head || document.activeElement === first.current)) {e.preventDefault(); tail?.focus();}
          else if(!e.shiftKey && document.activeElement === tail) {e.preventDefault(); head?.focus();}
        }
      }}>
        <div className="flex items-center justify-between px-6 pt-5"><span className="text-xs font-medium text-mute">Знакомство · {step + 1} из {steps.length}</span><button disabled={busy} className="text-sm text-mute hover:text-ink" onClick={() => finish('skipped')}>Пропустить</button></div>
        <div className="mx-6 mt-5 rounded-2xl border border-orange-200 bg-orange-50 p-6" aria-hidden="true">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-orange-600 shadow-sm"><Icon name={current.icon} width={30} height={30}/></span>
          <div className="mt-5 grid grid-cols-3 gap-2">{current.labels.map((label, index) => <div key={label} className="rounded-xl border border-orange-100 bg-white p-3 shadow-sm"><span className="block text-[10px] font-semibold text-neutral-600 sm:text-xs">{label}</span><span className={`mt-3 block h-2 rounded-full ${index === 2 ? 'bg-emerald-200' : 'bg-orange-200'}`}/><span className="mt-2 block h-2 w-2/3 rounded-full bg-neutral-100"/></div>)}</div>
        </div>
        <div className="p-6 sm:p-8"><h2 id="onboarding-title" ref={first} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">{current.title}</h2><p className="mt-2 font-medium text-orange-600">{current.lead}</p><p id="onboarding-description" className="mt-3 text-sm leading-6 text-mute">{current.detail}</p>
          {error && <div role="alert" className="mt-3 text-sm text-red-600">{error}<button className="ml-2 underline" onClick={closeLocally}>Закрыть на этом устройстве</button></div>}
          <div className="mt-6 flex items-center justify-between gap-3"><div className="flex gap-1.5" aria-hidden>{steps.map((_, i) => <span key={i} className={`h-1.5 rounded-full ${i === step ? 'w-6 bg-orange-500' : 'w-2 bg-neutral-200'}`}/>)}</div><div className="flex gap-2">{step > 0 && <button disabled={busy} className="btn" onClick={() => setStep(step - 1)}>Назад</button>}<button disabled={busy} className="btn-solid" onClick={() => step === steps.length - 1 ? finish('completed') : setStep(step + 1)}>{busy ? 'Сохраняем…' : step === steps.length - 1 ? 'Начать работу' : 'Далее'}</button></div></div>
        </div>
      </div>
    </div>}
  </>;
}

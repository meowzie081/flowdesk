'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { COLORS, ICONS, isHexColor, isReadableColor, profileSchema } from '@/lib/profile';
import UserName from './UserName';

export default function ProfileForm({
  userId,
  initial,
}: {
  userId: string;
  initial: { name: string; icon: string | null; color: string | null };
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState(initial.name);
  const [icon, setIcon] = useState<string | null>(initial.icon);
  const [color, setColor] = useState<string | null>(initial.color);
  const [hex, setHex] = useState(initial.color ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function pickColor(c: string | null) {
    setColor(c);
    setHex(c ?? '');
    setSaved(false);
    setError(null);
  }

  function onHexInput(value: string) {
    setHex(value);
    setSaved(false);
    if (value === '') return setColor(null);
    if (isHexColor(value)) {
      setColor(value.toLowerCase());
      setError(isReadableColor(value) ? null : 'Этот цвет плохо читается на светлой или тёмной теме');
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    const parsed = profileSchema.safeParse({ full_name: name, avatar_icon: icon, name_color: color });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setError(null);
    setBusy(true);
    const { error } = await supabase.from('profiles').update(parsed.data).eq('id', userId);
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <section>
        <h2 className="text-sm font-medium">Так вас видят коллеги</h2>
        <p className="mt-2 rounded-lg border border-line bg-white p-4 text-lg">
          <UserName look={{ name: name.trim() || 'Ваше имя', icon, color }} />
        </p>
      </section>

      <section>
        <label className="text-sm font-medium" htmlFor="full_name">
          Имя
        </label>
        <input
          id="full_name"
          className="input mt-2 max-w-sm"
          value={name}
          maxLength={40}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
        />
      </section>

      <section>
        <h2 className="text-sm font-medium">Иконка</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setIcon(null);
              setSaved(false);
            }}
            className={`h-10 rounded-md border px-3 text-xs ${icon === null ? 'border-ink' : 'border-line text-mute'}`}
          >
            Без иконки
          </button>
          {ICONS.map((i) => (
            <button
              key={i}
              type="button"
              aria-label={`Иконка ${i}`}
              aria-pressed={icon === i}
              onClick={() => {
                setIcon(i);
                setSaved(false);
              }}
              className={`h-10 w-10 rounded-md border text-xl ${icon === i ? 'border-ink bg-neutral-100' : 'border-line hover:border-ink'}`}
            >
              {i}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium">Цвет ника</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => pickColor(null)}
            className={`h-8 rounded-md border px-3 text-xs ${color === null ? 'border-ink' : 'border-line text-mute'}`}
          >
            Обычный
          </button>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Цвет ${c}`}
              aria-pressed={color === c}
              onClick={() => pickColor(c)}
              style={{ backgroundColor: c }}
              className={`h-8 w-8 rounded-full border-2 ${color === c ? 'border-ink ring-2 ring-line' : 'border-transparent'}`}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <label className="text-xs text-mute" htmlFor="hex">
            Свой цвет
          </label>
          <input
            type="color"
            aria-label="Выбрать цвет"
            value={color ?? '#2563eb'}
            onChange={(e) => {
              setColor(e.target.value);
              setHex(e.target.value);
              setSaved(false);
              setError(isReadableColor(e.target.value) ? null : 'Этот цвет плохо читается на светлой или тёмной теме');
            }}
            className="h-8 w-10 cursor-pointer rounded border border-line bg-white p-0.5"
          />
          <input
            id="hex"
            className="input w-28 font-mono"
            placeholder="#2563eb"
            maxLength={7}
            value={hex}
            onChange={(e) => onHexInput(e.target.value)}
          />
        </div>
        <p className="mt-1 text-xs text-mute">Слишком светлые и слишком тёмные цвета недоступны: ник должен читаться в обеих темах.</p>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && <p className="text-sm text-mute">Сохранено.</p>}
      <button className="btn-solid" disabled={busy}>
        {busy ? 'Сохраняю…' : 'Сохранить'}
      </button>
    </form>
  );
}

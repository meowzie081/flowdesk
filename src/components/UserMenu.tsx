'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { accountLabel } from '@/lib/accounts';
import UserName from './UserName';
import type { ProfileLook } from '@/lib/profile';

/** Меню пользователя в шапке: профиль и выход. */
export default function UserMenu({ look, email }: { look: ProfileLook; email?: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn h-9 max-w-[11rem] gap-1 px-2"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Меню профиля"
      >
        <UserName look={look} className="truncate" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-line bg-white p-1 shadow-lg"
        >
          <div className="px-3 py-2 text-xs text-mute">
            {accountLabel(email)}
          </div>
          <Link
            href="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded px-3 py-2 text-sm hover:bg-neutral-100"
          >
            Профиль
          </Link>
          <form action="/auth/signout" method="post">
            <button role="menuitem" className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-neutral-100">
              Выйти
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

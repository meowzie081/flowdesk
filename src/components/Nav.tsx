import Link from 'next/link';
import Icon from './Icon';
import NotificationBell from './NotificationBell';
import ThemeToggle from './ThemeToggle';
import UserMenu from './UserMenu';
import type { ProfileLook } from '@/lib/profile';

export default function Nav({
  depId,
  name,
  userId,
  look,
  email,
}: {
  depId: string;
  name: string;
  userId: string;
  look: ProfileLook;
  email?: string | null;
}) {
  return (
    <header className="app-header border-b border-line bg-white">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 lg:px-6">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="brand-mark flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{color:"#fff"}}><Icon name="board" width={21} height={21}/></span>
          <span className="text-lg">FlowDesk</span>
        </Link>
        <span className="hidden h-5 border-l border-line sm:block" aria-hidden/><span className="max-w-[40%] truncate text-sm text-mute sm:max-w-xs">{name}</span>
        <div className="ml-auto flex items-center gap-2">
        <NotificationBell userId={userId} />
        <ThemeToggle />
        <UserMenu look={look} email={email} />
        </div>
      </div>
    </header>
  );
}

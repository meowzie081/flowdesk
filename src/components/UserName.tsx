import type { ProfileLook } from '@/lib/profile';

/** Имя пользователя с его иконкой и цветом. Без хуков — работает и на сервере, и в браузере. */
export default function UserName({
  look,
  className,
}: {
  look: Pick<ProfileLook, 'name' | 'icon' | 'color'>;
  className?: string;
}) {
  return (
    <span className={className}>
      {look.icon && (
        <span aria-hidden className="mr-1">
          {look.icon}
        </span>
      )}
      <span style={look.color ? { color: look.color } : undefined} className={look.color ? 'font-medium' : undefined}>
        {look.name}
      </span>
    </span>
  );
}

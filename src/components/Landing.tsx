import Link from 'next/link';

const features = [
  { title: 'Канбан-доски', text: 'Задачи, колонки, дедлайны, чек-листы и метки. Перетаскивание и мгновенные обновления для всей команды.' },
  { title: 'Чат → задача', text: 'Обсуждение прямо в отделе. Любое сообщение превращается в задачу в один клик, ничего не теряется.' },
  { title: '«Мой день»', text: 'Личный фокус на сегодня: ваши задачи и встречи без шума чужих досок.' },
  { title: 'Telegram', text: 'Уведомления о задачах и сообщениях в Telegram, вход через Mini App — команда всегда на связи.' },
  { title: 'ИИ-помощник', text: 'Сводки по доске и черновики задач. ИИ помогает быстрее разгрести backlog.' },
  { title: 'Шаблоны и повторы', text: 'Регулярные задачи создаются сами по расписанию — рутина больше не отнимает время.' },
];

function Price({ name, price, unit, items, cta, href, featured }: {
  name: string; price: string; unit?: string; items: string[]; cta: string; href: string; featured?: boolean;
}) {
  return (
    <div className={`card flex flex-col ${featured ? 'border-orange-500 ring-1 ring-orange-500' : ''}`}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">{name}</h3>
        {featured && <span className="rounded-full bg-orange-500 px-2 py-0.5 text-xs font-medium text-white">Популярный</span>}
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight">
        {price}
        {unit && <span className="ml-1 text-sm font-normal text-mute">{unit}</span>}
      </p>
      <ul className="mt-4 flex flex-col gap-2 text-sm text-mute">
        {items.map((it) => (
          <li key={it} className="flex gap-2">
            <span aria-hidden className="text-orange-600">✓</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
      <Link href={href} className={`mt-6 ${featured ? 'btn-solid' : 'btn'} text-center`}>
        {cta}
      </Link>
    </div>
  );
}

export default function Landing() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="flex items-center justify-between">
        <span className="text-xl font-semibold tracking-tight">FlowDesk</span>
        <Link href="/login" className="btn">Войти</Link>
      </header>

      <section className="mt-14 max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Задачи, чат и ИИ-помощник для небольших команд
        </h1>
        <p className="mt-4 text-lg text-mute">
          FlowDesk объединяет канбан-доски, командный чат и personal-фокус «Мой день».
          Обсуждайте, превращайте сообщения в задачи и держите дедлайны под контролем — без десятка вкладок.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/login?mode=up" className="btn-solid">Попробовать бесплатно</Link>
          <Link href="/login" className="btn">У меня есть аккаунт</Link>
        </div>
        <p className="mt-3 text-sm text-mute">Бесплатный тариф навсегда: до 5 участников и 2 досок. Карта не нужна.</p>
      </section>

      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">Всё для работы команды в одном месте</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="card">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-mute">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">Простые тарифы</h2>
        <p className="mt-2 text-sm text-mute">Платите только за места. Начните бесплатно и растите вместе с командой.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Price
            name="Free"
            price="0 ₽"
            items={['До 5 участников', '2 доски на организацию', '1 организация', 'Чат, «Мой день», Telegram и ИИ']}
            cta="Начать бесплатно"
            href="/login?mode=up"
          />
          <Price
            name="Team"
            price="299 ₽"
            unit="за место / месяц"
            items={['До 500 участников', '100 досок на организацию', 'До 10 организаций', 'Всё из Free и приоритетная поддержка']}
            cta="Выбрать Team"
            href="/login?mode=up"
            featured
          />
        </div>
        <p className="mt-3 text-xs text-mute">Оплата Team подключается позже. Сейчас можно зарегистрироваться и пользоваться Free.</p>
      </section>

      <section className="mt-16 card flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Готовы навести порядок в задачах?</h2>
          <p className="mt-1 text-sm text-mute">Создайте аккаунт за минуту — первый отдел и доска появятся сразу.</p>
        </div>
        <Link href="/login?mode=up" className="btn-solid shrink-0">Создать аккаунт</Link>
      </section>

      <footer className="mt-12 border-t border-line pt-6 text-sm text-mute">
        FlowDesk — задачи, чат и ИИ-помощник команды.
      </footer>
    </main>
  );
}
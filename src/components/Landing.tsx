import Link from 'next/link';
import { getLang } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/dictionary';

function Price({ name, price, unit, items, cta, href, featured, popularLabel }: {
  name: string; price: string; unit?: string; items: string[]; cta: string; href: string; featured?: boolean; popularLabel: string;
}) {
  return (
    <div className={`card flex flex-col ${featured ? 'border-orange-500 ring-1 ring-orange-500' : ''}`}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold">{name}</h3>
        {featured && <span className="rounded-full bg-orange-500 px-2 py-0.5 text-xs font-medium text-white">{popularLabel}</span>}
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
  const lang = getLang();
  const t = (key: string) => translate(lang, key);
  const features = [1, 2, 3, 4, 5, 6].map((i) => ({ title: t(`landing.f${i}.title`), text: t(`landing.f${i}.text`) }));
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="flex items-center justify-between">
        <span className="text-xl font-semibold tracking-tight">FlowDesk</span>
        <Link href="/login" className="btn">{t('common.signIn')}</Link>
      </header>

      <section className="mt-14 max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          {t('landing.heroTitle')}
        </h1>
        <p className="mt-4 text-lg text-mute">
          {t('landing.heroText')}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/login?mode=up" className="btn-solid">{t('landing.tryFree')}</Link>
          <Link href="/login" className="btn">{t('landing.haveAccount')}</Link>
        </div>
        <p className="mt-3 text-sm text-mute">{t('landing.freeForever')}</p>
      </section>

      <section className="mt-16">
        <h2 className="text-2xl font-semibold tracking-tight">{t('landing.featuresTitle')}</h2>
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
        <h2 className="text-2xl font-semibold tracking-tight">{t('landing.pricingTitle')}</h2>
        <p className="mt-2 text-sm text-mute">{t('landing.pricingText')}</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Price
            name="Free"
            price="0 ₽"
            items={[t('landing.free.item1'), t('landing.free.item2'), t('landing.free.item3'), t('landing.free.item4')]}
            cta={t('landing.startFree')}
            href="/login?mode=up"
            popularLabel={t('landing.popular')}
          />
          <Price
            name="Team"
            price="299 ₽"
            unit={t('landing.perSeatMonth')}
            items={[t('landing.team.item1'), t('landing.team.item2'), t('landing.team.item3'), t('landing.team.item4')]}
            cta={t('landing.chooseTeam')}
            href="/login?mode=up"
            featured
            popularLabel={t('landing.popular')}
          />
        </div>
        <p className="mt-3 text-xs text-mute">{t('landing.paymentLater')}</p>
      </section>

      <section className="mt-16 card flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">{t('landing.ctaTitle')}</h2>
          <p className="mt-1 text-sm text-mute">{t('landing.ctaText')}</p>
        </div>
        <Link href="/login?mode=up" className="btn-solid shrink-0">{t('landing.createAccount')}</Link>
      </section>

      <footer className="mt-12 border-t border-line pt-6 text-sm text-mute">
        {t('landing.footer')}
      </footer>
    </main>
  );
}
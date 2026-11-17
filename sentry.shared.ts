// DSN — публичный ключ приёма событий (он всё равно попадает в клиентский бандл), не секрет.
// Пустая строка в NEXT_PUBLIC_SENTRY_DSN отключает Sentry.
export const SENTRY_DSN =
  process.env.NEXT_PUBLIC_SENTRY_DSN ??
  'https://70f67eab624ad179b3f8e79f0273c8f7@o4512447708397568.ingest.de.sentry.io/4512448213418064';

export const sentryBaseOptions = {
  dsn: SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? 'development',
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  // Бесплатный тариф: только ошибки, без performance-трейсинга.
  tracesSampleRate: 0,
};
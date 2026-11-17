import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: { instrumentationHook: true },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  // Загрузка source maps требует SENTRY_AUTH_TOKEN; без него собираем без карт.
  sourcemaps: { disable: true },
});
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        mute: 'rgb(var(--mute) / <alpha-value>)',
        white: 'rgb(var(--surface) / <alpha-value>)',
        neutral: {
          50: 'rgb(var(--sunken-1) / <alpha-value>)',
          100: 'rgb(var(--sunken-2) / <alpha-value>)',
          200: 'rgb(var(--sunken-3) / <alpha-value>)',
          700: 'rgb(var(--ink-hover) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;

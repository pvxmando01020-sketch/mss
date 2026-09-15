import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5dae3',
          300: '#b3bccb',
          400: '#8a97ac',
          500: '#67778f',
          600: '#52617a',
          700: '#435066',
          800: '#2a3240',
          900: '#161b24',
          950: '#0b0e14',
        },
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          200: '#bcd3ff',
          300: '#8fb4fb',
          400: '#5b8def',
          500: '#3b6fe0',
          600: '#2f5cc4',
          700: '#2a4da1',
          800: '#263f7f',
          900: '#1e305c',
        },
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'Tahoma', '"Noto Kufi Arabic"', 'Arial', 'sans-serif'],
        mono: ['"Cascadia Code"', 'Consolas', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;

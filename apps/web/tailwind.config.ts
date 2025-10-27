import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#0f172a',
        accent: '#22d3ee',
        panel: '#1e293b'
      }
    }
  },
  plugins: []
} satisfies Config;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/renderer/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        pw: {
          navy: '#0B1120',
          slate: '#111827',
          panel: '#1E293B',
          border: '#334155',
          blue: '#38BDF8',
          green: '#2EAD33',
          red: '#E11D48',
          amber: '#F59E0B',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

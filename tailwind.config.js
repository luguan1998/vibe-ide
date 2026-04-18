/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx,html}'],
  theme: {
    extend: {
      colors: {
        'ide-bg': '#1a1a2e',
        'ide-sidebar': '#16213e',
        'ide-panel': '#0f3460',
        'ide-border': '#2a2a4a',
        'ide-text': '#e0e0e0',
        'ide-text-muted': '#8888aa',
        'ide-accent': '#7c3aed',
        'ide-accent-hover': '#6d28d9',
        'ide-success': '#10b981',
        'ide-danger': '#ef4444',
        'ide-warning': '#f59e0b',
        'ide-hover': '#1e1e3a',
        'ide-active': '#2e2e4a'
      }
    }
  },
  plugins: []
}
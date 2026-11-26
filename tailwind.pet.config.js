/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/pet.html',
    './src/renderer/src/pet-main.tsx',
    './src/renderer/src/petWindowCss.ts',
    './src/renderer/src/components/DesktopPet/**/*.{ts,tsx}',
    './src/renderer/src/components/KeypadConfigModal.tsx',
    './src/renderer/src/components/ModalOverlay.tsx',
    './src/renderer/src/components/ErrorBoundary.tsx',
    './src/renderer/src/components/keypadItems.ts',
    './src/renderer/src/components/vibeEvents.ts',
    './src/renderer/src/components/AiTab/markdownShared.tsx'
  ],
  theme: {
    extend: {
      colors: {
        'ide-bg': 'rgb(var(--ide-bg) / <alpha-value>)',
        'ide-sidebar': 'rgb(var(--ide-sidebar) / <alpha-value>)',
        'ide-panel': 'rgb(var(--ide-panel) / <alpha-value>)',
        'ide-border': 'rgb(var(--ide-border) / <alpha-value>)',
        'ide-text': 'rgb(var(--ide-text) / <alpha-value>)',
        'ide-text-muted': 'rgb(var(--ide-text-muted) / <alpha-value>)',
        'ide-accent': 'rgb(var(--ide-accent) / <alpha-value>)',
        'ide-accent-hover': 'rgb(var(--ide-accent-hover) / <alpha-value>)',
        'ide-success': 'rgb(var(--ide-success) / <alpha-value>)',
        'ide-danger': 'rgb(var(--ide-danger) / <alpha-value>)',
        'ide-warning': 'rgb(var(--ide-warning) / <alpha-value>)',
        'ide-hover': 'rgb(var(--ide-hover) / <alpha-value>)',
        'ide-active': 'rgb(var(--ide-active) / <alpha-value>)'
      }
    }
  },
  plugins: []
}

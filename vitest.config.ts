import { defineConfig } from 'vitest/config'

// Sof mantiq testlari React plagini va /api proksisini tortib kelmasligi uchun
// bu konfiguratsiya `vite.config.ts` dan MUSTAQIL.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          environment: 'node',
          include: ['tests/core/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/server/**/*.test.ts'],
        },
      },
      {
        // Brauzer API'lariga tayanadigan klient moduli (`AudioManager`).
        // `jsdom` ATAYIN qo'shilmagan: kerak bo'lgani `window.AudioContext` va
        // `fetch` — ikkalasi ham testda qo'lda qo'yiladi, yangi bog'liqliksiz.
        test: {
          name: 'client',
          environment: 'node',
          include: ['tests/client/**/*.test.ts'],
        },
      },
    ],
  },
})

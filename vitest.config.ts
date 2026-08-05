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
    ],
  },
})

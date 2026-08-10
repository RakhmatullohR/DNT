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
      {
        // IndexedDB qatlami (`src/store/statsDb.ts`). ALOHIDA proyekt, chunki
        // bu yerda global `indexedDB` KERAK, boshqa hech qayerda esa KERAK EMAS:
        // `fake-indexeddb/auto` global'ni o'rnatadi, va uni umumiy setup'ga
        // qo'yish sof `core` testlarini ham brauzer API'si bor muhitga
        // ko'chirardi — repo'ning "core = sof mantiq, DOM yo'q" bo'linishiga zid.
        //
        // ⚠️ `fake-indexeddb` FAQAT devDependency: ishlab chiqarish kodi uni
        // hech qachon import qilmaydi, u shu yerda — testda — ulanadi.
        test: {
          name: 'store',
          environment: 'node',
          include: ['tests/store/**/*.test.ts'],
          setupFiles: ['fake-indexeddb/auto'],
        },
      },
    ],
  },
})

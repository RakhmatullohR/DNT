// `src/store/persist.ts` testlari (docs/stats-longterm.md §3.1 va §3.3).
//
// `core` loyihasi NODE muhitida ishlaydi — u yerda haqiqiy `navigator.storage`
// yo'q (Node 24 da `navigator` global'i mavjud, lekin Storage Manager API'si
// yo'q). Shuning uchun har bir testda `globalThis.navigator` `vi.stubGlobal`
// bilan qo'lda o'rnatiladi va `afterEach` da `vi.unstubAllGlobals()` bilan
// asl holatga qaytariladi — aks holda keyingi testga soxta global sizib o'tardi.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { persistenceState, requestPersistence, storageEstimate } from '../../src/store/persist.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------

describe('requestPersistence() — §3.1/§3.3', () => {
  it("navigator umuman yo'q bo'lsa 'unsupported' qaytaradi", async () => {
    vi.stubGlobal('navigator', undefined)

    await expect(requestPersistence()).resolves.toBe('unsupported')
  })

  it("navigator.storage yo'q bo'lsa 'unsupported' qaytaradi", async () => {
    vi.stubGlobal('navigator', {})

    await expect(requestPersistence()).resolves.toBe('unsupported')
  })

  it("persisted() true qaytarsa 'granted' — va persist() QAYTA CHAQIRILMAYDI", async () => {
    const persist = vi.fn()
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(true),
        persist,
      },
    })

    await expect(requestPersistence()).resolves.toBe('granted')
    // §3.1: allaqachon doimiy bo'lsa `persist()` chaqirilmasligi shart —
    // ba'zi brauzerlar uni har chaqirilganda foydalanuvchiga so'rov ko'rsatadi.
    expect(persist).not.toHaveBeenCalled()
  })

  it("persisted() false, persist() true bo'lsa 'granted' qaytaradi", async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        persist: vi.fn().mockResolvedValue(true),
      },
    })

    await expect(requestPersistence()).resolves.toBe('granted')
  })

  it("persisted() false, persist() false bo'lsa 'denied' qaytaradi", async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        persist: vi.fn().mockResolvedValue(false),
      },
    })

    await expect(requestPersistence()).resolves.toBe('denied')
  })

  it("⭐ persist() tashlasa 'denied' — 'unsupported' EMAS", async () => {
    // §3.3 ning butun maqsadi — "jimgina yo'qolish o'rniga KO'RINADIGAN holat".
    // Ilgari mavjudlik tekshiruvi va chaqiruv bitta `try` da edi, shuning uchun
    // `persist()` ning `SecurityError` i ham "brauzeringiz qo'llab-quvvatlamaydi"
    // bo'lib ko'rinardi — foydalanuvchi esa eksport odatini shakllantirish
    // o'rniga "menda imkoni yo'q" deb qo'yardi, holbuki API bor va qayta
    // so'rash mumkin.
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockResolvedValue(false),
        persist: vi.fn().mockRejectedValue(new Error('SecurityError')),
      },
    })

    await expect(requestPersistence()).resolves.toBe('denied')
  })

  it("persisted() tashlasa ham 'denied' — API bor, chaqiruv o'tmadi", async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: vi.fn().mockRejectedValue(new Error('SecurityError')),
        persist: vi.fn(),
      },
    })

    await expect(requestPersistence()).resolves.toBe('denied')
  })

  it("MAVJUDLIK tekshiruvining o'zi tashlasa 'unsupported'", async () => {
    // Cookie'lari o'chirilgan brauzer / `file://` sahifasi: `navigator.storage`
    // ga MUROJAATNING o'zi `SecurityError` tashlaydi. Bu — haqiqatan
    // "qo'llab-quvvatlanmaydi", shuning uchun holat `'denied'` EMAS.
    vi.stubGlobal('navigator', {
      get storage(): never {
        throw new Error('SecurityError')
      },
    })

    await expect(requestPersistence()).resolves.toBe('unsupported')
  })

  it("persist metodi yo'q bo'lsa 'unsupported'", async () => {
    vi.stubGlobal('navigator', {
      storage: { persisted: vi.fn().mockResolvedValue(false) },
    })

    await expect(requestPersistence()).resolves.toBe('unsupported')
  })
})

// ---------------------------------------------------------------------------

describe('persistenceState() — §3.3 holat ko\'rsatkichi', () => {
  it("persisted() true -> 'granted', va persist() UMUMAN chaqirilmaydi", async () => {
    const persist = vi.fn()
    vi.stubGlobal('navigator', {
      storage: { persisted: vi.fn().mockResolvedValue(true), persist },
    })

    await expect(persistenceState()).resolves.toBe('granted')
    // Bu funksiya faqat O'QIYDI — so'rov ko'rsatishi mumkin bo'lgan hech narsa
    // chaqirilmasligi kerak (Stats ekrani uni har ochilganda ishga tushiradi).
    expect(persist).not.toHaveBeenCalled()
  })

  it("persisted() false -> 'denied'", async () => {
    vi.stubGlobal('navigator', {
      storage: { persisted: vi.fn().mockResolvedValue(false) },
    })

    await expect(persistenceState()).resolves.toBe('denied')
  })

  it("API yo'q -> 'unsupported'", async () => {
    vi.stubGlobal('navigator', undefined)
    await expect(persistenceState()).resolves.toBe('unsupported')

    vi.stubGlobal('navigator', {})
    await expect(persistenceState()).resolves.toBe('unsupported')

    vi.stubGlobal('navigator', { storage: {} })
    await expect(persistenceState()).resolves.toBe('unsupported')
  })

  it("persisted() tashlasa 'denied' — mavjudlik tekshiruvi tashlasa 'unsupported'", async () => {
    vi.stubGlobal('navigator', {
      storage: { persisted: vi.fn().mockRejectedValue(new Error('SecurityError')) },
    })
    await expect(persistenceState()).resolves.toBe('denied')

    vi.stubGlobal('navigator', {
      get storage(): never {
        throw new Error('SecurityError')
      },
    })
    await expect(persistenceState()).resolves.toBe('unsupported')
  })
})

// ---------------------------------------------------------------------------

describe('storageEstimate()', () => {
  it('normal qiymatda ratio ni hisoblaydi', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn().mockResolvedValue({ usage: 50, quota: 200 }),
      },
    })

    await expect(storageEstimate()).resolves.toEqual({ usage: 50, quota: 200, ratio: 0.25 })
  })

  it("quota 0 bo'lsa ratio 0 bo'ladi (nolga bo'lish yo'q)", async () => {
    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn().mockResolvedValue({ usage: 0, quota: 0 }),
      },
    })

    await expect(storageEstimate()).resolves.toEqual({ usage: 0, quota: 0, ratio: 0 })
  })

  it("API yo'q bo'lsa null qaytaradi", async () => {
    vi.stubGlobal('navigator', { storage: {} })

    await expect(storageEstimate()).resolves.toBeNull()
  })

  it("estimate() bo'sh obyekt qaytarsa null (usage/quota son emas)", async () => {
    // Spetsifikatsiya bo'yicha `usage` va `quota` IXTIYORIY — brauzer ikkalasini
    // ham tashlab ketishi mumkin. Bunda `ratio` `NaN` bo'lardi va ekranda
    // "NaN%" chiqardi; `null` esa "ma'lumot yo'q" degan ochiq holat.
    vi.stubGlobal('navigator', {
      storage: { estimate: vi.fn().mockResolvedValue({}) },
    })

    await expect(storageEstimate()).resolves.toBeNull()
  })

  it("faqat bittasi son bo'lsa ham null", async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: vi.fn().mockResolvedValue({ usage: 50 }) },
    })
    await expect(storageEstimate()).resolves.toBeNull()

    vi.stubGlobal('navigator', {
      storage: { estimate: vi.fn().mockResolvedValue({ quota: 200 }) },
    })
    await expect(storageEstimate()).resolves.toBeNull()
  })

  it("estimate() tashlasa null qaytaradi", async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: vi.fn().mockRejectedValue(new Error('SecurityError')) },
    })

    await expect(storageEstimate()).resolves.toBeNull()
  })
})

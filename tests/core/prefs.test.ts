// `src/store/prefs.ts` testlari.
//
// `lessons.test.ts` bilan bir xil muhit qoidasi: `core` proyekti NODE da
// ishlaydi va u yerda `localStorage` yo'q, shuning uchun har testdan oldin
// xotiradagi minimal `Storage` qo'yiladi.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readPrefs, writePrefs } from '../../src/store/prefs.ts'

/** Modul ichidagi kalitning nusxasi — buzuq qiymatni qo'lda joylashtirish uchun. */
const PREFS_KEY = 'dnt.prefs.v1'

function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length(): number {
      return map.size
    },
    key(index: number): string | null {
      return [...map.keys()][index] ?? null
    },
    getItem(key: string): string | null {
      const value = map.get(key)
      return value === undefined ? null : value
    },
    setItem(key: string, value: string): void {
      map.set(key, String(value))
    },
    removeItem(key: string): void {
      map.delete(key)
    },
    clear(): void {
      map.clear()
    },
  }
}

/** Har qanday yozishni rad etadigan ombor: kvota to'lgan holat. */
function createRejectingStorage(): Storage {
  const base = createMemoryStorage()
  return {
    ...base,
    get length(): number {
      return base.length
    },
    key: (index: number) => base.key(index),
    getItem: (key: string) => base.getItem(key),
    setItem(): void {
      throw new Error('QuotaExceededError')
    },
    removeItem: (key: string) => {
      base.removeItem(key)
    },
    clear: () => {
      base.clear()
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readPrefs', () => {
  it("bo'sh omborda standart qiymat", () => {
    expect(readPrefs()).toEqual({ maskWords: false, notesEnabled: false })
  })

  it('saqlangan qiymatni qaytaradi', () => {
    writePrefs({ maskWords: true })

    expect(readPrefs().maskWords).toBe(true)
  })

  it('HAR SAFAR yangi obyekt — umumiy nusxa yo\'q', () => {
    const first = readPrefs()
    first.maskWords = true

    expect(readPrefs().maskWords).toBe(false)
  })

  it("buzuq JSON standartga tushadi, yiqilmaydi", () => {
    localStorage.setItem(PREFS_KEY, 'bu JSON emas {{{')

    expect(readPrefs()).toEqual({ maskWords: false, notesEnabled: false })
  })

  it('`notesEnabled` ham saqlanadi va qaytadi', () => {
    writePrefs({ notesEnabled: true })

    expect(readPrefs().notesEnabled).toBe(true)
  })

  it("noto'g'ri TIPDAGI `notesEnabled` standartga tushadi", () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ notesEnabled: 'true' }))

    expect(readPrefs().notesEnabled).toBe(false)
  })

  it("noto'g'ri TIPDAGI qiymat standartga tushadi", () => {
    // `'true'` (satr) — `true` emas: sozlama uchun bu buzuq yozuv.
    localStorage.setItem(PREFS_KEY, JSON.stringify({ maskWords: 'true' }))

    expect(readPrefs().maskWords).toBe(false)
  })

  it('ildiz obyekt bo\'lmasa standartga tushadi', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify([1, 2, 3]))

    expect(readPrefs()).toEqual({ maskWords: false, notesEnabled: false })
  })

  it("`localStorage` umuman bo'lmasa standart qaytadi", () => {
    vi.stubGlobal('localStorage', undefined)

    expect(readPrefs()).toEqual({ maskWords: false, notesEnabled: false })
  })
})

describe('writePrefs', () => {
  it('qayta yozish oldingi qiymat ustiga tushadi', () => {
    writePrefs({ maskWords: true })
    writePrefs({ maskWords: false })

    expect(readPrefs().maskWords).toBe(false)
  })

  it('bitta maydonni yozish QO\'SHNISINI o\'chirmaydi', () => {
    // `writePrefs` — `Partial<Prefs>` ustidan birlashtirish. Ikki maydon paydo
    // bo'lgach bu xossa sinovsiz qolsa, keyingi sozlama qo'shilganda jimgina
    // buzilardi.
    writePrefs({ maskWords: true })
    writePrefs({ notesEnabled: true })

    expect(readPrefs()).toEqual({ maskWords: true, notesEnabled: true })
  })

  it("TANILMAGAN maydonlar saqlanib qoladi", () => {
    // Kelajakda qo'shiladigan sozlama eski versiyada ochilgan ilova tomonidan
    // o'chirilmasligi kerak.
    localStorage.setItem(PREFS_KEY, JSON.stringify({ kelajakdagi: 42 }))

    writePrefs({ maskWords: true })

    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>
    expect(raw['kelajakdagi']).toBe(42)
    expect(raw['maskWords']).toBe(true)
  })

  it("yozib bo'lmasa ham YIQILMAYDI", () => {
    vi.stubGlobal('localStorage', createRejectingStorage())

    // Mashq to'xtamasligi kerak: foydalanuvchi faqat "keyingi safar esda
    // qolsin" imkonini yo'qotadi.
    expect(() => {
      writePrefs({ maskWords: true })
    }).not.toThrow()
  })

  it("`localStorage` umuman bo'lmasa ham yiqilmaydi", () => {
    vi.stubGlobal('localStorage', undefined)

    expect(() => {
      writePrefs({ maskWords: true })
    }).not.toThrow()
  })
})

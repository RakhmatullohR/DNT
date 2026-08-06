import { describe, expect, it } from 'vitest'

import {
  clampIndex,
  hasWrittenSentence,
  SESSION_MAX_MS,
  SESSION_MAX_SENTENCES,
  sessionShouldEnd,
} from '../../src/core/session.ts'

describe('seans chegaralari', () => {
  it("PLAN §7 dagi qiymatlarni saqlaydi: 20 gap va 10 daqiqa", () => {
    expect(SESSION_MAX_SENTENCES).toBe(20)
    expect(SESSION_MAX_MS).toBe(600_000)
  })

  it('boshlanmagan seans tugamaydi', () => {
    expect(sessionShouldEnd(0, 0)).toBe(false)
  })

  it('chegaradan pastda davom etadi', () => {
    expect(sessionShouldEnd(SESSION_MAX_SENTENCES - 1, SESSION_MAX_MS - 1)).toBe(false)
  })

  it('gaplar soni chegaraga yetganda tugaydi', () => {
    expect(sessionShouldEnd(SESSION_MAX_SENTENCES, 0)).toBe(true)
    expect(sessionShouldEnd(SESSION_MAX_SENTENCES + 5, 0)).toBe(true)
  })

  it('vaqt chegaraga yetganda tugaydi', () => {
    expect(sessionShouldEnd(0, SESSION_MAX_MS)).toBe(true)
    expect(sessionShouldEnd(3, SESSION_MAX_MS + 1)).toBe(true)
  })

  it("buzuq raqamlar seansni erta tugatmaydi", () => {
    expect(sessionShouldEnd(Number.NaN, Number.NaN)).toBe(false)
    expect(sessionShouldEnd(-5, -1_000)).toBe(false)
    expect(sessionShouldEnd(Number.POSITIVE_INFINITY, 0)).toBe(false)
  })
})

describe('boshlanish indeksi', () => {
  it("oddiy holatda progress indeksning o'zi bo'lib qoladi", () => {
    expect(clampIndex(0, 10)).toBe(0)
    expect(clampIndex(3, 10)).toBe(3)
  })

  it("oxirgi gap indeksi kesilmaydi", () => {
    // `total - 1` — hali YOZILMAGAN oxirgi gap, dars tugagani emas.
    expect(clampIndex(9, 10)).toBe(9)
    expect(clampIndex(0, 1)).toBe(0)
  })

  it("TUGAGAN dars boshidan boshlanadi: progress === total -> 0", () => {
    // Bu shu faylning eng muhim tekshiruvi. `store/lessons.ts` dagi
    // `clampProgress` `sentences.length` ni ATAYLAB saqlaydi — u "dars tugadi"
    // belgisi. Bu yerda `total - 1` qaytarilsa, tugagan darsni ochish oxirgi
    // gapni qayta yozdirardi, u tugagach progress yana `total` bo'lardi va
    // natijalar -> "Davom ettirish" halqasi cheksiz aylanardi.
    expect(clampIndex(10, 10)).toBe(0)
    expect(clampIndex(1, 1)).toBe(0)
    expect(clampIndex(20, 20)).toBe(0)
  })

  it("total dan katta qiymat ham boshiga qaytaradi", () => {
    expect(clampIndex(11, 10)).toBe(0)
    expect(clampIndex(1_000, 3)).toBe(0)
  })

  it("bo'sh darsda manfiy indeks qaytmaydi", () => {
    // `total === 0` da `total - 1` = -1 bo'lardi va `sentences[-1]` `undefined` edi.
    expect(clampIndex(0, 0)).toBe(0)
    expect(clampIndex(5, 0)).toBe(0)
  })

  it('manfiy progress boshiga qaytariladi', () => {
    expect(clampIndex(-1, 10)).toBe(0)
    expect(clampIndex(-1_000, 10)).toBe(0)
  })

  it("buzuq raqam boshiga qaytariladi", () => {
    expect(clampIndex(Number.NaN, 10)).toBe(0)
    expect(clampIndex(Number.POSITIVE_INFINITY, 10)).toBe(0)
    expect(clampIndex(Number.NEGATIVE_INFINITY, 10)).toBe(0)
  })

  it('kasr qiymat pastga yaxlitlanadi', () => {
    expect(clampIndex(2.9, 10)).toBe(2)
    // Yaxlitlangandan KEYIN ham "tugadi" belgisi belgiligicha qoladi.
    expect(clampIndex(9.9, 10)).toBe(9)
    expect(clampIndex(10.9, 10)).toBe(0)
  })
})

describe("bo'sh seans darvozasi", () => {
  it("bitta ham yozuv bo'lmasa false", () => {
    expect(hasWrittenSentence([])).toBe(false)
  })

  it('HAMMASI Escape bilan tashlangan seans BO\'SH hisoblanadi', () => {
    // Nuqsonning o'zi: `records.length` ga qaralsa bu seans "bo'sh emas"
    // ko'rinardi va omborga `activeMs: 0`, `netWpm: 0`, `accuracy: 0` bo'lib
    // yozilardi — PLAN §7 oldini olmoqchi bo'lgan aynan o'sha ifloslanish.
    expect(hasWrittenSentence([{ skipped: true }])).toBe(false)
    expect(
      hasWrittenSentence([
        { skipped: true },
        { skipped: true },
        { skipped: true },
        { skipped: true },
        { skipped: true },
      ]),
    ).toBe(false)
  })

  it('bitta yozilgan gap yetarli', () => {
    expect(hasWrittenSentence([{ skipped: false }])).toBe(true)
  })

  it("aralash seans — yozilgan gap bo'lsa seans yoziladi", () => {
    expect(hasWrittenSentence([{ skipped: true }, { skipped: false }])).toBe(true)
    expect(hasWrittenSentence([{ skipped: false }, { skipped: true }])).toBe(true)
    expect(
      hasWrittenSentence([{ skipped: true }, { skipped: false }, { skipped: true }]),
    ).toBe(true)
  })
})

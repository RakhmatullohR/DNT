// `statsSchema.ts` dagi SOF yordamchilar (docs/stats-longterm.md §4.2, §4.3).
//
// Bu testlar IndexedDB'ga UMUMAN tegmaydi — tekshirilayotgani arifmetika:
// chelak yig'uvchilaridan ko'rsatiladigan shaklga o'tish og'irlikli o'rtacha
// bo'lishi va nol bo'luvchida `NaN` chiqmasligi.

import { describe, expect, it } from 'vitest'

import {
  accumToBucket,
  addAccum,
  addLifetime,
  dayKeyOf,
  emptyAccum,
  emptyLifetime,
  netCharsOf,
} from '../../src/store/statsSchema.ts'

describe('addAccum', () => {
  const sentence = {
    activeMs: 60_000,
    keystrokes: 100,
    correctKeystrokes: 95,
    netWpm: 40,
    rawWpm: 45,
  }

  it('kirish chelagini O\'ZGARTIRMAYDI (sof)', () => {
    const acc = emptyAccum()
    const next = addAccum(acc, sentence)

    expect(acc).toEqual(emptyAccum())
    expect(next).not.toBe(acc)
  })

  it('har chaqiruv bitta gap sanaydi va tezlikni `activeMs` ga og\'irlaydi', () => {
    const acc = addAccum(emptyAccum(), sentence)

    expect(acc.sentences).toBe(1)
    expect(acc.activeMs).toBe(60_000)
    expect(acc.keystrokes).toBe(100)
    expect(acc.correctKeystrokes).toBe(95)
    expect(acc.netWeighted).toBe(40 * 60_000)
    expect(acc.rawWeighted).toBe(45 * 60_000)
  })

  it('ketma-ket qo\'shiladi', () => {
    const acc = addAccum(addAccum(emptyAccum(), sentence), sentence)

    expect(acc.sentences).toBe(2)
    expect(acc.activeMs).toBe(120_000)
    expect(acc.netWeighted).toBe(2 * 40 * 60_000)
  })
})

describe('accumToBucket', () => {
  it('og\'irlikli o\'rtachani beradi — sodda o\'rtachani EMAS', () => {
    // Ikkita gap: 10 s da 30 wpm va 50 s da 60 wpm.
    // Sodda o'rtacha 45 bo'lardi; og'irlikli o'rtacha uzun gapga yaqin turadi.
    let acc = emptyAccum()
    acc = addAccum(acc, {
      activeMs: 10_000,
      keystrokes: 50,
      correctKeystrokes: 45,
      netWpm: 30,
      rawWpm: 33,
    })
    acc = addAccum(acc, {
      activeMs: 50_000,
      keystrokes: 250,
      correctKeystrokes: 240,
      netWpm: 60,
      rawWpm: 66,
    })

    const bucket = accumToBucket(acc)

    // (30·10000 + 60·50000) / 60000 = 55
    expect(bucket.netWpm).toBeCloseTo(55, 10)
    // (33·10000 + 66·50000) / 60000 = 60.5
    expect(bucket.rawWpm).toBeCloseTo(60.5, 10)
    // 285 / 300
    expect(bucket.accuracy).toBeCloseTo(0.95, 10)
    expect(bucket.sentences).toBe(2)
    expect(bucket.activeMs).toBe(60_000)
    expect(bucket.keystrokes).toBe(300)
    expect(bucket.correctKeystrokes).toBe(285)
  })

  it('bo\'sh chelakda 0 qaytaradi, `NaN` emas', () => {
    const bucket = accumToBucket(emptyAccum())

    expect(bucket.netWpm).toBe(0)
    expect(bucket.rawWpm).toBe(0)
    expect(bucket.accuracy).toBe(0)
  })

  it('`activeMs` nol, lekin bosishlar bor bo\'lsa faqat tezlik 0 bo\'ladi', () => {
    const bucket = accumToBucket({
      sentences: 1,
      activeMs: 0,
      keystrokes: 20,
      correctKeystrokes: 10,
      netWeighted: 0,
      rawWeighted: 0,
    })

    expect(bucket.netWpm).toBe(0)
    expect(bucket.rawWpm).toBe(0)
    expect(bucket.accuracy).toBe(0.5)
  })
})

describe('netCharsOf', () => {
  it('60 wpm · 1 daqiqa -> 300 belgi', () => {
    expect(netCharsOf(60, 60_000)).toBeCloseTo(300, 10)
  })

  it('40 wpm · 30 s -> 100 belgi', () => {
    expect(netCharsOf(40, 30_000)).toBeCloseTo(100, 10)
  })

  it('nol vaqt -> 0', () => {
    expect(netCharsOf(60, 0)).toBe(0)
  })
})

describe('addLifetime', () => {
  it('deltani qo\'shadi va kirishni O\'ZGARTIRMAYDI', () => {
    const meta = emptyLifetime()
    const next = addLifetime(meta, { activeMs: 1000, sessions: 1 })

    expect(meta).toEqual(emptyLifetime())
    expect(next.activeMs).toBe(1000)
    expect(next.sessions).toBe(1)
    expect(next.keystrokes).toBe(0)
  })

  it('berilmagan maydonlar o\'zgarmaydi', () => {
    const meta = { ...emptyLifetime(), keystrokes: 500 }
    const next = addLifetime(meta, { netChars: 20 })

    expect(next.keystrokes).toBe(500)
    expect(next.netChars).toBe(20)
  })

  it('⚠️ `*Since` maydonlari deltadan O\'ZGARMAYDI (§4.3)', () => {
    // "Bu maydon qaysi sanadan beri to'liq bilinadi" — o'zgarmas fakt.
    // Yangi yozuv migratsiyagacha bo'lgan bilimsizlikni to'ldirmaydi.
    const meta = { ...emptyLifetime(), sessionsSince: 19_000, keystrokesSince: 19_000 }
    const next = addLifetime(meta, { sessions: 3, keystrokes: 400 })

    expect(next.sessionsSince).toBe(19_000)
    expect(next.keystrokesSince).toBe(19_000)
    expect(next.sessions).toBe(3)
  })

  it('bo\'sh umrbod konvertda `*Since` UMUMAN yo\'q', () => {
    const meta = emptyLifetime()

    expect(meta.netCharsSince).toBeUndefined()
    expect(meta.sessionsSince).toBeUndefined()
    expect(meta.keystrokesSince).toBeUndefined()
  })
})

describe('dayKeyOf', () => {
  it('LOKAL kalendar kunini `\'YYYY-MM-DD\'` ga aylantiradi', () => {
    // Lokal peshin — mintaqa ofseti qanday bo'lishidan qat'i nazar o'sha kun.
    const noon = new Date(2024, 1, 29, 12, 0, 0).getTime()

    expect(dayKeyOf(noon)).toBe('2024-02-29')
  })

  it('bir sutka farq bitta kunga siljitadi', () => {
    const noon = new Date(2024, 0, 1, 12, 0, 0).getTime()
    const nextNoon = new Date(2024, 0, 2, 12, 0, 0).getTime()

    expect(dayKeyOf(noon)).toBe('2024-01-01')
    expect(dayKeyOf(nextNoon)).toBe('2024-01-02')
  })
})

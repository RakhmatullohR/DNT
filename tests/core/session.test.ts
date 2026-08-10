import { describe, expect, it } from 'vitest'

import {
  clampIndex,
  hasWrittenSentence,
  nextSentenceIndex,
  planSentenceWrite,
  SESSION_MAX_MS,
  SESSION_MAX_SENTENCES,
  sessionShouldEnd,
  wordDeltaOf,
} from '../../src/core/session.ts'
import type { SentenceWritePlan } from '../../src/core/session.ts'
import { tokenize } from '../../src/core/tokenize.ts'

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

describe('tashlangan gaplar dars oxirida qaytadi', () => {
  it("dars TUGAMAGAN bo'lsa tashlangan gaplar navbatni buzmaydi", () => {
    // Eng muhim tekshiruv: "tashlangan gapga darhol qaytish" mantiq TESKARI
    // tuzoq yasardi — seans doim o'sha ataylab tashlangan gapga qaytaverardi va
    // undan chiqishning yagona yo'li uni yozib tugatish bo'lardi.
    expect(nextSentenceIndex(5, 10, [2])).toBe(5)
    expect(nextSentenceIndex(0, 10, [0, 3])).toBe(0)
    expect(nextSentenceIndex(9, 10, [1, 4])).toBe(9)
  })

  it('dars TUGAGANDA eng kichik tashlangan gapdan boshlanadi', () => {
    expect(nextSentenceIndex(10, 10, [7, 2, 5])).toBe(2)
    expect(nextSentenceIndex(10, 10, [9])).toBe(9)
    expect(nextSentenceIndex(3, 3, [0])).toBe(0)
  })

  it("tashlangan gap qolmasa tugagan dars boshidan boshlanadi", () => {
    // `clampIndex` bilan bir xil xulq: bu yerda hech narsa o'zgarmaydi.
    expect(nextSentenceIndex(10, 10, [])).toBe(0)
    expect(nextSentenceIndex(10, 10)).toBe(0)
  })

  it('chegaradan chiqqan tashlangan indekslar e\'tiborsiz qoladi', () => {
    // Ro'yxat `localStorage` dan keladi — ishonchsiz.
    expect(nextSentenceIndex(10, 10, [10, 42])).toBe(0)
    expect(nextSentenceIndex(10, 10, [-1, 4])).toBe(4)
    expect(nextSentenceIndex(10, 10, [Number.NaN, Number.POSITIVE_INFINITY, 6])).toBe(6)
    expect(nextSentenceIndex(10, 10, [3.9])).toBe(3)
  })

  it("progressdan KATTA (ombor kesib ulgurmagan) qiymat ham tugadi deb qaraladi", () => {
    expect(nextSentenceIndex(99, 10, [4])).toBe(4)
  })

  it("buzuq progress oddiy yo'lga tushadi, tashlanganlar ochilmaydi", () => {
    expect(nextSentenceIndex(Number.NaN, 10, [4])).toBe(0)
    expect(nextSentenceIndex(Number.POSITIVE_INFINITY, 10, [4])).toBe(0)
    expect(nextSentenceIndex(-5, 10, [4])).toBe(0)
  })

  it("gapsiz darsda doim 0", () => {
    expect(nextSentenceIndex(0, 0, [0])).toBe(0)
    expect(nextSentenceIndex(3, 0, [1])).toBe(0)
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

// ---------------------------------------------------------------------------
// Gap darajasidagi yozuv shartnomasi (docs/stats-longterm.md §8.2)
// ---------------------------------------------------------------------------

/** Test uchun minimal gap yozuvi — `planSentenceWrite` faqat `skipped` ga qaraydi. */
type Rec = { id: string; skipped: boolean }

function rec(id: string, skipped: boolean): Rec {
  return { id, skipped }
}

describe('gap darajasidagi yozuv darvozasi (§8.2.5)', () => {
  it("birinchi YOZILGAN gap darhol quyiladi", () => {
    const plan = planSentenceWrite([], false, rec('a', false))
    expect(plan.write.map((r) => r.id)).toEqual(['a'])
    expect(plan.pending).toEqual([])
    expect(plan.hasWritten).toBe(true)
  })

  it('birinchi TASHLANGAN gap yozilmaydi, buferda ushlanadi', () => {
    const plan = planSentenceWrite([], false, rec('a', true))
    expect(plan.write).toEqual([])
    expect(plan.pending.map((r) => r.id)).toEqual(['a'])
    expect(plan.hasWritten).toBe(false)
  })

  it('⭐ ketma-ket kelgan BARCHA tashlangan gaplar birinchi yozilgani bilan BIRGA quyiladi', () => {
    // "Faqat oxirgisini ushlab turish" varianti aynan shu yerda yiqilardi:
    // birinchi ikkita tashlangan gap jimgina yo'qolib, seansdagi gaplar soni
    // yozuv bilan kelishmay qolardi.
    let pending: readonly Rec[] = []
    let hasWritten = false
    const written: string[] = []

    for (const record of [rec('s1', true), rec('s2', true), rec('s3', true), rec('w', false)]) {
      const plan: SentenceWritePlan<Rec> = planSentenceWrite(pending, hasWritten, record)
      written.push(...plan.write.map((r) => r.id))
      pending = plan.pending
      hasWritten = plan.hasWritten
    }

    expect(written).toEqual(['s1', 's2', 's3', 'w'])
    expect(pending).toEqual([])
    expect(hasWritten).toBe(true)
  })

  it('darvoza ochilgandan keyin tashlangan gap ham DARHOL yoziladi', () => {
    const plan = planSentenceWrite([], true, rec('x', true))
    expect(plan.write.map((r) => r.id)).toEqual(['x'])
    expect(plan.pending).toEqual([])
    expect(plan.hasWritten).toBe(true)
  })

  it('⭐ butunlay tashlangan seans HECH NARSA yozmaydi (PLAN §7 darvozasi saqlanadi)', () => {
    let pending: readonly Rec[] = []
    let hasWritten = false
    const written: string[] = []

    for (const record of [rec('a', true), rec('b', true), rec('c', true)]) {
      const plan: SentenceWritePlan<Rec> = planSentenceWrite(pending, hasWritten, record)
      written.push(...plan.write.map((r) => r.id))
      pending = plan.pending
      hasWritten = plan.hasWritten
    }

    expect(written).toEqual([])
    expect(hasWritten).toBe(false)
    // Bufer to'lgan, lekin chaqiruvchi uni TASHLAYDI — `hasWritten` false.
    expect(pending.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('`hasWritten` `hasWrittenSentence` bilan HAR DOIM kelishadi', () => {
    const cases: boolean[][] = [
      [],
      [true],
      [true, true, true],
      [false],
      [true, false],
      [true, true, false, true],
      [false, true, true],
    ]

    for (const flags of cases) {
      const records = flags.map((skipped, i) => rec(String(i), skipped))
      let pending: readonly Rec[] = []
      let hasWritten = false
      for (const record of records) {
        const plan: SentenceWritePlan<Rec> = planSentenceWrite(pending, hasWritten, record)
        pending = plan.pending
        hasWritten = plan.hasWritten
      }
      expect(hasWritten).toBe(hasWrittenSentence(records))
    }
  })

  it('SOF: kiruvchi bufer o\'zgartirilmaydi', () => {
    const pending = [rec('a', true)]
    const before = [...pending]
    planSentenceWrite(pending, false, rec('b', true))
    expect(pending).toEqual(before)
  })
})

describe("bitta gapning so'z hissasi (§8.1)", () => {
  it("faqat `word` tokenlar sanaladi, kalitlar kichik harfda", () => {
    const tokens = tokenize('The quick fox.')
    const delta = wordDeltaOf(tokens, new Map())

    expect([...delta.keys()].sort()).toEqual(['fox', 'quick', 'the'])
    expect(delta.get('the')).toEqual({ exposures: 1, errors: 0 })
  })

  it("`The` va `the` BITTA kalitga qo'shiladi", () => {
    const tokens = tokenize('The cat and the dog.')
    const delta = wordDeltaOf(tokens, new Map())
    expect(delta.get('the')).toEqual({ exposures: 2, errors: 0 })
  })

  it('xatolar TOKEN indeksi bo\'yicha olinadi', () => {
    const tokens = tokenize('The quick fox.')
    // `tokenize` gaplarni uzluksiz beradi: 0='The', 1=' ', 2='quick', 3=' ', 4='fox'
    const errors = new Map([
      [0, 1],
      [4, 3],
    ])
    const delta = wordDeltaOf(tokens, errors)

    expect(delta.get('the')).toEqual({ exposures: 1, errors: 1 })
    expect(delta.get('quick')).toEqual({ exposures: 1, errors: 0 })
    // `fox` da UCHTA klavish xatosi, lekin bitta TA'SIRLANISH -> bitta xato.
    expect(delta.get('fox')).toEqual({ exposures: 1, errors: 1 })
  })

  it('⭐ `errors <= exposures` QURILISH bo\'yicha — har ta\'sirlanishga ko\'pi bilan bitta xato', () => {
    // Ombor darajasidagi qisqich sinovdan o'tmasdi: u TARTIBGA BOG'LIQ bo'lib
    // qolardi va ayni mashq tarixi seanslar tartibiga qarab 17% yoki 50%
    // berardi, buzilish esa qaytarib bo'lmaydigan UMRBOD hisoblagichda sodir
    // bo'lardi (`PLAN.md` §11.3, 9-invariant).
    const delta = wordDeltaOf(tokenize('rhythm'), new Map([[0, 5]]))
    expect(delta.get('rhythm')).toEqual({ exposures: 1, errors: 1 })
  })

  it('qisqich TOKEN bo\'yicha: bitta gapda ikki marta xato qilingan so\'z 2/2 beradi', () => {
    // Qisqich so'z bo'yicha YIG'INDIGA qo'yilsa bu holat 2/1 bo'lib, ikkinchi
    // ta'sirlanishning xatosi jimgina yo'qolardi.
    const tokens = tokenize('the cat and the dog')
    // 0='the', 6='the' (oradagi toq indekslar — bo'shliqlar).
    const delta = wordDeltaOf(tokens, new Map([[0, 4], [6, 2]]))
    expect(delta.get('the')).toEqual({ exposures: 2, errors: 2 })
  })

  it('⭐ KUMULYATIV EMAS: har chaqiruv faqat O\'Z gapining hissasini beradi', () => {
    // §8.1 ning butun mag'zi. `wordStatsRef` seans davomida yig'ilib boradi va
    // uni har gapda quysa, birinchi gapning hissasi ikkinchi marta yozilardi.
    const first = wordDeltaOf(tokenize('the cat'), new Map())
    const second = wordDeltaOf(tokenize('the dog'), new Map())

    expect(first.get('the')).toEqual({ exposures: 1, errors: 0 })
    expect(second.get('the')).toEqual({ exposures: 1, errors: 0 })
    expect(second.has('cat')).toBe(false)
  })

  it("so'zsiz gap bo'sh xarita beradi", () => {
    expect(wordDeltaOf(tokenize('... 42 !'), new Map()).size).toBe(0)
    expect(wordDeltaOf([], new Map()).size).toBe(0)
  })
})

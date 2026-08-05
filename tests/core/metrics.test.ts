import { describe, expect, it } from 'vitest'
import { accuracyOf, computeMetrics, netWpm, rawWpm } from '../../src/core/metrics.ts'
import { createState, reduce } from '../../src/core/typing.ts'
import { IDLE_PAUSE_MS } from '../../src/core/types.ts'
import type { TypingState } from '../../src/core/types.ts'

/** Test uchun minimal holat; faqat kerakli maydonlar ustiga yoziladi. */
function makeState(over: Partial<TypingState> = {}): TypingState {
  return {
    target: '',
    tokens: [],
    cursor: 0,
    typed: [],
    errorCounts: new Map(),
    charErrors: new Map(),
    pendingWords: new Set(),
    playedWords: new Set(),
    keystrokes: 0,
    correctKeystrokes: 0,
    startedAt: null,
    lastKeyAt: null,
    activeMs: 0,
    finishedAt: null,
    ...over,
  }
}

describe('netWpm', () => {
  it("250 to'g'ri belgi / 60000 ms -> aynan 50 WPM", () => {
    expect(netWpm(250, 60_000)).toBe(50)
  })

  it("yarim daqiqada yarim belgi -> o'sha 50 WPM", () => {
    expect(netWpm(125, 30_000)).toBe(50)
  })

  it('60 belgi / 60000 ms -> 12 WPM', () => {
    expect(netWpm(60, 60_000)).toBe(12)
  })

  it('10 daqiqada 4000 belgi -> 80 WPM', () => {
    expect(netWpm(4000, 600_000)).toBe(80)
  })

  it('activeMs === 0 -> 0 (Infinity emas)', () => {
    const value = netWpm(250, 0)
    expect(value).toBe(0)
    expect(Number.isFinite(value)).toBe(true)
  })

  it('belgi ham, vaqt ham 0 -> 0 (NaN emas)', () => {
    const value = netWpm(0, 0)
    expect(value).toBe(0)
    expect(Number.isNaN(value)).toBe(false)
  })

  it('0 belgi, lekin vaqt bor -> 0', () => {
    expect(netWpm(0, 60_000)).toBe(0)
  })

  it('yaroqsiz kirish (NaN, manfiy) cheklangan songa keltiriladi', () => {
    expect(netWpm(Number.NaN, 60_000)).toBe(0)
    expect(netWpm(250, Number.NaN)).toBe(0)
    expect(netWpm(-250, 60_000)).toBe(0)
    expect(netWpm(250, -60_000)).toBe(0)
    expect(netWpm(250, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('rawWpm', () => {
  it('300 bosish / 60000 ms -> aynan 60 WPM', () => {
    expect(rawWpm(300, 60_000)).toBe(60)
  })

  it('150 bosish / 30000 ms -> 60 WPM', () => {
    expect(rawWpm(150, 30_000)).toBe(60)
  })

  it('activeMs === 0 -> 0', () => {
    expect(rawWpm(300, 0)).toBe(0)
  })

  it('0 bosish -> 0', () => {
    expect(rawWpm(0, 60_000)).toBe(0)
  })

  it("raw net dan kichik bo'lmaydi: xato bosishlar ham sanaladi", () => {
    // 250 to'g'ri belgi, 300 jami bosish, bir xil vaqt
    expect(rawWpm(300, 60_000)).toBeGreaterThan(netWpm(250, 60_000))
  })
})

describe('accuracyOf', () => {
  it("hammasi to'g'ri -> 1", () => {
    expect(accuracyOf(10, 10)).toBe(1)
  })

  it('hammasi xato -> 0', () => {
    expect(accuracyOf(0, 10)).toBe(0)
  })

  it('hech narsa bosilmagan -> 1', () => {
    expect(accuracyOf(0, 0)).toBe(1)
  })

  it('3/4 -> 0.75', () => {
    expect(accuracyOf(3, 4)).toBe(0.75)
  })

  it('90/120 -> 0.75', () => {
    expect(accuracyOf(90, 120)).toBe(0.75)
  })

  it('7/10 -> 0.7', () => {
    expect(accuracyOf(7, 10)).toBe(0.7)
  })

  it("to'g'ri soni jamidan oshsa ham 1 dan katta bo'lmaydi", () => {
    expect(accuracyOf(12, 10)).toBe(1)
  })

  it("yaroqsiz kirish 0..1 oralig'ida qoladi", () => {
    expect(accuracyOf(Number.NaN, 10)).toBe(0)
    expect(accuracyOf(-5, 10)).toBe(0)
    expect(accuracyOf(5, Number.NaN)).toBe(1)
  })
})

describe('computeMetrics', () => {
  it("qo'lda hisoblangan qiymatlarga aynan teng", () => {
    // 250 ta to'g'ri belgi ekranga chiqqan, jami 260 bosish, 10 tasi xato, 1 daqiqa faol vaqt.
    const s = makeState({
      typed: Array.from({ length: 250 }, () => 'a'),
      cursor: 250,
      keystrokes: 260,
      correctKeystrokes: 250,
      activeMs: 60_000,
    })

    const m = computeMetrics(s)

    expect(m.activeMs).toBe(60_000)
    expect(m.netWpm).toBe(50) // (250 / 5) / 1 daqiqa
    expect(m.rawWpm).toBe(52) // (260 / 5) / 1 daqiqa
    expect(m.accuracy).toBe(250 / 260)
    expect(m.keystrokes).toBe(260)
    expect(m.correctKeystrokes).toBe(250)
    expect(m.errors).toBe(10)
  })

  it('errors = keystrokes - correctKeystrokes', () => {
    const m = computeMetrics(makeState({ keystrokes: 41, correctKeystrokes: 37, activeMs: 10_000 }))
    expect(m.errors).toBe(4)
  })

  it("bo'sh holat: hammasi 0, aniqlik 1, hech biri NaN emas", () => {
    const m = computeMetrics(makeState())

    expect(m.activeMs).toBe(0)
    expect(m.netWpm).toBe(0)
    expect(m.rawWpm).toBe(0)
    expect(m.accuracy).toBe(1)
    expect(m.keystrokes).toBe(0)
    expect(m.correctKeystrokes).toBe(0)
    expect(m.errors).toBe(0)

    for (const value of Object.values(m)) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })

  it('bosishlar bor, lekin activeMs = 0 -> WPM 0, aniqlik esa hisoblanadi', () => {
    const m = computeMetrics(
      makeState({
        typed: ['a', 'b', 'c'],
        cursor: 3,
        keystrokes: 4,
        correctKeystrokes: 3,
        activeMs: 0,
      }),
    )

    expect(m.netWpm).toBe(0)
    expect(m.rawWpm).toBe(0)
    expect(m.accuracy).toBe(0.75)
    expect(Number.isFinite(m.netWpm)).toBe(true)
    expect(Number.isFinite(m.rawWpm)).toBe(true)
  })

  it("hamma bosish xato bo'lsa aniqlik 0, net WPM 0", () => {
    const m = computeMetrics(makeState({ keystrokes: 8, correctKeystrokes: 0, activeMs: 60_000 }))

    expect(m.accuracy).toBe(0)
    expect(m.netWpm).toBe(0)
    expect(m.rawWpm).toBe(1.6) // (8 / 5) / 1 daqiqa
    expect(m.errors).toBe(8)
  })

  it("hamma bosish to'g'ri bo'lsa aniqlik 1 va net === raw", () => {
    const m = computeMetrics(
      makeState({
        typed: Array.from({ length: 100 }, () => 'x'),
        cursor: 100,
        keystrokes: 100,
        correctKeystrokes: 100,
        activeMs: 60_000,
      }),
    )

    expect(m.accuracy).toBe(1)
    expect(m.errors).toBe(0)
    expect(m.netWpm).toBe(20)
    expect(m.netWpm).toBe(m.rawWpm)
  })

  it('buzuq holat (manfiy/NaN) ham cheklangan son beradi', () => {
    const m = computeMetrics(
      makeState({
        keystrokes: 10,
        correctKeystrokes: 99, // jamidan katta — cheklanadi
        activeMs: Number.NaN,
      }),
    )

    expect(m.correctKeystrokes).toBe(10)
    expect(m.errors).toBe(0)
    expect(m.activeMs).toBe(0)
    expect(m.netWpm).toBe(0)
    expect(m.rawWpm).toBe(0)
    expect(m.accuracy).toBe(1)
  })

  it('netWpm state.typed.length ga tayanadi, correctKeystrokes ga emas', () => {
    // Backspace + qayta yozish: `typed` da 50 belgi, lekin to'g'ri bosish 60 ta.
    const m = computeMetrics(
      makeState({
        typed: Array.from({ length: 50 }, () => 'z'),
        cursor: 50,
        keystrokes: 70,
        correctKeystrokes: 60,
        activeMs: 60_000,
      }),
    )

    expect(m.netWpm).toBe(10) // (50 / 5) / 1 daqiqa
    expect(m.rawWpm).toBe(14) // (70 / 5) / 1 daqiqa
  })
})

// ---------------------------------------------------------------------------
// Integratsiya: haqiqiy reducer bilan birga (PLAN §6 — taymer pauzasi)
// ---------------------------------------------------------------------------

/** Bitta bosish: qaysi belgi va qaysi vaqtda (ms). */
type Press = { at: number; char: string }

/** Ketma-ket bosishlarni haqiqiy `reduce` orqali o'tkazadi. */
function typeAll(target: string, presses: Press[]): TypingState {
  let state = createState(target)
  for (const p of presses) {
    state = reduce(state, { type: 'char', char: p.char }, p.at).state
  }
  return state
}

describe('computeMetrics + typing reducer', () => {
  it("5 s dan uzun tanaffus activeMs ga QO'SHILMAYDI", () => {
    // "the cat": 3 belgi -> bitta xato -> tuzatish -> 40 s tanaffus -> qolgani.
    const s = typeAll('the cat', [
      { at: 1_000, char: 't' }, // birinchi bosish: taymer shu yerda boshlanadi
      { at: 1_100, char: 'h' }, // +100
      { at: 1_200, char: 'q' }, // +100, XATO: kursor siljimaydi
      { at: 1_300, char: 'e' }, // +100
      { at: 1_400, char: ' ' }, // +100
      { at: 41_400, char: 'c' }, // +40000 -> PAUZA, qo'shilmaydi
      { at: 41_500, char: 'a' }, // +100
      { at: 41_600, char: 't' }, // +100 -> gap tugadi
    ])

    // Devor soati bo'yicha 40600 ms o'tgan, lekin faol vaqt atigi 600 ms.
    expect(s.finishedAt).toBe(41_600)
    expect(s.startedAt).toBe(1_000)
    expect(s.activeMs).toBe(600)

    const m = computeMetrics(s)

    expect(m.activeMs).toBe(600)
    expect(m.netWpm).toBe(140) // (7 / 5) / (600 ms)
    expect(m.rawWpm).toBe(160) // (8 / 5) / (600 ms)
    expect(m.accuracy).toBe(0.875) // 7 / 8
    expect(m.keystrokes).toBe(8)
    expect(m.correctKeystrokes).toBe(7)
    expect(m.errors).toBe(1)

    // Tanaffus chiqarilmaganda WPM keskin past chiqardi — farq shu yerda ko'rinadi.
    const wallClockMs = 41_600 - 1_000
    expect(m.netWpm).toBeGreaterThan(netWpm(7, wallClockMs))
  })

  it("aynan IDLE_PAUSE_MS lik tanaffus hali ham hisoblanadi, undan uzuni yo'q", () => {
    const onTheEdge = typeAll('ab', [
      { at: 0, char: 'a' },
      { at: IDLE_PAUSE_MS, char: 'b' },
    ])
    expect(computeMetrics(onTheEdge).activeMs).toBe(IDLE_PAUSE_MS)

    const overTheEdge = typeAll('ab', [
      { at: 0, char: 'a' },
      { at: IDLE_PAUSE_MS + 1, char: 'b' },
    ])
    expect(computeMetrics(overTheEdge).activeMs).toBe(0)
  })

  it("ketma-ket bir nechta uzun tanaffus ham to'planmaydi", () => {
    const s = typeAll('abcd', [
      { at: 0, char: 'a' },
      { at: 10_000, char: 'b' }, // pauza
      { at: 10_250, char: 'c' }, // +250
      { at: 90_000, char: 'd' }, // pauza
    ])

    const m = computeMetrics(s)
    expect(m.activeMs).toBe(250)
    expect(m.netWpm).toBe(192) // (4 / 5) / (250 ms) = 0.8 * 240
    expect(m.accuracy).toBe(1)
  })

  it("boshlanmagan gap: hech qanday bosish yo'q -> hammasi 0, aniqlik 1", () => {
    const m = computeMetrics(createState('the cat'))

    expect(m.activeMs).toBe(0)
    expect(m.netWpm).toBe(0)
    expect(m.rawWpm).toBe(0)
    expect(m.accuracy).toBe(1)
    expect(m.keystrokes).toBe(0)
    expect(m.errors).toBe(0)
  })

  it("birinchi bosishdan keyin ham activeMs 0 — WPM Infinity bo'lib ketmaydi", () => {
    const s = typeAll('the cat', [{ at: 7_000, char: 't' }])
    const m = computeMetrics(s)

    expect(s.startedAt).toBe(7_000)
    expect(m.activeMs).toBe(0)
    expect(m.netWpm).toBe(0)
    expect(m.rawWpm).toBe(0)
    expect(Number.isFinite(m.netWpm)).toBe(true)
    expect(Number.isFinite(m.rawWpm)).toBe(true)
  })

  it("backspace bilan tuzatilgan so'z: net WPM ekrandagi belgilarga qarab hisoblanadi", () => {
    let s = createState('the cat')
    s = reduce(s, { type: 'char', char: 't' }, 0).state
    s = reduce(s, { type: 'char', char: 'h' }, 100).state
    s = reduce(s, { type: 'backspace' }, 200).state // `h` o'chdi, keystrokes oshmaydi
    s = reduce(s, { type: 'char', char: 'h' }, 300).state // qayta yozildi

    const m = computeMetrics(s)

    expect(s.typed.join('')).toBe('th')
    expect(m.activeMs).toBe(300)
    expect(m.keystrokes).toBe(3)
    expect(m.correctKeystrokes).toBe(3)
    expect(m.accuracy).toBe(1)
    expect(m.errors).toBe(0)
    expect(m.netWpm).toBe(80) // (2 / 5) / (300 ms), 3 ta to'g'ri bosishga qarab emas
  })
})

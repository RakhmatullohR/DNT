// `src/store/stats.ts` testlari (PLAN §6 va §10).
//
// `core` loyihasi NODE muhitida ishlaydi — u yerda `localStorage` yo'q, modul esa
// bunday holatda bo'sh statistika qaytarib, hech narsa yozmaydi. Shuning uchun har
// bir testdan oldin xotiradagi minimal `Storage` o'rnatiladi va keyin olib tashlanadi.
//
// Soat ham qotiriladi: `streakDays`, `dailySeries` va kunlik yig'indi "bugun"
// tushunchasiga tayanadi — haqiqiy soat bilan test yarim tunda beqaror bo'lardi.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearStats,
  corruptStatsBackup,
  dailySeries,
  discardCorruptStatsBackup,
  exportJson,
  getSession,
  hardestWords,
  importJson,
  loadStats,
  recordSession,
  streakDays,
  totals,
} from '../../src/store/stats.ts'
import type { DayStat, SentenceRecord, SessionRecord, StatsData, WordStat } from '../../src/store/stats.ts'

/** Modul ichidagi kalitning nusxasi — buzuq satr o'chirilmasligini tekshirish uchun kerak. */
const STATS_KEY = 'dnt.stats.v1'

/** Buzuq payload zaxirasi saqlanadigan kalit (PLAN §10). */
const STATS_CORRUPT_KEY = 'dnt.stats.v1.corrupt'

/** Testlarda takrorlanadigan, o'qib bo'lmaydigan satr. */
const CORRUPT = 'bu umuman JSON emas {{{'

/** Xotiradagi `Storage`: modul faqat shu uchta metodni ishlatadi, qolgani realizm uchun. */
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
      // Haqiqiy `localStorage` yo'q kalit uchun `undefined` emas, `null` qaytaradi.
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

/**
 * Bitta kalitga yozishni rad etadigan ombor: kvota to'lgan yoki yozish
 * taqiqlangan holatni aynan zaxira kalitida modellashtiradi.
 */
function createStorageRejecting(rejectedKey: string): Storage {
  const base = createMemoryStorage()
  return {
    get length(): number {
      return base.length
    },
    key(index: number): string | null {
      return base.key(index)
    },
    getItem(key: string): string | null {
      return base.getItem(key)
    },
    setItem(key: string, value: string): void {
      if (key === rejectedKey) throw new Error('QuotaExceededError')
      base.setItem(key, value)
    },
    removeItem(key: string): void {
      base.removeItem(key)
    },
    clear(): void {
      base.clear()
    },
  }
}

/**
 * `dnt.stats.v1` ga BIRINCHI yozishni rad etadigan, keyingilarini qabul
 * qiladigan ombor. `writeStats` ning kvota yo'li aynan shunda ochiladi:
 * to'liq hujjat sig'maydi, qisqartirilgani esa o'tadi.
 *
 * Boshlang'ich qiymat rad etishga sarflanmasligi uchun ichki omborga
 * to'g'ridan-to'g'ri yoziladi.
 */
function createStorageRejectingFirstStatsWrite(seed: string): Storage {
  const base = createMemoryStorage()
  base.setItem(STATS_KEY, seed)
  let armed = true
  return {
    get length(): number {
      return base.length
    },
    key(index: number): string | null {
      return base.key(index)
    },
    getItem(key: string): string | null {
      return base.getItem(key)
    },
    setItem(key: string, value: string): void {
      if (key === STATS_KEY && armed) {
        armed = false
        throw new Error('QuotaExceededError')
      }
      base.setItem(key, value)
    },
    removeItem(key: string): void {
      base.removeItem(key)
    },
    clear(): void {
      base.clear()
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
  vi.useFakeTimers()
  // Lokal (UTC emas) tush payti: kun kaliti qaysi mintaqada ham surilib ketmasin.
  vi.setSystemTime(new Date(2026, 2, 15, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Yordamchilar
// ---------------------------------------------------------------------------

/** Bugundan `offset` kun oldingi 'YYYY-MM-DD'. Kun `setDate` bilan suriladi — DST ga chidamli. */
function dayKey(offset: number): string {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - offset)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Bugundan `offset` kun oldingi lokal `hour` soati (ms). */
function timeAt(offset: number, hour: number): number {
  const date = new Date()
  date.setHours(hour, 0, 0, 0)
  date.setDate(date.getDate() - offset)
  return date.getTime()
}

function makeSentence(over: Partial<SentenceRecord> = {}): SentenceRecord {
  return {
    lessonId: 'l1',
    sentenceIndex: 0,
    at: timeAt(0, 9),
    activeMs: 60_000,
    keystrokes: 120,
    correctKeystrokes: 120,
    netWpm: 24, // (120 / 5) / 1 daqiqa
    rawWpm: 24,
    accuracy: 1,
    restarts: 0,
    skipped: false,
    ...over,
  }
}

/** Yig'indi maydonlari ATAYIN nol: `recordSession` ularni gaplardan qayta hisoblaydi. */
function makeSession(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's-1',
    lessonId: 'l1',
    lessonTitle: 'Sinov darsi',
    startedAt: timeAt(0, 9),
    endedAt: timeAt(0, 10),
    sentences: [],
    activeMs: 0,
    keystrokes: 0,
    correctKeystrokes: 0,
    netWpm: 0,
    rawWpm: 0,
    accuracy: 0,
    ...over,
  }
}

function dayStat(correctKeystrokes: number): DayStat {
  return { correctKeystrokes, activeMs: 60_000, sentences: 1 }
}

/** `[bugundan necha kun oldin, to'g'ri bosishlar]` juftliklaridan kunlik jadval. */
function daysFrom(entries: Array<[number, number]>): Record<string, DayStat> {
  const days: Record<string, DayStat> = {}
  for (const [offset, correct] of entries) {
    days[dayKey(offset)] = dayStat(correct)
  }
  return days
}

/** Omborni to'ldirish `importJson` orqali — u tekshirilgan yagona yozish yo'li. */
function seedStats(over: Partial<Omit<StatsData, 'version'>>): StatsData {
  const data: StatsData = { version: 1, sessions: [], words: {}, days: {}, ...over }
  expect(importJson(JSON.stringify(data))).toEqual({ ok: true })
  return loadStats()
}

/** Rad etilishi kutilgan import: xato qaytadi VA ombor bir zarra ham o'zgarmaydi. */
function expectRejected(raw: string, before: StatsData): void {
  const result = importJson(raw)
  if (result.ok) {
    throw new Error(`Import kutilmaganda muvaffaqiyatli bo'ldi: ${raw}`)
  }
  expect(result.error.length).toBeGreaterThan(0)
  expect(loadStats()).toEqual(before)
}

/** Ikki gapli seans: 120 + 45 to'g'ri bosish, 90 s faol vaqt. Barcha kutilgan son butun chiqadi. */
function recordTwoSentenceSession(wordDelta: Record<string, WordStat> = {}): void {
  recordSession(
    makeSession({
      sentences: [
        makeSentence({ sentenceIndex: 0, at: timeAt(0, 9) }),
        makeSentence({
          sentenceIndex: 1,
          at: timeAt(0, 9),
          activeMs: 30_000,
          keystrokes: 60,
          correctKeystrokes: 45,
          netWpm: 18, // (45 / 5) / 0.5 daqiqa
          rawWpm: 24, // (60 / 5) / 0.5 daqiqa
          accuracy: 0.75,
        }),
      ],
    }),
    wordDelta,
  )
}

// ---------------------------------------------------------------------------
// Bo'sh ombor va buzuq saqlangan satr
// ---------------------------------------------------------------------------

describe('loadStats', () => {
  it("bo'sh omborda to'liq bo'sh, lekin haqiqiy tuzilma qaytaradi", () => {
    expect(loadStats()).toEqual({ version: 1, sessions: [], words: {}, days: {} })
  })

  it("buzuq JSON bo'sh statistika beradi, lekin saqlangan satrni O'CHIRMAYDI", () => {
    localStorage.setItem(STATS_KEY, CORRUPT)

    expect(loadStats()).toEqual({ version: 1, sessions: [], words: {}, days: {} })
    // Qo'lda tiklash imkoni qolishi kerak — shuning uchun satr joyida turadi.
    expect(localStorage.getItem(STATS_KEY)).toBe(CORRUPT)
  })

  it("tanib bo'lmaydigan YAKKA yozuv tashlanadi, qolgan tarix saqlanadi", () => {
    localStorage.setItem(
      STATS_KEY,
      JSON.stringify({
        version: 1,
        sessions: [makeSession({ id: 'yaxshi' }), { id: '' }, 42, null],
        words: { the: { exposures: 10, errors: 2 }, '': { exposures: 5, errors: 5 } },
        days: { [dayKey(0)]: dayStat(150), 'kecha': dayStat(150) },
      }),
    )

    const data = loadStats()
    expect(data.sessions.map((s) => s.id)).toEqual(['yaxshi'])
    expect(Object.keys(data.words)).toEqual(['the'])
    expect(Object.keys(data.days)).toEqual([dayKey(0)])
  })
})

// ---------------------------------------------------------------------------
// Buzuq payload zaxirasi (PLAN §10): "qo'lda tiklash mumkin" va'dasi
// ---------------------------------------------------------------------------

describe('buzuq payload zaxirasi', () => {
  it("toza omborda zaxira yo'q", () => {
    recordTwoSentenceSession()

    // Sog'lom payloadni qayta o'qish ham zaxira YARATMASLIGI kerak: aks holda
    // buzuq nusxa borligi haqidagi xabar doim yonib turardi.
    expect(loadStats().sessions).toHaveLength(1)
    expect(corruptStatsBackup()).toBeNull()
  })

  it("keyingi yozuv asosiy kalitni bosadi, zaxira esa ASL satrni ushlab qoladi", () => {
    localStorage.setItem(STATS_KEY, CORRUPT)

    recordTwoSentenceSession()

    // `recordSession` butun hujjatni qayta yozadi — asosiy kalitda satr qolmaydi...
    expect(localStorage.getItem(STATS_KEY)).not.toContain('bu umuman JSON emas')
    // ...lekin tiklash va'dasi endi haqiqiy: nusxa alohida kalitda tirik.
    expect(corruptStatsBackup()).toBe(CORRUPT)
    expect(totals().sessions).toBe(1)
  })

  it("shakli yaroqsiz, lekin to'g'ri JSON ham zaxiralanadi", () => {
    // Kelajakdagi versiya: o'qib bo'lmaydi, ya'ni keyingi yozuv uni yo'q qiladi.
    const future = '{"version": 2, "sessions": [], "words": {}, "days": {}}'
    localStorage.setItem(STATS_KEY, future)

    recordTwoSentenceSession()

    expect(corruptStatsBackup()).toBe(future)
  })

  it("teng uzunlikdagi ikkinchi buzilish zaxirani almashtirmaydi", () => {
    const first = 'birinchi buzilish {{{'
    const second = 'ikkinchi buzilish }}}'
    // Qoida uzunlikka tayanadi, shuning uchun tenglikning O'ZI shart bo'lib qoladi.
    expect(second.length).toBe(first.length)

    localStorage.setItem(STATS_KEY, first)
    expect(loadStats().sessions).toEqual([])

    localStorage.setItem(STATS_KEY, second)
    expect(loadStats().sessions).toEqual([])

    // Teng bo'lganda almashtirishning foydasi yo'q — mavjudi o'z o'rnida qoladi.
    expect(corruptStatsBackup()).toBe(first)
  })

  it("40 seansli zaxira, ombor sog'ayib qayta buzilsa ham, KICHIK yangisiga almashmaydi", () => {
    // Real yo'l: uzoq tarix yig'iladi, so'ng hujjat kesiladi.
    for (let i = 0; i < 40; i++) {
      recordSession(makeSession({ id: `s-${i}`, sentences: [makeSentence()] }), {})
    }
    const full = localStorage.getItem(STATS_KEY) ?? ''
    const bigCorrupt = full.slice(0, full.length - 1)
    localStorage.setItem(STATS_KEY, bigCorrupt)

    expect(loadStats().sessions).toEqual([])
    expect(corruptStatsBackup()).toBe(bigCorrupt)

    // Foydalanuvchi BITTA yangi gap yozadi: ombor sog'ayadi, lekin asosiy
    // kalitda endi o'sha yakka seansdan boshqa hech narsa yo'q.
    recordSession(makeSession({ id: 'yangi', sentences: [makeSentence()] }), {})
    expect(totals().sessions).toBe(1)

    // Va hujjat yana buziladi.
    const healed = localStorage.getItem(STATS_KEY) ?? ''
    const smallCorrupt = healed.slice(0, healed.length - 1)
    localStorage.setItem(STATS_KEY, smallCorrupt)
    expect(loadStats().sessions).toEqual([])

    // Qoida: uzuni qoladi. Bitta seansli satr uchun 40 seansli satrni
    // almashtirish qo'lda tiklanadigan matnni yo'q qilish bo'lardi.
    expect(smallCorrupt.length).toBeLessThan(bigCorrupt.length)
    expect(corruptStatsBackup()).toBe(bigCorrupt)
    expect(corruptStatsBackup()).toContain('s-39')
  })

  it("KICHIK zaxira UZUNROQ yangi buzilish bilan ALMASHTIRILADI", () => {
    // Teskari tartib: birinchi buzilish qiymatsiz bir belgili satr.
    localStorage.setItem(STATS_KEY, 'x')
    expect(loadStats().sessions).toEqual([])
    expect(corruptStatsBackup()).toBe('x')

    for (let i = 0; i < 5; i++) {
      recordSession(makeSession({ id: `s-${i}`, sentences: [makeSentence()] }), {})
    }
    expect(totals().sessions).toBe(5)

    const healthy = localStorage.getItem(STATS_KEY) ?? ''
    const truncated = healthy.slice(0, healthy.length - 1)
    localStorage.setItem(STATS_KEY, truncated)
    expect(loadStats().sessions).toEqual([])

    // Yangi satr uzunroq: ichida 5 ta seans bor, 'x' da esa hech narsa.
    expect(truncated.length).toBeGreaterThan('x'.length)
    expect(corruptStatsBackup()).toBe(truncated)
    expect(corruptStatsBackup()).toContain('s-0')
  })

  it("`importJson` yozgan hujjatning buzilishi ham uzunligi bo'yicha baholanadi", () => {
    localStorage.setItem(STATS_KEY, 'x')
    const file = JSON.stringify({ version: 1, sessions: [], words: {}, days: daysFrom([[0, 150]]) })

    expect(importJson(file)).toEqual({ ok: true })
    expect(corruptStatsBackup()).toBe('x')

    const truncated = file.slice(0, 30)
    localStorage.setItem(STATS_KEY, truncated)
    expect(loadStats().days).toEqual({})

    // 30 belgi bitta belgidan uzun — import tiklagan kunlik jadvalning qoldig'i
    // 'x' ning o'rnini egallaydi.
    expect(truncated.length).toBeGreaterThan('x'.length)
    expect(corruptStatsBackup()).toBe(truncated)
  })

  it("`importJson` ustiga yozishdan OLDIN zaxira oladi", () => {
    localStorage.setItem(STATS_KEY, CORRUPT)
    const backup = JSON.stringify({ version: 1, sessions: [], words: {}, days: daysFrom([[0, 150]]) })

    expect(importJson(backup)).toEqual({ ok: true })

    // Import ham buzuq satrni yo'q qiladigan yozuv — u ham zaxirasiz qolmaydi.
    expect(corruptStatsBackup()).toBe(CORRUPT)
    expect(streakDays()).toBe(1)
  })

  it("zaxira yozib bo'lmasa ham seans SAQLANADI", () => {
    vi.stubGlobal('localStorage', createStorageRejecting(STATS_CORRUPT_KEY))
    localStorage.setItem(STATS_KEY, CORRUPT)

    expect(() => recordTwoSentenceSession()).not.toThrow()

    expect(totals().sessions).toBe(1)
    expect(corruptStatsBackup()).toBeNull()
  })

  it("`discardCorruptStatsBackup` faqat zaxirani o'chiradi", () => {
    localStorage.setItem(STATS_KEY, CORRUPT)
    recordTwoSentenceSession()
    expect(corruptStatsBackup()).toBe(CORRUPT)

    discardCorruptStatsBackup()

    expect(corruptStatsBackup()).toBeNull()
    expect(totals().sessions).toBe(1)
  })

  it("`clearStats` zaxirani ham o'chiradi — \"hammasini o'chir\" degani shu", () => {
    localStorage.setItem(STATS_KEY, CORRUPT)
    recordTwoSentenceSession()
    expect(corruptStatsBackup()).toBe(CORRUPT)

    clearStats()

    expect(corruptStatsBackup()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tanib bo'lmaydigan YAKKA seans yozuvi diskda saqlanib qoladi
// ---------------------------------------------------------------------------

describe("buzuq seans yozuvi", () => {
  /** Belgisi bo'yicha izlanadigan, parser tanimaydigan seans yozuvi. */
  const BROKEN = { id: '', marker: 'buzuq-seans' }

  function seedRawSessions(sessions: unknown[]): void {
    localStorage.setItem(STATS_KEY, JSON.stringify({ version: 1, sessions, words: {}, days: {} }))
  }

  it("keyingi yozuvdan keyin ham omborda qoladi, lekin hujjatga CHIQMAYDI", () => {
    seedRawSessions([BROKEN, makeSession({ id: 'yaxshi' })])
    expect(loadStats().sessions.map((s) => s.id)).toEqual(['yaxshi'])

    recordTwoSentenceSession()

    // Diskda saqlanib qoladi: aks holda "bitta buzuq yozuv yillik tarixni
    // yo'q qilmaydi" va'dasi faqat o'qish paytida to'g'ri bo'lardi.
    expect(localStorage.getItem(STATS_KEY)).toContain('buzuq-seans')
    // Parser kafolati kuchsizlanmaydi — buzuq yozuv chaqiruvchiga yetib bormaydi.
    expect(loadStats().sessions.map((s) => s.id)).toEqual(['yaxshi', 's-1'])
    expect(totals().sessions).toBe(2)
  })

  it("ko'p yozuvdan keyin ham AYNAN BITTA nusxada qoladi", () => {
    seedRawSessions([BROKEN, makeSession({ id: 'yaxshi' })])

    recordTwoSentenceSession()
    recordSession(makeSession({ id: 's-2' }), {})

    const stored = localStorage.getItem(STATS_KEY) ?? ''
    expect(stored.split('buzuq-seans').length - 1).toBe(1)
    expect(totals().sessions).toBe(3)
  })

  it("`importJson` uni QAYTA TIKLAMAYDI — bu ataylab to'liq almashtirish", () => {
    const file = JSON.stringify({ version: 1, sessions: [BROKEN], words: {}, days: {} })

    expect(importJson(file)).toEqual({ ok: true })

    // Tekshiruvdan o'tmagan yozuvni "tiklandi" deb yozib qo'yish tiklashning
    // ma'nosini buzardi (§ `importJson` izohi).
    expect(localStorage.getItem(STATS_KEY)).not.toContain('buzuq-seans')
    expect(loadStats().sessions).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Kvota siqilganda qisqartirib qayta yozish (`writeStats` ning ikkinchi urinishi)
// ---------------------------------------------------------------------------

describe('kvota siqilganda qisqartirish', () => {
  /** Parser tanimaydigan, saqlangan satrda belgisi bo'yicha izlanadigan yozuvlar. */
  const JUNK_A = { id: '', marker: 'axlat-a' }
  const JUNK_B = { id: '', marker: 'axlat-b' }

  function rawDoc(sessions: unknown[]): string {
    return JSON.stringify({ version: 1, sessions, words: {}, days: {} })
  }

  it("avval TANIB BO'LMAYDIGAN yozuvlarni qurbon qiladi, mashq tarixini emas", () => {
    vi.stubGlobal(
      'localStorage',
      createStorageRejectingFirstStatsWrite(
        rawDoc([JUNK_A, JUNK_B, makeSession({ id: 'eski-1' }), makeSession({ id: 'eski-2' })]),
      ),
    )

    recordSession(makeSession({ id: 'yangi', sentences: [makeSentence()] }), {})

    // Beshta yozuvning yarmi (2 ta) kesildi. Axlat massiv BOSHIDA turgani
    // uchun aynan o'sha ikkitasi ketdi.
    const stored = localStorage.getItem(STATS_KEY) ?? ''
    expect(stored).not.toContain('axlat-a')
    expect(stored).not.toContain('axlat-b')
    // Uchala haqiqiy seans esa joyida.
    expect(loadStats().sessions.map((s) => s.id)).toEqual(['eski-1', 'eski-2', 'yangi'])
    expect(totals().sessions).toBe(3)
  })

  it("seanslarning ENG YANGI yarmini qoldiradi", () => {
    vi.stubGlobal(
      'localStorage',
      createStorageRejectingFirstStatsWrite(
        rawDoc([
          makeSession({ id: 'eng-eski' }),
          makeSession({ id: 'eski' }),
          makeSession({ id: "o'rta" }),
          makeSession({ id: 'yaqin' }),
        ]),
      ),
    )

    recordSession(makeSession({ id: 'yangi', sentences: [makeSentence()] }), {})

    // Bu yerda axlat yo'q, ya'ni kesish faqat tartibga bog'liq: beshtadan
    // eng ESKI ikkitasi ketadi, oxirgi uchtasi qoladi.
    expect(loadStats().sessions.map((s) => s.id)).toEqual(["o'rta", 'yaqin', 'yangi'])
  })

  it("qisqartirilgan yozuv ham sig'masa yiqilmaydi", () => {
    vi.stubGlobal('localStorage', createStorageRejecting(STATS_KEY))

    expect(() => recordTwoSentenceSession()).not.toThrow()

    // Hech narsa yozilmadi, lekin mashq to'xtamaydi.
    expect(loadStats().sessions).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Eksport / import — PLAN §10 ning yagona yumshatish vositasi
// ---------------------------------------------------------------------------

describe('exportJson va importJson', () => {
  it("eksport -> import aylanishi DEEP EQUAL: zaxiradan hamma narsa tiklanadi", () => {
    recordTwoSentenceSession({ The: { exposures: 3, errors: 1 }, cat: { exposures: 2, errors: 2 } })
    const before = loadStats()
    const backup = exportJson()

    clearStats()
    expect(loadStats()).toEqual({ version: 1, sessions: [], words: {}, days: {} })

    expect(importJson(backup)).toEqual({ ok: true })
    expect(loadStats()).toEqual(before)
  })

  it("eksport — o'qish mumkin bo'lgan, o'zi ham import qilinadigan JSON", () => {
    recordTwoSentenceSession({ the: { exposures: 3, errors: 1 } })
    const backup = exportJson()

    expect(backup).toContain('\n  "version": 1')
    expect(JSON.parse(backup)).toEqual(loadStats())
  })

  it("import ALMASHTIRADI: bir xil faylni ikki marta yuklash yig'indilarni ikkilantirmaydi", () => {
    recordTwoSentenceSession({ the: { exposures: 3, errors: 1 } })
    const backup = exportJson()
    const once = loadStats()

    expect(importJson(backup)).toEqual({ ok: true })
    expect(importJson(backup)).toEqual({ ok: true })

    // Birlashtirish bo'lganda seans 3 ta, `the` 9 ta ta'sirlanish bo'lib ketardi.
    expect(loadStats()).toEqual(once)
    expect(totals().sessions).toBe(1)
    expect(loadStats().words['the']).toEqual({ exposures: 3, errors: 1 })
    expect(loadStats().days[dayKey(0)]).toEqual({ correctKeystrokes: 165, activeMs: 90_000, sentences: 2 })
  })

  it("mavjud statistika ustiga import — birlashtirilmaydi, butunlay almashtiriladi", () => {
    recordTwoSentenceSession({ the: { exposures: 3, errors: 1 } })
    const backup = exportJson()

    clearStats()
    recordSession(makeSession({ id: 'boshqa' }), { rhythm: { exposures: 8, errors: 6 } })

    expect(importJson(backup)).toEqual({ ok: true })
    const data = loadStats()
    expect(data.sessions.map((s) => s.id)).toEqual(['s-1'])
    expect(Object.keys(data.words)).toEqual(['the'])
  })

  it("JSON bo'lmagan matn rad etiladi, ombor tegilmaydi", () => {
    const before = seedStats({ words: { the: { exposures: 10, errors: 2 } }, days: daysFrom([[0, 150]]) })
    expectRejected("bu fayl umuman JSON emas", before)
    expectRejected('{"version": 1, ', before)
  })

  it("shakli noto'g'ri JSON rad etiladi, ombor tegilmaydi", () => {
    const before = seedStats({ words: { the: { exposures: 10, errors: 2 } }, days: daysFrom([[0, 150]]) })

    expectRejected('[]', before) // massiv — obyekt kutilgan edi
    expectRejected('"salom"', before)
    expectRejected('{"version": 1}', before) // `sessions` yo'q
    expectRejected('{"version": 1, "sessions": {}, "words": {}, "days": {}}', before)
    expectRejected('{"version": 1, "sessions": [], "words": [], "days": {}}', before)
    expectRejected('{"version": 1, "sessions": [], "words": {}, "days": null}', before)
  })

  it("boshqa versiya rad etiladi, ombor tegilmaydi", () => {
    const before = seedStats({ days: daysFrom([[0, 150]]) })

    expectRejected('{"version": 2, "sessions": [], "words": {}, "days": {}}', before)
    expectRejected('{"version": "1", "sessions": [], "words": {}, "days": {}}', before)
    expectRejected('{"sessions": [], "words": {}, "days": {}}', before)
  })

  it("null va bo'sh kirish rad etiladi, ombor tegilmaydi", () => {
    const before = seedStats({ days: daysFrom([[0, 150]]) })

    expectRejected('null', before)
    expectRejected('', before)
    expectRejected('   ', before)
  })
})

// ---------------------------------------------------------------------------
// Eng qiyin so'zlar — nisbat bo'yicha
// ---------------------------------------------------------------------------

describe('hardestWords', () => {
  it("XOM xato soni emas, `errors / exposures` NISBATI bo'yicha tartiblaydi", () => {
    seedStats({
      words: {
        // `the` da xato KO'P (20 > 5), lekin u shunchaki tez-tez uchraydi.
        the: { exposures: 200, errors: 20 },
        thorough: { exposures: 10, errors: 5 },
      },
    })

    const rows = hardestWords()

    expect(rows.map((r) => r.word)).toEqual(['thorough', 'the'])
    expect(rows[0]?.rate).toBe(0.5)
    expect(rows[1]?.rate).toBe(0.1)
    // Xom son bo'yicha tartiblansa ro'yxat boshini `the` egallardi (PLAN §6).
    expect(rows[1]?.errors).toBeGreaterThan(rows[0]?.errors ?? 0)
  })

  it("`minExposures` dan kam uchragan so'z ro'yxatga UMUMAN kirmaydi", () => {
    seedStats({
      words: {
        rhythm: { exposures: 4, errors: 4 }, // nisbat 1.0, lekin ma'lumot yetarli emas
        the: { exposures: 200, errors: 20 },
      },
    })

    expect(hardestWords().map((r) => r.word)).toEqual(['the'])
    // Chegara pasaytirilsa o'sha so'z darhol birinchi o'ringa chiqadi.
    expect(hardestWords(4).map((r) => r.word)).toEqual(['rhythm', 'the'])
  })

  it("bir xil nisbatda ko'proq uchragani oldinda, so'ng alifbo tartibi", () => {
    // Kalitlar ATAYIN alifbo tartibida emas — natija saqlash tartibiga bog'liq bo'lmasin.
    seedStats({
      words: {
        gamma: { exposures: 10, errors: 2 },
        beta: { exposures: 20, errors: 4 },
        alfa: { exposures: 10, errors: 2 },
      },
    })

    expect(hardestWords().map((r) => r.word)).toEqual(['beta', 'alfa', 'gamma'])
  })

  it('natija har chaqiruvda bir xil', () => {
    seedStats({
      words: {
        gamma: { exposures: 10, errors: 2 },
        beta: { exposures: 20, errors: 4 },
        alfa: { exposures: 10, errors: 2 },
        thorough: { exposures: 10, errors: 5 },
      },
    })

    expect(hardestWords()).toEqual(hardestWords())
  })

  it("`limit` ro'yxat uzunligini kesadi, 0 esa bo'sh beradi", () => {
    seedStats({
      words: {
        alfa: { exposures: 10, errors: 5 },
        beta: { exposures: 10, errors: 4 },
        gamma: { exposures: 10, errors: 3 },
      },
    })

    expect(hardestWords(5, 2).map((r) => r.word)).toEqual(['alfa', 'beta'])
    expect(hardestWords(5, 0)).toEqual([])
  })

  it("bo'sh omborda bo'sh ro'yxat", () => {
    expect(hardestWords()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Seriya (streak)
// ---------------------------------------------------------------------------

describe('streakDays', () => {
  it("bo'sh omborda 0", () => {
    expect(streakDays()).toBe(0)
  })

  it('kunlik chegara aynan 100 ta to\'g\'ri bosish', () => {
    seedStats({ days: daysFrom([[0, 100]]) })
    expect(streakDays()).toBe(1)

    seedStats({ days: daysFrom([[0, 99]]) })
    expect(streakDays()).toBe(0)
  })

  it('ketma-ket kunlar bugundan orqaga sanaladi', () => {
    seedStats({ days: daysFrom([[0, 150], [1, 120], [2, 100]]) })
    expect(streakDays()).toBe(3)
  })

  it("chegaraga yetmagan BUGUN seriyani UZMAYDI — kun hali tugamagan", () => {
    seedStats({ days: daysFrom([[0, 40], [1, 120], [2, 150], [3, 110]]) })
    expect(streakDays()).toBe(3)
  })

  it('bugun umuman mashq qilinmagan ham seriya turaveradi', () => {
    seedStats({ days: daysFrom([[1, 120], [2, 150]]) })
    expect(streakDays()).toBe(2)
  })

  it("o'rtadagi bo'shliq seriyani uzadi", () => {
    seedStats({ days: daysFrom([[0, 150], [1, 120], [3, 200], [4, 200]]) })
    // 2-kun yo'q: sanash 0 va 1 dan keyin to'xtaydi, eski kunlar qo'shilmaydi.
    expect(streakDays()).toBe(2)
  })

  it("chegaradan past kun ham bo'shliq kabi uzadi", () => {
    seedStats({ days: daysFrom([[0, 150], [1, 50], [2, 200]]) })
    expect(streakDays()).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Yozish va yig'indilar
// ---------------------------------------------------------------------------

describe('recordSession', () => {
  it("seans yig'indilarini gaplardan qayta hisoblaydi va omborga yozadi", () => {
    recordTwoSentenceSession()

    const sessions = loadStats().sessions
    expect(sessions).toHaveLength(1)
    const session = sessions[0]
    expect(session?.activeMs).toBe(90_000)
    expect(session?.keystrokes).toBe(180)
    expect(session?.correctKeystrokes).toBe(165)
    expect(session?.netWpm).toBe(22) // (24 * 60000 + 18 * 30000) / 90000 — og'irlikli o'rtacha
    expect(session?.rawWpm).toBe(24) // (24 * 60000 + 24 * 30000) / 90000
    expect(session?.accuracy).toBe(165 / 180)
    expect(session?.sentences).toHaveLength(2)
  })

  it("`skipped` gap yig'indiga ham, kunlik jadvalga ham KIRMAYDI", () => {
    recordSession(
      makeSession({
        sentences: [
          makeSentence(),
          makeSentence({
            sentenceIndex: 1,
            skipped: true,
            activeMs: 300_000,
            keystrokes: 900,
            correctKeystrokes: 5,
            netWpm: 2,
            rawWpm: 360,
            accuracy: 0.01,
          }),
        ],
      }),
      {},
    )

    const session = loadStats().sessions[0]
    expect(session?.activeMs).toBe(60_000)
    expect(session?.keystrokes).toBe(120)
    expect(session?.correctKeystrokes).toBe(120)
    expect(session?.netWpm).toBe(24)
    expect(session?.accuracy).toBe(1)
    expect(loadStats().days[dayKey(0)]).toEqual({ correctKeystrokes: 120, activeMs: 60_000, sentences: 1 })
  })

  it("kunlik jadval gapning `at` vaqtidan to'ldiriladi — yarim tunlik seans ikki kunga bo'linadi", () => {
    recordSession(
      makeSession({
        sentences: [
          makeSentence({ at: timeAt(1, 23) }),
          makeSentence({ at: timeAt(0, 0), correctKeystrokes: 90, keystrokes: 90 }),
        ],
      }),
      {},
    )

    const days = loadStats().days
    expect(days[dayKey(1)]).toEqual({ correctKeystrokes: 120, activeMs: 60_000, sentences: 1 })
    expect(days[dayKey(0)]).toEqual({ correctKeystrokes: 90, activeMs: 60_000, sentences: 1 })
  })

  it("gap yozuvisiz seans ham kunlik jadvalga tushadi — seriya bo'shab qolmasin", () => {
    recordSession(
      makeSession({ sentences: [], activeMs: 60_000, keystrokes: 130, correctKeystrokes: 120, netWpm: 24 }),
      {},
    )

    // `sentences` 0 bo'lib qoladi: sanash uchun gap yozuvi yo'q edi.
    expect(loadStats().days[dayKey(0)]).toEqual({ correctKeystrokes: 120, activeMs: 60_000, sentences: 0 })
    expect(streakDays()).toBe(1)
  })

  it("so'zlar seanslar bo'ylab yig'iladi va KICHIK HARFGA keltiriladi", () => {
    recordTwoSentenceSession({ The: { exposures: 3, errors: 1 }, cat: { exposures: 2, errors: 2 } })
    recordSession(makeSession({ id: 's-2' }), { the: { exposures: 2, errors: 0 }, '  ': { exposures: 9, errors: 9 } })

    const words = loadStats().words
    expect(words['the']).toEqual({ exposures: 5, errors: 1 })
    expect(words['cat']).toEqual({ exposures: 2, errors: 2 })
    // Bo'sh (faqat probel) kalit umuman yozilmaydi.
    expect(Object.keys(words).sort()).toEqual(['cat', 'the'])
  })

  it("xatolar ta'sirlanishdan oshib ketmaydi — nisbat hech qachon 1 dan katta emas", () => {
    recordSession(makeSession(), { rhythm: { exposures: 1, errors: 4 } })

    expect(loadStats().words['rhythm']).toEqual({ exposures: 1, errors: 1 })
    expect(hardestWords(1)[0]?.rate).toBe(1)
  })

  it('yozilgan seansni `getSession` id bo\'yicha topadi', () => {
    recordTwoSentenceSession()

    expect(getSession('s-1')?.correctKeystrokes).toBe(165)
    expect(getSession('yoq')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// `recordSession` chegarasi: buzuq seans yig'indini jimgina buzmaydi (PLAN §6)
// ---------------------------------------------------------------------------

describe('recordSession — yaroqsiz seans', () => {
  it("bo'sh `id` li seans YO'QOLMAYDI: id tiklanadi, yig'indi kunlik jadval bilan mos qoladi", () => {
    recordSession(makeSession({ id: '', sentences: [makeSentence()] }), {})

    const sessions = loadStats().sessions
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.id.length).toBeGreaterThan(0)
    expect(sessions[0]?.correctKeystrokes).toBe(120)
    // Avval: kunlik jadvalda gap turar, seans esa keyingi o'qishda yo'qolardi —
    // `totals().sessions` kun jadvali bilan abadiy kelishmay qolardi.
    expect(totals().sessions).toBe(1)
    expect(loadStats().days[dayKey(0)]).toEqual({ correctKeystrokes: 120, activeMs: 60_000, sentences: 1 })
    // Tiklangan id haqiqiy: Natijalar ekrani seansni topa oladi.
    expect(getSession(sessions[0]?.id ?? '')?.correctKeystrokes).toBe(120)
  })

  it("`id` satr bo'lmasa ham seans saqlanib qoladi", () => {
    recordSession(makeSession({ id: 42 as unknown as string, sentences: [makeSentence()] }), {})

    expect(totals().sessions).toBe(1)
    expect(typeof loadStats().sessions[0]?.id).toBe('string')
  })

  it("tiklangan id NOYOB: ikkita bo'sh id li seans bir-birini bosmaydi", () => {
    recordSession(makeSession({ id: '', sentences: [makeSentence()] }), {})
    recordSession(makeSession({ id: '', sentences: [makeSentence()] }), {})

    const ids = loadStats().sessions.map((s) => s.id)
    expect(new Set(ids).size).toBe(2)
    expect(totals().sessions).toBe(2)
    expect(loadStats().days[dayKey(0)]?.sentences).toBe(2)
  })

  it("seans umuman obyekt bo'lmasa HECH NARSA yozilmaydi — yarim yozuv yo'q", () => {
    const delta: Record<string, WordStat> = { the: { exposures: 3, errors: 1 } }

    expect(() => recordSession(null as unknown as SessionRecord, delta)).not.toThrow()
    expect(() => recordSession('salom' as unknown as SessionRecord, delta)).not.toThrow()

    // So'z va kun yig'indilari ham o'smaydi: seanssiz statistika yarim yozuv bo'lardi.
    expect(loadStats()).toEqual({ version: 1, sessions: [], words: {}, days: {} })
    expect(totals().sessions).toBe(0)
  })
})

describe('totals', () => {
  it("bo'sh omborda hammasi 0 (aniqlik ham 0, chalg'ituvchi 100% emas)", () => {
    expect(totals()).toEqual({ sessions: 0, activeMs: 0, netWpm: 0, accuracy: 0 })
  })

  it("bir necha seansni qo'lda hisoblangan qiymatlarga aynan teng yig'adi", () => {
    recordTwoSentenceSession()
    recordSession(
      makeSession({
        id: 's-2',
        sentences: [
          makeSentence({
            at: timeAt(1, 9),
            activeMs: 60_000,
            keystrokes: 60,
            correctKeystrokes: 60,
            netWpm: 12,
            rawWpm: 12,
          }),
        ],
      }),
      {},
    )

    const t = totals()
    expect(t.sessions).toBe(2)
    expect(t.activeMs).toBe(150_000)
    expect(t.netWpm).toBe(18) // (22 * 90000 + 12 * 60000) / 150000 — vaqtga og'irliklangan
    expect(t.accuracy).toBe(225 / 240)
  })
})

describe('dailySeries', () => {
  it("oxirgi N kun eskidan yangiga, bugun doim oxirgi element", () => {
    recordTwoSentenceSession()
    recordSession(
      makeSession({
        id: 's-2',
        sentences: [makeSentence({ at: timeAt(2, 9), keystrokes: 60, correctKeystrokes: 60, netWpm: 12 })],
      }),
      {},
    )

    const series = dailySeries(3)

    expect(series.map((p) => p.day)).toEqual([dayKey(2), dayKey(1), dayKey(0)])
    expect(series[0]).toEqual({ day: dayKey(2), netWpm: 12, correctKeystrokes: 60 })
    // Ma'lumotsiz kun bo'shliq emas, aniq nol bo'lishi kerak (grafik uzilib qolmasin).
    expect(series[1]).toEqual({ day: dayKey(1), netWpm: 0, correctKeystrokes: 0 })
    expect(series[2]).toEqual({ day: dayKey(0), netWpm: 22, correctKeystrokes: 165 })
  })

  it("kunlik netWpm `DayStat` dan hisoblanadi: belgilar / 5 / daqiqa", () => {
    seedStats({ days: { [dayKey(0)]: { correctKeystrokes: 150, activeMs: 60_000, sentences: 2 } } })

    expect(dailySeries(1)).toEqual([{ day: dayKey(0), netWpm: 30, correctKeystrokes: 150 }])
  })

  it("nol yoki manfiy so'rov bo'sh massiv beradi", () => {
    seedStats({ days: daysFrom([[0, 150]]) })

    expect(dailySeries(0)).toEqual([])
    expect(dailySeries(-7)).toEqual([])
  })
})

describe('clearStats', () => {
  it("statistikani butunlay o'chiradi", () => {
    recordTwoSentenceSession({ the: { exposures: 3, errors: 1 } })
    expect(totals().sessions).toBe(1)

    clearStats()

    expect(loadStats()).toEqual({ version: 1, sessions: [], words: {}, days: {} })
    expect(totals().sessions).toBe(0)
    expect(hardestWords()).toEqual([])
    expect(streakDays()).toBe(0)
  })

  it("darslar kalitiga tegmaydi", () => {
    recordTwoSentenceSession()
    localStorage.setItem('dnt.lessons.v1', '[]')

    clearStats()

    expect(localStorage.getItem('dnt.lessons.v1')).toBe('[]')
  })
})

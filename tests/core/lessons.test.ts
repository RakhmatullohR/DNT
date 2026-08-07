// `src/store/lessons.ts` testlari (PLAN §7 va §10).
//
// `core` loyihasi NODE muhitida ishlaydi — u yerda `localStorage` yo'q, modul esa
// bunday holatda bo'sh ro'yxat qaytarib, hech narsa yozmaydi. Shuning uchun har bir
// testdan oldin xotiradagi minimal `Storage` o'rnatiladi va keyin olib tashlanadi.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  completeSentence,
  corruptLessonsBackup,
  deleteLesson,
  discardCorruptLessonsBackup,
  discardUnknownLessons,
  getLesson,
  listLessons,
  newLessonId,
  saveLesson,
  setProgress,
  unknownLessonCount,
} from '../../src/store/lessons.ts'
import type { Lesson } from '../../src/store/lessons.ts'

/** Modul ichidagi kalitning nusxasi — buzuq ma'lumotni qo'lda joylashtirish uchun kerak. */
const LESSONS_KEY = 'dnt.lessons.v1'

/** Buzuq payload zaxirasi saqlanadigan kalit (PLAN §10). */
const LESSONS_CORRUPT_KEY = 'dnt.lessons.v1.corrupt'

/** Testlarda takrorlanadigan, o'qib bo'lmaydigan satr. */
const CORRUPT = 'bu umuman JSON emas {{{'

/** Xotiradagi `Storage`: modul faqat `getItem`/`setItem` ishlatadi, qolgani realizm uchun. */
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

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Ikki gapli namunaviy dars. */
function makeLesson(over: Partial<Lesson> = {}): Lesson {
  return {
    id: 'l-1',
    title: 'Sinov darsi',
    createdAt: 1_700_000_000_000,
    originalText: 'The cat sat. The dog ran.',
    normalizedText: 'The cat sat. The dog ran.',
    sentences: ['The cat sat.', 'The dog ran.'],
    progress: 0,
    // Ombor `skipped` ni O'QISHDA doim massivga normallashtiradi, ya'ni qaytgan
    // dars uni har doim ushlab turadi — namuna ham shu shaklda bo'lishi kerak.
    skipped: [],
    voice: 'en-US-AriaNeural',
    rate: 0,
    ...over,
  }
}

/** Modul o'qiydigan xom satrni to'g'ridan-to'g'ri yozadi (buzuq holatlarni yasash uchun). */
function writeRaw(value: unknown): void {
  localStorage.setItem(LESSONS_KEY, JSON.stringify(value))
}

// ---------------------------------------------------------------------------
// Saqlash va o'qish
// ---------------------------------------------------------------------------

describe('saveLesson, getLesson va listLessons', () => {
  it("bo'sh omborda ro'yxat bo'sh, `getLesson` null qaytaradi", () => {
    expect(listLessons()).toEqual([])
    expect(getLesson('l-1')).toBeNull()
  })

  it('saqlangan dars barcha maydonlari bilan qaytadi', () => {
    const lesson = makeLesson({ progress: 1, rate: -10 })
    saveLesson(lesson)

    expect(getLesson('l-1')).toEqual(lesson)
    expect(listLessons()).toEqual([lesson])
  })

  it("mavjud `id` ustiga YOZILADI, ikkinchi nusxa yaratilmaydi", () => {
    saveLesson(makeLesson())
    saveLesson(makeLesson({ title: 'Tahrirlangan', progress: 1 }))

    const lessons = listLessons()
    expect(lessons).toHaveLength(1)
    expect(lessons[0]?.title).toBe('Tahrirlangan')
    expect(lessons[0]?.progress).toBe(1)
  })

  it("ro'yxat yangidan eskiga (`createdAt` kamayishi) tartibida", () => {
    saveLesson(makeLesson({ id: 'eski', createdAt: 1_000 }))
    saveLesson(makeLesson({ id: 'yangi', createdAt: 3_000 }))
    saveLesson(makeLesson({ id: 'ortadagi', createdAt: 2_000 }))

    expect(listLessons().map((l) => l.id)).toEqual(['yangi', 'ortadagi', 'eski'])
  })

  it('turli darslar bir-birini bosmaydi', () => {
    saveLesson(makeLesson({ id: 'a', title: 'Birinchi' }))
    saveLesson(makeLesson({ id: 'b', title: 'Ikkinchi' }))

    expect(getLesson('a')?.title).toBe('Birinchi')
    expect(getLesson('b')?.title).toBe('Ikkinchi')
  })
})

// ---------------------------------------------------------------------------
// clampProgress chegaralari
// ---------------------------------------------------------------------------

describe('progress chegaralari', () => {
  it('manfiy progress 0 ga keltiriladi', () => {
    saveLesson(makeLesson({ progress: -5 }))
    expect(getLesson('l-1')?.progress).toBe(0)
  })

  it("gaplar sonidan katta progress `sentences.length` gacha kesiladi", () => {
    saveLesson(makeLesson({ progress: 99 }))
    expect(getLesson('l-1')?.progress).toBe(2)
  })

  it("`progress === sentences.length` SAQLANADI — bu \"dars tugadi\" belgisi", () => {
    saveLesson(makeLesson({ progress: 2 }))

    // Kesib 1 ga tushirilsa oxirgi gap har safar qaytadan chiqaverardi.
    expect(getLesson('l-1')?.progress).toBe(2)
    expect(listLessons()[0]?.progress).toBe(2)

    // O'qish yo'lida (`toLesson`) ham o'sha qiymat tirik qolishi shart.
    writeRaw([makeLesson({ progress: 2 })])
    expect(getLesson('l-1')?.progress).toBe(2)
  })

  it("kasrli progress pastga yaxlitlanadi", () => {
    saveLesson(makeLesson({ progress: 1.9 }))
    expect(getLesson('l-1')?.progress).toBe(1)
  })

  it("son bo'lmagan qiymatlar (NaN, Infinity) 0 beradi", () => {
    saveLesson(makeLesson({ id: 'nan', progress: Number.NaN }))
    saveLesson(makeLesson({ id: 'inf', progress: Number.POSITIVE_INFINITY }))

    expect(getLesson('nan')?.progress).toBe(0)
    expect(getLesson('inf')?.progress).toBe(0)
  })

  it("gapsiz darsda progress faqat 0 bo'la oladi", () => {
    saveLesson(makeLesson({ sentences: [], progress: 3 }))
    expect(getLesson('l-1')?.progress).toBe(0)
  })

  it("saqlangan haddan tashqari progress O'QISHDA ham kesiladi", () => {
    writeRaw([makeLesson({ progress: 500 })])
    expect(getLesson('l-1')?.progress).toBe(2)
  })
})

describe('setProgress', () => {
  it('davom ettirish nuqtasini yangilaydi', () => {
    saveLesson(makeLesson())
    setProgress('l-1', 1)

    expect(getLesson('l-1')?.progress).toBe(1)
  })

  it("oxirgi gapdan keyingi qiymat (`sentences.length`) kesilmaydi", () => {
    saveLesson(makeLesson())
    setProgress('l-1', 2)

    expect(getLesson('l-1')?.progress).toBe(2)
  })

  it('chegaradan tashqaridagi qiymatlar kesiladi', () => {
    saveLesson(makeLesson())

    setProgress('l-1', 42)
    expect(getLesson('l-1')?.progress).toBe(2)

    setProgress('l-1', -1)
    expect(getLesson('l-1')?.progress).toBe(0)
  })

  it("mavjud bo'lmagan `id` — xavfsiz no-op, ombor bir zarra ham o'zgarmaydi", () => {
    saveLesson(makeLesson())
    const before = localStorage.getItem(LESSONS_KEY)

    setProgress('yoq-bunday-dars', 3)

    expect(localStorage.getItem(LESSONS_KEY)).toBe(before)
    expect(listLessons()).toHaveLength(1)
  })

  it("bo'sh omborda ham yiqilmaydi va yangi yozuv yaratmaydi", () => {
    setProgress('l-1', 2)
    expect(listLessons()).toEqual([])
  })

  it('faqat nishondagi darsni tegadi', () => {
    saveLesson(makeLesson({ id: 'a', progress: 0 }))
    saveLesson(makeLesson({ id: 'b', progress: 1 }))

    setProgress('a', 2)

    expect(getLesson('a')?.progress).toBe(2)
    expect(getLesson('b')?.progress).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Tashlangan gaplar (PLAN §7): progress bilan BIRGA yoziladi
// ---------------------------------------------------------------------------

describe('completeSentence', () => {
  /** Uch gapli dars — chegaralarni ko'rsatish uchun ikkitasi yetmaydi. */
  function three(over: Partial<Lesson> = {}): Lesson {
    return makeLesson({ sentences: ['Bir.', 'Ikki.', 'Uch.'], ...over })
  }

  it('yozib tugatilgan gap progressni oldinga suradi', () => {
    saveLesson(three())
    completeSentence('l-1', 0, false)

    expect(getLesson('l-1')?.progress).toBe(1)
    expect(getLesson('l-1')?.skipped).toEqual([])
  })

  it("tashlangan gap ro'yxatga tushadi, progress esa BARIBIR suriladi", () => {
    // Aynan shu nuqta: progress to'xtatilsa keyingi seans o'sha gapga
    // qaytaverardi va foydalanuvchi undan chiqa olmasdi.
    saveLesson(three())
    completeSentence('l-1', 1, true)

    expect(getLesson('l-1')?.progress).toBe(2)
    expect(getLesson('l-1')?.skipped).toEqual([1])
  })

  it("bitta gap ikki marta tashlansa ro'yxatda bir marta qoladi", () => {
    saveLesson(three())
    completeSentence('l-1', 1, true)
    completeSentence('l-1', 1, true)

    expect(getLesson('l-1')?.skipped).toEqual([1])
  })

  it("keyin YOZIB tugatilgan gap ro'yxatdan chiqadi", () => {
    saveLesson(three({ progress: 3, skipped: [0, 2] }))
    completeSentence('l-1', 0, false)

    expect(getLesson('l-1')?.skipped).toEqual([2])
  })

  it("ro'yxat o'sish tartibida saqlanadi", () => {
    saveLesson(three())
    completeSentence('l-1', 2, true)
    completeSentence('l-1', 0, true)

    expect(getLesson('l-1')?.skipped).toEqual([0, 2])
  })

  it('⭐ progress ORQAGA surilmaydi', () => {
    // Dars oxirida qaytgan tashlangan gap yozib tugatilganda `index + 1`
    // saqlangan qiymatdan kichik bo'ladi. Oddiy yozuv foydalanuvchini
    // allaqachon yozib bo'lgan gaplariga qaytarib tashlardi.
    saveLesson(three({ progress: 3, skipped: [0] }))
    completeSentence('l-1', 0, false)

    expect(getLesson('l-1')?.progress).toBe(3)
    expect(getLesson('l-1')?.skipped).toEqual([])
  })

  it("oxirgi gap progressni \"dars tugadi\" belgisiga olib chiqadi", () => {
    saveLesson(three())
    completeSentence('l-1', 2, false)

    expect(getLesson('l-1')?.progress).toBe(3)
  })

  it('chegaradan tashqaridagi indeks — xavfsiz no-op', () => {
    saveLesson(three({ progress: 1 }))
    const before = localStorage.getItem(LESSONS_KEY)

    completeSentence('l-1', 3, true)
    completeSentence('l-1', -1, true)
    completeSentence('l-1', Number.NaN, true)

    expect(localStorage.getItem(LESSONS_KEY)).toBe(before)
  })

  it("mavjud bo'lmagan dars — xavfsiz no-op", () => {
    saveLesson(three())
    const before = localStorage.getItem(LESSONS_KEY)

    completeSentence('yoq-bunday-dars', 0, true)

    expect(localStorage.getItem(LESSONS_KEY)).toBe(before)
    expect(listLessons()).toHaveLength(1)
  })

  it('faqat nishondagi darsni tegadi', () => {
    saveLesson(three({ id: 'a' }))
    saveLesson(three({ id: 'b' }))

    completeSentence('a', 0, true)

    expect(getLesson('a')?.skipped).toEqual([0])
    expect(getLesson('b')?.skipped).toEqual([])
    expect(getLesson('b')?.progress).toBe(0)
  })
})

describe("saqlangan `skipped` ro'yxatini o'qish", () => {
  it("maydoni yo'q ESKI dars bo'sh ro'yxat bilan qaytadi", () => {
    writeRaw([{ id: 'eski', sentences: ['Bir.', 'Ikki.'], normalizedText: 'Bir. Ikki.' }])
    expect(getLesson('eski')?.skipped).toEqual([])
  })

  it('buzuq qiymatlar tozalanadi, dars esa YO\'QOLMAYDI', () => {
    // Ro'yxat qulaylik uchun; dars matni undan muhimroq, shuning uchun buzuq
    // `skipped` butun yozuvni tashlab yubormaydi.
    writeRaw([makeLesson({ skipped: [1, -1, 5, 0.5, Number.NaN] })])

    const lesson = getLesson('l-1')
    expect(lesson).not.toBeNull()
    expect(lesson?.skipped).toEqual([0, 1])
  })

  it("massiv bo'lmagan qiymat bo'sh ro'yxatga aylanadi", () => {
    writeRaw([{ ...makeLesson(), skipped: 'ha' }])
    expect(getLesson('l-1')?.skipped).toEqual([])
  })

  it('takrorlangan indekslar bir marta qoladi va tartiblanadi', () => {
    writeRaw([makeLesson({ skipped: [1, 0, 1] })])
    expect(getLesson('l-1')?.skipped).toEqual([0, 1])
  })

  it("`saveLesson` ham normallashtiradi", () => {
    saveLesson(makeLesson({ skipped: [9, 1, 1] }))
    expect(getLesson('l-1')?.skipped).toEqual([1])
  })
})

// ---------------------------------------------------------------------------
// Ta'kidlash oraliqlari (`emphasis`) — ishonchsiz `localStorage` ma'lumoti
// ---------------------------------------------------------------------------

describe("saqlangan `emphasis` oraliqlarini o'qish", () => {
  it('yozilgan oraliqlar aynan qaytadi', () => {
    // `sentences[0]` = 'The cat sat.' (12 belgi), `sentences[1]` = 'The dog ran.'
    saveLesson(makeLesson({ emphasis: [[{ start: 4, end: 7 }], []] }))
    expect(getLesson('l-1')?.emphasis).toEqual([[{ start: 4, end: 7 }], []])
  })

  it("maydoni yo'q ESKI dars `undefined` bilan qaytadi — qalinlik yo'q", () => {
    writeRaw([{ id: 'eski', sentences: ['Bir.'], normalizedText: 'Bir.' }])
    expect(getLesson('eski')?.emphasis).toBeUndefined()
  })

  it("massiv bo'lmagan qiymat `undefined` ga aylanadi", () => {
    writeRaw([{ ...makeLesson(), emphasis: 'qalin' }])
    expect(getLesson('l-1')?.emphasis).toBeUndefined()
  })

  it("birorta oraliq qolmasa maydon SAQLANMAYDI", () => {
    saveLesson(makeLesson({ emphasis: [[], []] }))
    expect(getLesson('l-1')?.emphasis).toBeUndefined()
    // Bo'sh ro'yxatlar diskka ham yozilmaydi — 500 gapli darsda ular bekorga joy egallardi.
    expect(localStorage.getItem(LESSONS_KEY)).not.toContain('emphasis')
  })

  it('gap CHEGARASIDAN chiqqan oraliq tashlanadi, dars esa yo\'qolmaydi', () => {
    // 'The cat sat.' — 12 belgi, ya'ni `end: 99` yaroqsiz.
    writeRaw([makeLesson({ emphasis: [[{ start: 0, end: 99 }], []] })])

    const lesson = getLesson('l-1')
    expect(lesson).not.toBeNull()
    expect(lesson?.sentences).toEqual(['The cat sat.', 'The dog ran.'])
    expect(lesson?.emphasis).toBeUndefined()
  })

  it('buzuq oraliqlar tozalanadi, yaroqlisi qoladi', () => {
    writeRaw([
      makeLesson({
        emphasis: [
          [
            { start: -1, end: 3 }, // manfiy boshlanish
            { start: 5, end: 5 }, // bo'sh
            { start: 7, end: 4 }, // teskari
            { start: 0, end: 3 }, // YAROQLI
            'oraliq emas',
            null,
          ] as never,
          [],
        ],
      }),
    ])
    expect(getLesson('l-1')?.emphasis).toEqual([[{ start: 0, end: 3 }], []])
  })

  it("kesishgan oraliq butunlay tashlanadi (chizuvchi kesishmaganiga tayanadi)", () => {
    writeRaw([makeLesson({ emphasis: [[{ start: 0, end: 7 }, { start: 4, end: 9 }], []] })])
    expect(getLesson('l-1')?.emphasis).toEqual([[{ start: 0, end: 7 }], []])
  })

  it("oraliqlar o'sish tartibiga keltiriladi", () => {
    writeRaw([makeLesson({ emphasis: [[{ start: 8, end: 11 }, { start: 0, end: 3 }], []] })])
    expect(getLesson('l-1')?.emphasis).toEqual([
      [
        { start: 0, end: 3 },
        { start: 8, end: 11 },
      ],
      [],
    ])
  })

  it("ro'yxat uzunligi gaplar soniga tenglashtiriladi", () => {
    // Bitta gapga oraliq berilgan, ikkinchisiga umuman yo'q.
    writeRaw([makeLesson({ emphasis: [[{ start: 0, end: 3 }]] })])
    expect(getLesson('l-1')?.emphasis).toHaveLength(2)
  })

  it("`saveLesson` ham normallashtiradi", () => {
    saveLesson(makeLesson({ emphasis: [[{ start: 4, end: 999 }], [{ start: 0, end: 3 }]] }))
    expect(getLesson('l-1')?.emphasis).toEqual([[], [{ start: 0, end: 3 }]])
  })
})

// ---------------------------------------------------------------------------
// ESKI darslarni ko'chirish: belgilar hali gap matnining ichida (PLAN §2b')
// ---------------------------------------------------------------------------

describe("ta'kidlash qo'shilishidan OLDIN saqlangan darslar", () => {
  it("gap ichida qolgan `` `...` `` o'qishda ajratiladi", () => {
    writeRaw([
      {
        id: 'eski',
        sentences: ['Hundreds of people `packed into` the hall.'],
        normalizedText: 'Hundreds of people `packed into` the hall.',
      },
    ])

    const lesson = getLesson('eski')
    // Target endi teskari tirnoqsiz — foydalanuvchi uni termaydi.
    expect(lesson?.sentences).toEqual(['Hundreds of people packed into the hall.'])
    expect(lesson?.emphasis).toEqual([[{ start: 19, end: 30 }]])

    const text = lesson?.sentences[0] ?? ''
    const range = lesson?.emphasis?.[0]?.[0]
    expect(text.slice(range?.start ?? 0, range?.end ?? 0)).toBe('packed into')
  })

  it("belgisi yo'q eski dars UMUMAN o'zgarmaydi", () => {
    writeRaw([{ id: 'eski', sentences: ['The cat sat.'], normalizedText: 'The cat sat.' }])

    const lesson = getLesson('eski')
    expect(lesson?.sentences).toEqual(['The cat sat.'])
    expect(lesson?.emphasis).toBeUndefined()
  })

  it("yolg'iz tirnoq ko'chirishda ham TEGILMAY qoladi", () => {
    writeRaw([{ id: 'eski', sentences: ['A `b c.'], normalizedText: 'A `b c.' }])
    expect(getLesson('eski')?.sentences).toEqual(['A `b c.'])
    expect(getLesson('eski')?.emphasis).toBeUndefined()
  })

  it("`emphasis` maydoni BOR dars ko'chirilmaydi", () => {
    // Yangi kod saqlagan dars: juftlangan belgilar allaqachon olingan, qolgan
    // yolg'iz tirnoq esa ataylab matnda. Uni ikkinchi marta talqin qilmaymiz.
    writeRaw([
      {
        id: 'yangi',
        sentences: ['A `b c.', 'D e.'],
        normalizedText: 'A `b c. D e.',
        emphasis: [[], [{ start: 0, end: 1 }]],
      },
    ])

    const lesson = getLesson('yangi')
    expect(lesson?.sentences).toEqual(['A `b c.', 'D e.'])
    expect(lesson?.emphasis).toEqual([[], [{ start: 0, end: 1 }]])
  })

  it("ko'chirish gaplar SONINI o'zgartirmaydi — progress ma'nosi saqlanadi", () => {
    writeRaw([
      {
        id: 'eski',
        sentences: ['`One` two.', 'Three `four`.', 'Five.'],
        normalizedText: '`One` two. Three `four`. Five.',
        progress: 2,
        skipped: [1],
      },
    ])

    const lesson = getLesson('eski')
    expect(lesson?.sentences).toEqual(['One two.', 'Three four.', 'Five.'])
    expect(lesson?.progress).toBe(2)
    expect(lesson?.skipped).toEqual([1])
  })

  it("ko'chirish idempotent: ikkinchi o'qish natijani o'zgartirmaydi", () => {
    writeRaw([
      { id: 'eski', sentences: ['A `b` c.'], normalizedText: 'A `b` c.' },
    ])

    const first = getLesson('eski')
    // Progress yozuvi ko'chirilgan shaklni diskka qaytaradi.
    setProgress('eski', 1)
    const second = getLesson('eski')

    expect(second?.sentences).toEqual(first?.sentences)
    expect(second?.emphasis).toEqual(first?.emphasis)
    expect(second?.sentences).toEqual(['A b c.'])
  })
})

// ---------------------------------------------------------------------------
// O'chirish
// ---------------------------------------------------------------------------

describe('deleteLesson', () => {
  it('faqat nishondagi darsni olib tashlaydi', () => {
    saveLesson(makeLesson({ id: 'a', createdAt: 3_000 }))
    saveLesson(makeLesson({ id: 'b', createdAt: 2_000 }))
    saveLesson(makeLesson({ id: 'c', createdAt: 1_000 }))

    deleteLesson('b')

    expect(listLessons().map((l) => l.id)).toEqual(['a', 'c'])
    expect(getLesson('b')).toBeNull()
  })

  it("mavjud bo'lmagan `id` hech narsani buzmaydi", () => {
    saveLesson(makeLesson())

    deleteLesson('yoq-bunday-dars')

    expect(listLessons()).toHaveLength(1)
  })

  it('oxirgi darsni ham tozalay oladi', () => {
    saveLesson(makeLesson())
    deleteLesson('l-1')

    expect(listLessons()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Buzuq ma'lumotga chidamlilik (PLAN §10)
// ---------------------------------------------------------------------------

describe("buzuq yozuvlar", () => {
  it("bitta buzuq yozuv qo'shnilarini YO'Q QILMAYDI", () => {
    writeRaw([
      makeLesson({ id: 'a', createdAt: 3_000 }),
      { id: 'buzuq' }, // `sentences` yo'q
      makeLesson({ id: 'b', createdAt: 2_000 }),
      null,
      42,
      'salom',
      { id: '', sentences: [] }, // id bo'sh
      { id: 'c', sentences: ['To\'g\'ri.', 7] }, // gap satr emas
      makeLesson({ id: 'd', createdAt: 1_000 }),
    ])

    expect(listLessons().map((l) => l.id)).toEqual(['a', 'b', 'd'])
  })

  it("buzuq JSON bo'sh ro'yxat beradi, lekin saqlangan satr O'CHIRILMAYDI", () => {
    localStorage.setItem(LESSONS_KEY, CORRUPT)

    expect(listLessons()).toEqual([])
    // Qo'lda tiklash imkoni qolishi kerak.
    expect(localStorage.getItem(LESSONS_KEY)).toBe(CORRUPT)
  })

  it("buzuq YOZUV keyingi saqlashdan keyin ham omborda qoladi", () => {
    writeRaw([{ id: 'buzuq-yozuv' }, makeLesson({ id: 'a', createdAt: 3_000 })])
    expect(listLessons().map((l) => l.id)).toEqual(['a'])

    saveLesson(makeLesson({ id: 'b', createdAt: 4_000 }))

    // Diskda saqlanib qoladi: bitta tanib bo'lmaydigan yozuv birinchi
    // saqlashdayoq yo'q bo'lib ketsa, "qolganlari saqlanadi" va'dasi
    // faqat o'qish paytida to'g'ri bo'lardi.
    expect(localStorage.getItem(LESSONS_KEY)).toContain('buzuq-yozuv')
    // Parser kafolati esa kuchsizlanmaydi — chaqiruvchiga yetib bormaydi.
    expect(listLessons().map((l) => l.id)).toEqual(['b', 'a'])
    expect(getLesson('buzuq-yozuv')).toBeNull()
  })

  it("buzuq yozuv ko'p yozuvdan keyin ham AYNAN BITTA nusxada qoladi", () => {
    writeRaw([{ id: 'buzuq-yozuv' }, makeLesson({ id: 'a', createdAt: 3_000 })])

    saveLesson(makeLesson({ id: 'b', createdAt: 4_000 }))
    setProgress('b', 1)
    deleteLesson('a')

    const stored = localStorage.getItem(LESSONS_KEY) ?? ''
    // Har yozuvda qayta qo'shilsa, nusxalar soni o'sib ketardi.
    expect(stored.split('buzuq-yozuv').length - 1).toBe(1)
    // O'chirish ham unga tegmaydi.
    expect(listLessons().map((l) => l.id)).toEqual(['b'])
    expect(listLessons()[0]?.progress).toBe(1)
  })

  it("massiv bo'lmagan ildiz bo'sh ro'yxat beradi", () => {
    writeRaw({ lessons: [makeLesson()] })
    expect(listLessons()).toEqual([])

    localStorage.setItem(LESSONS_KEY, '')
    expect(listLessons()).toEqual([])
  })

  it("yetishmayotgan maydonlar o'rniga xavfsiz standart qiymatlar qo'yiladi", () => {
    writeRaw([{ id: 'yalang', sentences: ['Bir.', 'Ikki.'], normalizedText: 'Bir. Ikki.' }])

    expect(getLesson('yalang')).toEqual({
      id: 'yalang',
      title: 'Nomsiz dars',
      createdAt: 0,
      // `originalText` bo'lmasa normallashtirilgan matn ishlatiladi — diff bo'sh chiqadi, xolos.
      originalText: 'Bir. Ikki.',
      normalizedText: 'Bir. Ikki.',
      sentences: ['Bir.', 'Ikki.'],
      progress: 0,
      // `skipped` maydoni keyin qo'shilgan: eski darsda u umuman yo'q, lekin
      // o'qishda bo'sh massivga aylanadi — chaqiruvchi kod `undefined` ni
      // hisobga olishi shart emas.
      skipped: [],
      voice: '',
      rate: 0,
    })
  })
})

// ---------------------------------------------------------------------------
// Buzuq payload zaxirasi (PLAN §10): "qo'lda tiklash mumkin" va'dasi
// ---------------------------------------------------------------------------

describe('buzuq payload zaxirasi', () => {
  it("toza omborda zaxira yo'q", () => {
    saveLesson(makeLesson())

    // Sog'lom payloadni qayta o'qish ham zaxira YARATMASLIGI kerak: aks holda
    // buzuq nusxa borligi haqidagi xabar doim yonib turardi.
    expect(listLessons()).toHaveLength(1)
    expect(corruptLessonsBackup()).toBeNull()
  })

  it("keyingi saqlash asosiy kalitni bosadi, zaxira esa ASL satrni ushlab qoladi", () => {
    localStorage.setItem(LESSONS_KEY, CORRUPT)

    saveLesson(makeLesson())

    // Yozuv butun ro'yxatni qayta yozadi — asosiy kalitda satr qolmaydi...
    expect(localStorage.getItem(LESSONS_KEY)).not.toContain('bu umuman JSON emas')
    // ...lekin tiklash va'dasi endi haqiqiy: nusxa alohida kalitda tirik.
    expect(corruptLessonsBackup()).toBe(CORRUPT)
    expect(listLessons().map((l) => l.id)).toEqual(['l-1'])
  })

  it("massiv bo'lmagan ildiz ham zaxiralanadi", () => {
    // To'g'ri JSON, lekin ro'yxat emas — oqibati bir xil: keyingi yozuv uni yo'q qiladi.
    localStorage.setItem(LESSONS_KEY, '{"lessons": []}')

    saveLesson(makeLesson())

    expect(corruptLessonsBackup()).toBe('{"lessons": []}')
  })

  it("teng uzunlikdagi ikkinchi buzilish zaxirani almashtirmaydi", () => {
    const first = 'birinchi buzilish {{{'
    const second = 'ikkinchi buzilish }}}'
    // Qoida uzunlikka tayanadi, shuning uchun tenglikning O'ZI shart bo'lib qoladi.
    expect(second.length).toBe(first.length)

    localStorage.setItem(LESSONS_KEY, first)
    expect(listLessons()).toEqual([])

    localStorage.setItem(LESSONS_KEY, second)
    expect(listLessons()).toEqual([])

    // Teng bo'lganda almashtirishning foydasi yo'q — mavjudi o'z o'rnida qoladi.
    expect(corruptLessonsBackup()).toBe(first)
  })

  it("20 darsli zaxira, ro'yxat sog'ayib qayta buzilsa ham, KICHIK yangisiga almashmaydi", () => {
    // Real yo'l: ko'p dars yig'iladi, so'ng ro'yxat kesiladi.
    for (let i = 0; i < 20; i++) {
      saveLesson(makeLesson({ id: `l-${i}`, title: `Matn ${i}`, createdAt: 1_000 + i }))
    }
    const full = localStorage.getItem(LESSONS_KEY) ?? ''
    const bigCorrupt = full.slice(0, full.length - 1)
    localStorage.setItem(LESSONS_KEY, bigCorrupt)

    expect(listLessons()).toEqual([])
    expect(corruptLessonsBackup()).toBe(bigCorrupt)

    // Foydalanuvchi BITTA yangi dars saqlaydi: ro'yxat sog'ayadi, lekin asosiy
    // kalitda endi o'sha yakka darsdan boshqa hech narsa yo'q.
    saveLesson(makeLesson({ id: 'yakka', title: 'Yakka matn' }))
    expect(listLessons().map((l) => l.id)).toEqual(['yakka'])

    // Va ro'yxat yana buziladi.
    const healed = localStorage.getItem(LESSONS_KEY) ?? ''
    const smallCorrupt = healed.slice(0, healed.length - 1)
    localStorage.setItem(LESSONS_KEY, smallCorrupt)
    expect(listLessons()).toEqual([])

    // Qoida: uzuni qoladi. Bitta darsli satr uchun 20 darsli satrni
    // almashtirish qo'lda tiklanadigan matnni yo'q qilish bo'lardi.
    expect(smallCorrupt.length).toBeLessThan(bigCorrupt.length)
    expect(corruptLessonsBackup()).toBe(bigCorrupt)
    expect(corruptLessonsBackup()).toContain('Matn 19')
  })

  it("KICHIK zaxira UZUNROQ yangi buzilish bilan ALMASHTIRILADI", () => {
    // Teskari tartib: birinchi buzilish qiymatsiz bir belgili satr.
    localStorage.setItem(LESSONS_KEY, 'x')
    expect(listLessons()).toEqual([])
    expect(corruptLessonsBackup()).toBe('x')

    saveLesson(makeLesson({ id: 'a', title: 'Birinchi matn' }))
    saveLesson(makeLesson({ id: 'b', title: 'Ikkinchi matn' }))
    const healthy = localStorage.getItem(LESSONS_KEY) ?? ''
    expect(listLessons()).toHaveLength(2)

    const truncated = healthy.slice(0, healthy.length - 1)
    localStorage.setItem(LESSONS_KEY, truncated)
    expect(listLessons()).toEqual([])

    // Yangi satr uzunroq: ichida darslar bor, 'x' da esa hech narsa.
    expect(truncated.length).toBeGreaterThan('x'.length)
    expect(corruptLessonsBackup()).toBe(truncated)
    expect(corruptLessonsBackup()).toContain('Birinchi matn')
  })

  it("zaxira yozib bo'lmasa ham saqlash ISHLAYVERADI", () => {
    vi.stubGlobal('localStorage', createStorageRejecting(LESSONS_CORRUPT_KEY))
    localStorage.setItem(LESSONS_KEY, CORRUPT)

    expect(() => saveLesson(makeLesson())).not.toThrow()

    expect(listLessons().map((l) => l.id)).toEqual(['l-1'])
    expect(corruptLessonsBackup()).toBeNull()
  })

  it("`discardCorruptLessonsBackup` faqat zaxirani o'chiradi", () => {
    localStorage.setItem(LESSONS_KEY, CORRUPT)
    saveLesson(makeLesson())
    expect(corruptLessonsBackup()).toBe(CORRUPT)

    discardCorruptLessonsBackup()

    expect(corruptLessonsBackup()).toBeNull()
    expect(listLessons().map((l) => l.id)).toEqual(['l-1'])
  })
})

// ---------------------------------------------------------------------------
// Tanib bo'lmaydigan yozuvlarni tozalash — kvotani bo'shatishning yagona yo'li
// ---------------------------------------------------------------------------

describe('discardUnknownLessons', () => {
  it("xom yozuvlarni sanaydi va faqat o'shalarni olib tashlaydi", () => {
    writeRaw([{ id: 'buzuq-yozuv' }, makeLesson({ id: 'a' }), 42])
    expect(unknownLessonCount()).toBe(2)

    discardUnknownLessons()

    // Endi diskda ham qolmaydi: usiz har saqlash ularni qaytarardi (`writeAll`).
    expect(localStorage.getItem(LESSONS_KEY)).not.toContain('buzuq-yozuv')
    expect(unknownLessonCount()).toBe(0)
    // Tanilgan darslar joyida.
    expect(listLessons().map((l) => l.id)).toEqual(['a'])
  })

  it("keyingi saqlash ham ularni qaytarmaydi", () => {
    writeRaw([{ id: 'buzuq-yozuv' }, makeLesson({ id: 'a', createdAt: 3_000 })])

    discardUnknownLessons()
    saveLesson(makeLesson({ id: 'b', createdAt: 4_000 }))

    expect(localStorage.getItem(LESSONS_KEY)).not.toContain('buzuq-yozuv')
    expect(listLessons().map((l) => l.id)).toEqual(['b', 'a'])
  })

  it("xom yozuv bo'lmasa omborga UMUMAN tegmaydi", () => {
    saveLesson(makeLesson())
    const before = localStorage.getItem(LESSONS_KEY)

    expect(unknownLessonCount()).toBe(0)
    discardUnknownLessons()

    expect(localStorage.getItem(LESSONS_KEY)).toBe(before)
  })

  it("bo'sh omborda ham yiqilmaydi va yozuv yaratmaydi", () => {
    expect(unknownLessonCount()).toBe(0)
    expect(() => discardUnknownLessons()).not.toThrow()

    expect(localStorage.getItem(LESSONS_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Id generatori
// ---------------------------------------------------------------------------

describe('newLessonId', () => {
  it("`crypto.randomUUID` bor muhitda noyob id beradi", () => {
    const first = newLessonId()
    const second = newLessonId()

    expect(first.length).toBeGreaterThan(0)
    expect(second).not.toBe(first)
  })

  it("`crypto` umuman bo'lmasa ham ishlaydigan id qaytaradi", () => {
    // Telefondan `http://192.168.x.x:5173` ga kirilganda aynan shu holat yuz beradi.
    vi.stubGlobal('crypto', undefined)

    const id = newLessonId()

    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(2)
    expect(id.startsWith('l-')).toBe(true)

    // Eng muhimi — id haqiqatan ishlaydi: dars saqlanadi va topiladi.
    saveLesson(makeLesson({ id }))
    expect(getLesson(id)?.id).toBe(id)
  })

  it("`crypto` bor, lekin `randomUUID` yo'q bo'lsa zaxiraga o'tadi", () => {
    vi.stubGlobal('crypto', { getRandomValues: () => new Uint8Array(0) })

    const id = newLessonId()

    expect(id.startsWith('l-')).toBe(true)
  })

  it("`randomUUID` xato tashlasa ham zaxira id qaytadi", () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => {
        throw new Error('xavfsiz kontekst emas')
      },
    })

    const id = newLessonId()

    expect(id.startsWith('l-')).toBe(true)
  })
})

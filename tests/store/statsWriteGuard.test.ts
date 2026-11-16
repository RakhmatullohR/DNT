// ⭐ `writeSentences` ↔ v1 migratsiyasi CHOKI — "avval migratsiya" qorovuli
// (`src/store/stats.ts`, §9 qorovuli; docs/stats-longterm.md §9).
//
// NIMA SINALADI. `Practice.tsx` — omborga YOZADIGAN yagona ekran va
// `initStats()` ni chaqirmaydigan yagona ekran. Ya'ni "avval migratsiya, keyin
// yozuv" tartibi ilgari faqat KONVENSIYA edi: `main.tsx` `void initStats()`
// chiqaradi va render bloklanmaydi, foydalanuvchi esa aynan o'sha oynada gapni
// tugatishi mumkin. Endi tartibni omborning O'ZI majburlaydi. Bu fayl aynan
// shu majburlashni tekshiradi — yozuv mantiqini emas (u `stats.test.ts` da).
//
// ⚠️ NEGA ALOHIDA FAYL. `vi.mock` FAYL darajasida ishlaydi va butun modulga
// yoyiladi. Qorovulning ikkita xossasini (migratsiya NECHA MARTA ishladi,
// YIQILGANDA nima bo'ladi) mock'siz kuzatib bo'lmaydi: `migrateV1ToV2()` xato
// tashlamaydi — u hamma nosozlikni `ok: false` ga aylantiradi, `loadStatsV1()`
// esa `localStorage` tashlashini O'ZI yutib, bo'sh hujjat qaytaradi. Mock'ni
// 2200 qatorli `stats.test.ts` ga qo'yish esa u yerdagi HAR BIR testni
// soxtalashtirardi.
//
// Mock ORIGINALNI o'rab oladi (`importOriginal`), almashtirmaydi: `probe.fail`
// yoqilmagan bo'lsa haqiqiy migratsiya ishlaydi va sanoqdan boshqa hech narsa
// o'zgarmaydi.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** `vi.mock` fabrikasi HOIST qilinadi — u ko'radigan holat ham hoist bo'lishi shart. */
const probe = vi.hoisted(() => ({ calls: 0, fail: false }))

vi.mock('../../src/store/statsMigrate.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/store/statsMigrate.ts')>()
  return {
    ...actual,
    migrateV1ToV2: async () => {
      probe.calls += 1
      // Nosozlikning REAL shakli: tashlash emas, `ok: false`. Bloklangan tab
      // (§8.4b) va kutilmagan xato ikkalasi ham shu ko'rinishda keladi.
      if (probe.fail) return { ok: false as const, error: 'sinov uchun majburiy nosozlik' }
      return actual.migrateV1ToV2()
    },
  }
})

import { dayNumber } from '../../src/core/wordScore.ts'
import { closeDb, deleteDb, openDb, runTx } from '../../src/store/statsDb.ts'
import {
  META_KEY_LIFETIME,
  STORE_DAYS,
  STORE_META,
  STORE_WORDS,
  dayKeyOf,
} from '../../src/store/statsSchema.ts'
import type {
  DayRow,
  LifetimeMeta,
  SessionEnvelope,
  SentenceRecord,
  WordRow,
} from '../../src/store/statsSchema.ts'
import { META_KEY_V1_MIGRATED_AT } from '../../src/store/statsMigrate.ts'
import { STATS_V1_KEY } from '../../src/store/statsV1.ts'
import { initStats, writeSentences } from '../../src/store/stats.ts'
import type { SentenceWrite } from '../../src/store/stats.ts'

// ---------------------------------------------------------------------------
// Muhit
// ---------------------------------------------------------------------------

/** Xotiradagi `Storage` (namuna: `tests/store/stats.test.ts`). */
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

/** Qat'iy "hozir": lokal tush payti — kun kaliti mintaqada surilmasin. */
const NOW = new Date(2026, 2, 15, 12, 0, 0, 0).getTime()
const TODAY_KEY = dayKeyOf(NOW)
const TODAY = dayNumber(NOW)

beforeEach(() => {
  probe.calls = 0
  probe.fail = false
  vi.stubGlobal('localStorage', createMemoryStorage())
  // ⚠️ FAQAT `Date`: standart `useFakeTimers()` `setImmediate` ni ham qotiradi,
  // `fake-indexeddb` esa tranzaksiyalarni AYNAN shu bilan navbatga qo'yadi.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  closeDb()
  await deleteDb()
})

// ---------------------------------------------------------------------------
// Fikstura — ko'rikning stsenariysi, raqamma-raqam
// ---------------------------------------------------------------------------
//
// v1 ombori:  alpha = 10 ta'sirlanish, bugungi kunda 900 to'g'ri bosish, 0 seans
// jonli gap:  alpha = +1 ta'sirlanish,          +48 to'g'ri bosish, +1 seans
// KUTILGAN:   11 / 948 / 1        KO'R YOZUVDA: 10 / 900 / 0

/** v1 `localStorage` hujjati. Omon qolgan seans YO'Q — `f`/`l` tiklanmaydi. */
function seedV1(): void {
  localStorage.setItem(
    STATS_V1_KEY,
    JSON.stringify({
      version: 1,
      sessions: [],
      words: { alpha: { exposures: 10, errors: 2 } },
      days: { [TODAY_KEY]: { correctKeystrokes: 900, activeMs: 600_000, sentences: 9 } },
    }),
  )
}

function sentence(): SentenceRecord {
  return {
    sentenceIndex: 0,
    at: NOW,
    activeMs: 60_000,
    keystrokes: 50,
    correctKeystrokes: 48,
    netWpm: 9.6, // (48 / 5) / 1 daqiqa
    rawWpm: 10,
    accuracy: 0.96,
    restarts: 0,
    skipped: false,
  }
}

function write(sessionId = 's-1'): Promise<boolean> {
  const record = sentence()
  const envelope: SessionEnvelope = {
    lessonId: 'l1',
    lessonTitle: 'Sinov darsi',
    startedAt: NOW - 60_000,
    endedAt: NOW,
    activeMs: record.activeMs,
    keystrokes: record.keystrokes,
    correctKeystrokes: record.correctKeystrokes,
    netWpm: record.netWpm,
    rawWpm: record.rawWpm,
    accuracy: record.accuracy,
  }
  const item: SentenceWrite = {
    ...record,
    words: new Map([['alpha', { exposures: 1, errors: 0 }]]),
  }
  return writeSentences(sessionId, envelope, [item])
}

// ---------------------------------------------------------------------------
// O'qish yordamchilari
// ---------------------------------------------------------------------------

async function open(): Promise<IDBDatabase> {
  const db = await openDb()
  if (db === null) throw new Error('test muhitida IndexedDB ochilmadi')
  return db
}

function read<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return open().then((db) =>
    runTx<T | undefined>(
      db,
      [store],
      'readonly',
      (tx, collect) => {
        const req = tx.objectStore(store).get(key)
        req.onsuccess = () => collect(req.result as T | undefined)
      },
      undefined,
    ),
  )
}

/** Uchta kuzatiladigan raqam — ko'rik aynan shularni o'lchagan edi. */
async function observed(): Promise<{ exposures: number; correctKeystrokes: number; sessions: number }> {
  return {
    exposures: (await read<WordRow>(STORE_WORDS, 'alpha'))?.e ?? 0,
    correctKeystrokes: (await read<DayRow>(STORE_DAYS, TODAY_KEY))?.correctKeystrokes ?? 0,
    sessions: (await read<LifetimeMeta>(STORE_META, META_KEY_LIFETIME))?.sessions ?? 0,
  }
}

const marker = (): Promise<number | undefined> => read<number>(STORE_META, META_KEY_V1_MIGRATED_AT)

// ---------------------------------------------------------------------------

describe('⭐ §9 qorovuli — yozuv migratsiyani KUTADI', () => {
  it('`initStats()` UMUMAN chaqirilmaydi: yozuvning O\'ZI migratsiyani majburlaydi', async () => {
    seedV1()

    expect(await write()).toBe(true)

    // Qorovulsiz bu yerda marker BO'LMASDI: `Practice.tsx` `initStats()` ni
    // chaqirmaydi, ya'ni migratsiyani boshlaydigan hech kim yo'q edi.
    expect(await marker()).toBeTypeOf('number')
    expect(probe.calls).toBe(1)
    expect(await observed()).toEqual({ exposures: 11, correctKeystrokes: 948, sessions: 1 })
  })

  it('v1 tarixi va jonli gap BIR QATORDA birlashadi — tartib qorovul bilan qat\'iy', async () => {
    seedV1()
    await write()

    const row = await read<WordRow>(STORE_WORDS, 'alpha')
    // Migratsiya AVVAL yozadi (e=10, x=2, `l` YO'Q), keyin `nextWordRow` bugungi
    // deltani qo'shadi va `f`/`l` ni BUGUNGA qo'yadi. Teskari tartibda
    // `writePlan` jonli qatorni topib birlashtirardi — natija bir xil, lekin
    // qorovul aynan shu ikkilanishni yo'q qilish uchun bor.
    expect(row?.e).toBe(11)
    expect(row?.x).toBe(2)
    expect(row?.f).toBe(TODAY)
    expect(row?.l).toBe(TODAY)
  })

  it('boot va yozuv AYNI va\'dani kutadi — migratsiya AYNAN BIR MARTA ishlaydi', async () => {
    seedV1()

    // `main.tsx` dagi `void initStats()` va o'sha oynada tugagan gap.
    const boot = initStats(NOW)
    const written = write()
    await Promise.all([boot, written])

    // Ikkita mustaqil migratsiya ATOMIK marker tufayli ma'lumotni buzmasdi,
    // lekin 2 MB hujjatni IKKI marta parse qilardi. Memoizatsiya shuni yopadi.
    expect(probe.calls).toBe(1)
    expect(await observed()).toEqual({ exposures: 11, correctKeystrokes: 948, sessions: 1 })
  })

  it('muvaffaqiyatli migratsiya KESHLANADI — keyingi gaplar uni qayta ishga tushirmaydi', async () => {
    seedV1()

    await write()
    await write()
    await write()

    expect(probe.calls).toBe(1)
    // Uchala gap ham diskka tushgan: qorovul yozuvni O'TKAZIB YUBORMAYDI.
    expect((await observed()).exposures).toBe(13)
  })

  it('YANGI ULANISH keshni bekor qiladi (`db.onclose`, sayt ma\'lumoti tozalandi)', async () => {
    seedV1()
    await write()
    expect(probe.calls).toBe(1)

    // Kesh kaliti — ULANISHNING O'ZI. Modul darajasidagi bayroq bo'lganida
    // bo'shatilgan bazada u "ko'chirilgan" deb yolg'on aytib turardi.
    closeDb()
    await write('s-2')

    expect(probe.calls).toBe(2)
    // Ikkinchi urinish markerni ko'radi va hech narsa ko'chirmaydi.
    expect((await observed()).exposures).toBe(12)
  })
})

describe('⚠️ qorovul YOZUVNI TO\'XTATMAYDI', () => {
  it('migratsiya yiqilsa gap baribir diskka tushadi', async () => {
    seedV1()
    probe.fail = true

    expect(await write()).toBe(true)

    // Ombor nosozligi foydalanuvchining mashqini YEB QO'YMAYDI.
    expect(await marker()).toBeUndefined()
    expect(await observed()).toEqual({ exposures: 1, correctKeystrokes: 48, sessions: 1 })
  })

  it("⭐ konvertsiz omborda `*Since` uchtasi BUGUNGA qo'yiladi (`lifetimeForWrite` ta'miri)", async () => {
    seedV1()
    probe.fail = true

    await write()

    // Bu shoxga YETIB BORILADIGAN yagona yo'l aynan shu: normal ishda
    // migratsiya konvertni HAR DOIM yozadi, ya'ni yozuv uni tayyor topadi.
    // Belgisiz qoldirish qisman sonni YALANG'OCH umrbod raqam deb
    // ko'rsatardi — §4.3 aynan shuning oldini olish uchun yozilgan.
    expect(await read<LifetimeMeta>(STORE_META, META_KEY_LIFETIME)).toMatchObject({
      netCharsSince: TODAY,
      sessionsSince: TODAY,
      keystrokesSince: TODAY,
    })
  })

  it('⭐ NOSOZLIK KESHLANMAYDI, va keyingi urinish jonli qatorni SAQLAB qoladi', async () => {
    seedV1()

    probe.fail = true
    await write()
    expect(probe.calls).toBe(1)

    probe.fail = false
    expect(await initStats(NOW)).toBe('ready')

    // (a) Qayta urinildi — nosozlik keshlanganida v1 tarixi shu tab yopilguncha
    //     ko'chmay qolardi ("keyingi chaqiruvda qayta uriniladi" va'dasi).
    expect(probe.calls).toBe(2)
    expect(await marker()).toBeTypeOf('number')

    // (b) ⭐ Bu — `writePlan` dagi o'qi-birlashtir-yoz YETIB BORILADIGAN
    //     bo'lib qoladigan yagona TAB ICHIDAGI yo'l: diskda migratsiyadan
    //     OLDIN yozilgan jonli qator turibdi. Ko'r `put()` da bu sonlar
    //     10 / 900 / 0 chiqardi — gap yo'qolardi.
    expect(await observed()).toEqual({ exposures: 11, correctKeystrokes: 948, sessions: 1 })
  })
})

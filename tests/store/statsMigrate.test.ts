// `statsMigrate.ts` — v1 (`localStorage`) -> v2 (IndexedDB) migratsiyasi
// (docs/stats-longterm.md §9). Har bir describe bloki hujjatning aniq bandiga
// to'g'ri keladi.
//
// Muhit ikki tomonlama: `fake-indexeddb/auto` `store` proyektining
// `setupFiles` ida ulanadi, `localStorage` esa Node'da UMUMAN yo'q — shuning
// uchun har testdan oldin xotiradagi minimal `Storage` o'rnatiladi
// (`tests/core/stats.test.ts` dagi bilan bir xil uslub). Migratsiyaning kirishi
// IKKITA `localStorage` kalitidan iborat: `dnt.stats.v1` (statistika) va
// `dnt.lessons.v1` (§9.1 dagi `f`/`l` tiklanishi darslarning GAP MATNIGA
// tayanadi — usiz tiklash mumkin emas).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SHRINKAGE_M, dayNumber } from '../../src/core/wordScore.ts'
import type { SentenceRecord, SessionRecord } from '../../src/store/stats.ts'
// v1 hujjat tipi endi ALOHIDA modulda: `stats.ts` v2 (IndexedDB) API si,
// `statsV1.ts` esa faqat migratsiya va eski zaxira fayllari uchun saqlangan
// o'quvchi (§9). Migratsiya testi ikkalasiga ham tayanadi.
import type { StatsDataV1 as StatsData } from '../../src/store/statsV1.ts'
import { closeDb, deleteDb, openDb, runTx } from '../../src/store/statsDb.ts'
import {
  META_KEY_DECAY_ANCHOR_DAY,
  META_KEY_LIFETIME,
  STORE_DAYS,
  STORE_META,
  STORE_SESSIONS,
  STORE_WORDS,
  dayKeyOf,
  netCharsOf,
} from '../../src/store/statsSchema.ts'
import type { DayRow, LifetimeMeta, WordRow } from '../../src/store/statsSchema.ts'
import {
  META_KEY_V1_MIGRATED_AT,
  buildMigration,
  mergeWordRows,
  migrateV1ToV2,
} from '../../src/store/statsMigrate.ts'

/** Modul ichidagi kalitlarning nusxasi — testda ATAYIN qo'lda takrorlangan. */
const STATS_KEY = 'dnt.stats.v1'
const LESSONS_KEY = 'dnt.lessons.v1'

// ---------------------------------------------------------------------------
// Muhit
// ---------------------------------------------------------------------------

/** Xotiradagi `Storage`: modul faqat `getItem`/`setItem` ni ishlatadi. */
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

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
})

afterEach(async () => {
  vi.unstubAllGlobals()
  closeDb()
  await deleteDb()
})

/** `openDb()` `null` qaytarsa test muhitining o'zi buzuq — darrov yiqiladi. */
async function open(): Promise<IDBDatabase> {
  const db = await openDb()
  if (db === null) throw new Error('test muhitida IndexedDB ochilmadi')
  return db
}

function readAllRows<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return runTx<T[]>(
    db,
    [store],
    'readonly',
    (tx, collect) => {
      const req = tx.objectStore(store).getAll()
      req.onsuccess = () => collect(req.result as T[])
    },
    [],
  )
}

function readRow<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return runTx<T | undefined>(
    db,
    [store],
    'readonly',
    (tx, collect) => {
      const req = tx.objectStore(store).get(key)
      req.onsuccess = () => collect(req.result as T | undefined)
    },
    undefined,
  )
}

/** Bitta so'z qatorini oladi; yo'q bo'lsa test darrov yiqiladi. */
async function word(db: IDBDatabase, w: string): Promise<WordRow> {
  const row = await readRow<WordRow>(db, STORE_WORDS, w)
  if (row === undefined) throw new Error(`'${w}' so'zi ko'chirilmagan`)
  return row
}

async function day(db: IDBDatabase, d: string): Promise<DayRow> {
  const row = await readRow<DayRow>(db, STORE_DAYS, d)
  if (row === undefined) throw new Error(`'${d}' kuni ko'chirilmagan`)
  return row
}

async function lifetimeOf(db: IDBDatabase): Promise<LifetimeMeta> {
  const row = await readRow<LifetimeMeta>(db, STORE_META, META_KEY_LIFETIME)
  if (row === undefined) throw new Error('`meta.lifetime` yozilmagan')
  return row
}

// ---------------------------------------------------------------------------
// Sinov ma'lumoti
// ---------------------------------------------------------------------------

// Lokal TUSH payti: mintaqa ofseti kun chegarasini siljitmasin.
const AT_1 = new Date(2026, 1, 10, 12, 0, 0).getTime()
const AT_2 = new Date(2026, 1, 12, 12, 0, 0).getTime()
/** FAQAT `days` da bor kun — omon qolgan seansi YO'Q (§4.2, §4.3). */
const AT_OLD = new Date(2025, 0, 5, 12, 0, 0).getTime()

const DAY_1 = dayNumber(AT_1)
const DAY_2 = dayNumber(AT_2)
const KEY_1 = dayKeyOf(AT_1)
const KEY_2 = dayKeyOf(AT_2)
const KEY_OLD = dayKeyOf(AT_OLD)

const L1 = 'l1'
const L1_SENTENCES = ['The quick fox.', 'Slow bear runs away.']
/** Dars O'CHIRILGAN: seansi omon qolgan, matni esa yo'q (§9.1). */
const L2 = 'l2-deleted'

/** Bitta gap yozuvi — sinovga aloqasi yo'q maydonlar hamma yerda bir xil. */
function rec(over: Partial<SentenceRecord> & { sentenceIndex: number; at: number }): SentenceRecord {
  return {
    activeMs: 60_000,
    keystrokes: 100,
    correctKeystrokes: 95,
    netWpm: 40,
    rawWpm: 45,
    accuracy: 0.95,
    restarts: 0,
    skipped: false,
    ...over,
  }
}

function session(
  id: string,
  lessonId: string,
  endedAt: number,
  sentences: SentenceRecord[],
): SessionRecord {
  return {
    id,
    lessonId,
    lessonTitle: lessonId,
    startedAt: endedAt - 60_000,
    endedAt,
    sentences,
    activeMs: 60_000 * sentences.filter((s) => !s.skipped).length,
    keystrokes: 100 * sentences.filter((s) => !s.skipped).length,
    correctKeystrokes: 95 * sentences.filter((s) => !s.skipped).length,
    netWpm: 40,
    rawWpm: 45,
    accuracy: 0.95,
  }
}

/**
 * Asosiy fikstura.
 *
 * `s1` — darsi bor seans (`f`/`l` tiklanadi), ikkinchi gapi `skipped`;
 * `s2` — o'sha dars, boshqa kun; `s3` — darsi O'CHIRILGAN seans.
 * `ghost` so'zi faqat o'chirilgan darsda uchraydi, `orphan` esa hech qayerda.
 */
function fixture(): StatsData {
  return {
    version: 1,
    sessions: [
      session(
        's1',
        L1,
        AT_1,
        [
          rec({ sentenceIndex: 0, at: AT_1, audioEnabled: true }),
          // ⚠️ `skipped`: bu gap na `f`/`l` ga, na `k`/`nc`/chelakka qo'shiladi.
          rec({ sentenceIndex: 1, at: AT_1, skipped: true, audioEnabled: true }),
        ],
      ),
      session(
        's2',
        L1,
        AT_2,
        [
          rec({ sentenceIndex: 1, at: AT_2, audioEnabled: false }),
          // `audioEnabled` YO'Q — `unknown` chelagiga tushishi kerak.
          rec({ sentenceIndex: 0, at: AT_2 }),
        ],
      ),
      session('s3', L2, AT_2, [rec({ sentenceIndex: 0, at: AT_2, audioEnabled: true })]),
    ],
    words: {
      the: { exposures: 50, errors: 10 },
      quick: { exposures: 8, errors: 2 },
      fox: { exposures: 8, errors: 0 },
      slow: { exposures: 4, errors: 1 },
      bear: { exposures: 4, errors: 1 },
      runs: { exposures: 4, errors: 1 },
      away: { exposures: 4, errors: 1 },
      ghost: { exposures: 30, errors: 3 },
      orphan: { exposures: 7, errors: 7 },
    },
    days: {
      [KEY_OLD]: { correctKeystrokes: 500, activeMs: 999_000, sentences: 5 },
      [KEY_1]: { correctKeystrokes: 95, activeMs: 60_000, sentences: 1 },
      [KEY_2]: { correctKeystrokes: 285, activeMs: 180_000, sentences: 3 },
    },
  }
}

function seedV1(data: StatsData): void {
  localStorage.setItem(STATS_KEY, JSON.stringify(data))
}

/** `dnt.lessons.v1` — `getLesson` shu kalitdan o'qiydi. */
function seedLessons(lessons: Array<{ id: string; sentences: string[] }>): void {
  localStorage.setItem(
    LESSONS_KEY,
    JSON.stringify(
      lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.id,
        createdAt: 1,
        originalText: lesson.sentences.join(' '),
        normalizedText: lesson.sentences.join(' '),
        sentences: lesson.sentences,
        progress: 0,
        voice: 'en-US',
        rate: 1,
      })),
    ),
  )
}

/** Odatiy boshlanish: to'liq fikstura + FAQAT `l1` darsi (l2 o'chirilgan). */
function seedAll(): void {
  seedV1(fixture())
  seedLessons([{ id: L1, sentences: L1_SENTENCES }])
}

// ---------------------------------------------------------------------------
// §9 — asosiy oqim va idempotentlik
// ---------------------------------------------------------------------------

describe('migrateV1ToV2 — asosiy oqim (§9)', () => {
  it('bo\'sh bazada `no-v1-data` qaytaradi, lekin MARKER baribir yoziladi', async () => {
    const result = await migrateV1ToV2()

    expect(result).toEqual({ ok: true, migrated: false, reason: 'no-v1-data' })

    const db = await open()
    // Marker bo'lmasa har boot'da v1 hujjati bekorga qayta o'qilardi.
    expect(await readRow<number>(db, STORE_META, META_KEY_V1_MIGRATED_AT)).toBeTypeOf('number')
  })

  it('to\'liq v1 ombori ko\'chiriladi va sanoq qaytariladi', async () => {
    seedAll()

    const result = await migrateV1ToV2()

    expect(result).toEqual({ ok: true, migrated: true, words: 9, days: 3, sessions: 3 })
  })

  it('seanslar gap yozuvlari BILAN `sessions` do\'koniga ko\'chiriladi (§4.4)', async () => {
    seedAll()
    await migrateV1ToV2()

    const db = await open()
    const rows = await readAllRows<SessionRecord>(db, STORE_SESSIONS)

    expect(rows.map((row) => row.id).sort()).toEqual(['s1', 's2', 's3'])
    const s1 = rows.find((row) => row.id === 's1')
    expect(s1?.sentences).toHaveLength(2)
    expect(s1?.sentences[0]?.keystrokes).toBe(100)
    // `skipped` gap ham SAQLANADI — u faqat yig'indilarga qo'shilmaydi.
    expect(s1?.sentences[1]?.skipped).toBe(true)
  })

  it('IDEMPOTENT: ikkinchi chaqiruv `already-migrated`, qiymatlar IKKILANMAYDI', async () => {
    seedAll()
    await migrateV1ToV2()

    const db = await open()
    const before = {
      the: await word(db, 'the'),
      day1: await day(db, KEY_1),
      lifetime: await lifetimeOf(db),
      words: (await readAllRows<WordRow>(db, STORE_WORDS)).length,
      sessions: (await readAllRows<SessionRecord>(db, STORE_SESSIONS)).length,
    }

    const second = await migrateV1ToV2()

    expect(second).toEqual({ ok: true, migrated: false, reason: 'already-migrated' })
    expect(await word(db, 'the')).toEqual(before.the)
    expect(await day(db, KEY_1)).toEqual(before.day1)
    expect(await lifetimeOf(db)).toEqual(before.lifetime)
    expect((await readAllRows<WordRow>(db, STORE_WORDS)).length).toBe(before.words)
    expect((await readAllRows<SessionRecord>(db, STORE_SESSIONS)).length).toBe(before.sessions)
  })

  it('migratsiyadan KEYINGI jonli yozuv ikkinchi chaqiruvda BOSILMAYDI', async () => {
    seedAll()
    await migrateV1ToV2()

    const db = await open()
    const live: WordRow = { ...(await word(db, 'the')), e: 999, x: 111 }
    await runTx(db, [STORE_WORDS], 'readwrite', (tx) => {
      tx.objectStore(STORE_WORDS).put(live)
    })

    await migrateV1ToV2()

    // Marker bo'lmaganida v1 ning `e: 50` si jonli qatorni ustidan yozib,
    // oradagi butun mashqni yo'q qilardi.
    expect((await word(db, 'the')).e).toBe(999)
  })

  it('v1 `localStorage` kaliti O\'CHIRILMAYDI (§9.3 — orqaga qaytish oynasi)', async () => {
    seedAll()
    await migrateV1ToV2()

    expect(localStorage.getItem(STATS_KEY)).not.toBeNull()
  })

  it('IndexedDB yo\'q bo\'lsa `no-idb`, TASHLAMAYDI (§8.4d)', async () => {
    seedAll()
    vi.stubGlobal('indexedDB', undefined)

    await expect(migrateV1ToV2()).resolves.toEqual({
      ok: true,
      migrated: false,
      reason: 'no-idb',
    })
  })
})

// ---------------------------------------------------------------------------
// ⭐ §9.1 — `f`/`l` ni omon qolgan seanslardan tiklash
// ---------------------------------------------------------------------------

describe('§9.1 — `f`/`l` tiklanishi', () => {
  it('darsi MAVJUD seansdagi so\'zlar sanaga ega bo\'ladi (`l` = max, `f` = min)', async () => {
    seedAll()
    await migrateV1ToV2()
    const db = await open()

    // `The quick fox.` ikkala kunda ham terilgan -> f = eng erta, l = eng kech.
    for (const w of ['the', 'quick', 'fox']) {
      const row = await word(db, w)
      expect(row.f).toBe(DAY_1)
      expect(row.l).toBe(DAY_2)
    }
  })

  it('`skipped` gap tiklashga HISSA QO\'SHMAYDI', async () => {
    seedAll()
    await migrateV1ToV2()
    const db = await open()

    // `Slow bear runs away.` `s1` da `skipped`, `s2` da terilgan -> faqat DAY_2.
    for (const w of ['slow', 'bear', 'runs', 'away']) {
      const row = await word(db, w)
      expect(row.f).toBe(DAY_2)
      expect(row.l).toBe(DAY_2)
    }
  })

  it('darsi YO\'Q seansdagi so\'z `f`/`l` SIZ qoladi — migratsiya sanasi EMAS', async () => {
    seedAll()
    await migrateV1ToV2()
    const db = await open()

    const ghost = await word(db, 'ghost')
    expect(ghost.f).toBeUndefined()
    expect(ghost.l).toBeUndefined()
    // Maydon `undefined` emas, UMUMAN YO'Q: `by_l` indeksiga tushmasligi shart.
    expect('f' in ghost).toBe(false)
    expect('l' in ghost).toBe(false)
    // Qolgan hisoblagichlar esa joyida — seans o'zi ko'chirilgan.
    expect(ghost.e).toBe(30)
  })

  it('hech qaysi seansda uchramagan so\'z ham `f`/`l` siz qoladi', async () => {
    seedAll()
    await migrateV1ToV2()
    const db = await open()

    const orphan = await word(db, 'orphan')
    expect('f' in orphan).toBe(false)
    expect('l' in orphan).toBe(false)
  })

  it('darsi o\'chirilgan seans migratsiyani YIQITMAYDI', async () => {
    // Umuman dars yo'q: `getLesson` hamma seans uchun `null` qaytaradi.
    seedV1(fixture())

    const result = await migrateV1ToV2()

    expect(result).toEqual({ ok: true, migrated: true, words: 9, days: 3, sessions: 3 })
    const db = await open()
    expect('l' in (await word(db, 'the'))).toBe(false)
  })

  it('saqlangan v1 `f`/`l` KO\'CHIRILADI va tiklash uni faqat kengaytiradi', async () => {
    const data = fixture()
    // M0+M1 dan keyin yozilgan qator: sanasi allaqachon HAQIQIY.
    data.words['the'] = { exposures: 50, errors: 10, f: DAY_1 - 100, l: DAY_1 }
    seedV1(data)
    seedLessons([{ id: L1, sentences: L1_SENTENCES }])

    await migrateV1ToV2()
    const db = await open()

    const row = await word(db, 'the')
    expect(row.f).toBe(DAY_1 - 100) // Seanslardagi eng erta kun undan KEYIN.
    expect(row.l).toBe(DAY_2) // Seanslardagi eng kech kun undan KEYIN.
  })
})

// ---------------------------------------------------------------------------
// §6.5 / §4.1 — so'z qatorining qolgan maydonlari
// ---------------------------------------------------------------------------

describe('so\'z qatori (§4.1, §6.5)', () => {
  it('`de`/`dx` v1 dan KO\'CHIRILADI (v1 parseri ularni allaqachon urug\'lantirgan)', async () => {
    seedAll()
    await migrateV1ToV2()
    const db = await open()

    // `parseStats` `de = min(e, m)`, `dx = x·de/e` beradi: 50 -> 20, 10·20/50 = 4.
    const row = await word(db, 'the')
    expect(row.de).toBe(SHRINKAGE_M)
    expect(row.dx).toBeCloseTo(4, 10)
    expect(row.e).toBe(50)
    expect(row.x).toBe(10)
  })

  it('§2.5: KATTA HARFLI v1 kaliti normallashtiriladi va `f`/`l` tiklanishi ENDI ishlaydi', async () => {
    const data = fixture()
    // `parseStats` kalitni O'QISHDA kichik harfga keltirmaydi, ya'ni bunday
    // qator `importJson` orqali v1 omboriga haqiqatan tushishi mumkin.
    delete data.words['the']
    data.words['The'] = { exposures: 50, errors: 10 }
    seedV1(data)
    seedLessons([{ id: L1, sentences: L1_SENTENCES }])

    await migrateV1ToV2()
    const db = await open()

    // Kalit `'the'` — `'The'` EMAS: IDB birlamchi kaliti o'zgarmas, shuning
    // uchun buni faqat shu yerda tuzatish mumkin edi.
    expect(await readRow<WordRow>(db, STORE_WORDS, 'The')).toBeUndefined()
    const row = await word(db, 'the')
    expect(row.e).toBe(50)
    // `tokenize` natijasi `token.text.toLowerCase()` bilan endi MOS tushadi.
    expect(row.f).toBe(DAY_1)
    expect(row.l).toBe(DAY_2)
  })

  it('`s`/`b` NOL: seriyani omon qolgan seanslardan tiklab bo\'lmaydi', async () => {
    seedAll()
    await migrateV1ToV2()
    const db = await open()

    const row = await word(db, 'the')
    expect(row.s).toBe(0)
    expect(row.b).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// ⭐ §4.3 — `meta.lifetime` maydonma-maydon
// ---------------------------------------------------------------------------

describe('§4.3 — `meta.lifetime`', () => {
  it('`activeMs`/`correctKeystrokes` `days` YIG\'INDISIGA teng (seanslarga EMAS)', async () => {
    seedAll()
    await migrateV1ToV2()
    const db = await open()

    const lifetime = await lifetimeOf(db)

    // `days` yig'indisi: 999_000 + 60_000 + 180_000. Omon qolgan seanslar
    // esa atigi 4 ta `skipped` bo'lmagan gap = 240_000 ms beradi — ya'ni
    // seanslardan urug'lantirish soni 5 barobar KAM chiqarardi.
    expect(lifetime.activeMs).toBe(1_239_000)
    expect(lifetime.correctKeystrokes).toBe(880)
    const sessionActiveMs = 4 * 60_000
    expect(lifetime.activeMs).not.toBe(sessionActiveMs)
  })

  it('`activeMs`/`correctKeystrokes` da `*Since` YO\'Q, qolgan uchtasida BOR', async () => {
    seedAll()
    await migrateV1ToV2()
    const db = await open()

    const lifetime = await lifetimeOf(db)

    // Aynan shu sakkizta kalit: `activeMsSince`/`correctKeystrokesSince` YO'Q
    // (ular `days` dan ANIQ bilinadi), qolgan uchtasi esa sanaga bog'langan.
    expect(Object.keys(lifetime).sort()).toEqual([
      'activeMs',
      'correctKeystrokes',
      'keystrokes',
      'keystrokesSince',
      'netChars',
      'netCharsSince',
      'sessions',
      'sessionsSince',
    ])
    expect(lifetime.sessionsSince).toBe(DAY_1)
    expect(lifetime.keystrokesSince).toBe(DAY_1)
    expect(lifetime.netCharsSince).toBe(DAY_1)
  })

  it('`sessions`/`keystrokes`/`netChars` faqat omon qolgan seanslardan', async () => {
    seedAll()
    await migrateV1ToV2()
    const db = await open()

    const lifetime = await lifetimeOf(db)

    expect(lifetime.sessions).toBe(3)
    expect(lifetime.keystrokes).toBe(4 * 100) // `skipped` gap KIRMAYDI.
    expect(lifetime.netChars).toBeCloseTo(4 * netCharsOf(40, 60_000), 10)
  })

  it('seans yo\'q bo\'lsa `*Since` maydonlari QO\'YILMAYDI', async () => {
    seedV1({
      version: 1,
      sessions: [],
      words: { the: { exposures: 5, errors: 1 } },
      days: { [KEY_OLD]: { correctKeystrokes: 500, activeMs: 999_000, sentences: 5 } },
    })
    await migrateV1ToV2()
    const db = await open()

    const lifetime = await lifetimeOf(db)

    expect(Object.keys(lifetime).sort()).toEqual([
      'activeMs',
      'correctKeystrokes',
      'keystrokes',
      'netChars',
      'sessions',
    ])
    expect(lifetime.activeMs).toBe(999_000)
    expect(lifetime.sessions).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// §4.2 — `days` ko'chirish
// ---------------------------------------------------------------------------

describe('§4.2 — `days`', () => {
  it('baza uchtasi v1 `days` dan TO\'G\'RIDAN-TO\'G\'RI (seanslardan qayta hisoblanmaydi)', async () => {
    seedAll()
    await migrateV1ToV2()
    const db = await open()

    const row = await day(db, KEY_2)

    // Seanslarda bu kunga 3 ta gap bor (3 × 95 = 285) — lekin son SEANSDAN
    // emas, v1 `days` dan olinadi. Ular teng bo'lishi shart emas.
    expect(row.correctKeystrokes).toBe(285)
    expect(row.activeMs).toBe(180_000)
    expect(row.sentences).toBe(3)
  })

  it('`k`/`nc` FAQAT seanslardan hisoblanadi', async () => {
    seedAll()
    await migrateV1ToV2()
    const db = await open()

    const first = await day(db, KEY_1)
    expect(first.k).toBe(100) // `skipped` gap KIRMAYDI (aks holda 200 bo'lardi).
    expect(first.nc).toBeCloseTo(netCharsOf(40, 60_000), 10)

    const second = await day(db, KEY_2)
    expect(second.k).toBe(300)
    expect(second.nc).toBeCloseTo(3 * netCharsOf(40, 60_000), 10)
  })

  it('omon qolgan seansi YO\'Q kunda `k`/`nc`/chelaklar `undefined` QOLADI', async () => {
    seedAll()
    await migrateV1ToV2()
    const db = await open()

    const row = await day(db, KEY_OLD)

    // Yo'q maydon ≠ nol: bu kun "abadiy taqribiy trendda qoladi" (§4.2).
    expect(Object.keys(row).sort()).toEqual(['activeMs', 'correctKeystrokes', 'd', 'sentences'])
    expect(row.activeMs).toBe(999_000)
  })

  it('`audioEnabled` yo\'q gap `unknown` ga tushadi, `on`/`off` ga EMAS', async () => {
    seedAll()
    await migrateV1ToV2()
    const db = await open()

    const row = await day(db, KEY_2)

    expect(row.unknown).toBe(1)
    expect(row.on?.sentences).toBe(1) // `s3` (dars o'chirilgan bo'lsa ham).
    expect(row.off?.sentences).toBe(1)
    // Chelaklarga tushgan gaplar soni `unknown` bilan birga 3 ta bo'lishi shart.
    expect((row.on?.sentences ?? 0) + (row.off?.sentences ?? 0) + (row.unknown ?? 0)).toBe(3)
  })

  it('chelakda tezliklar `activeMs` ga OG\'IRLANGAN yig\'indi bo\'lib yotadi', async () => {
    seedAll()
    await migrateV1ToV2()
    const db = await open()

    const row = await day(db, KEY_1)

    expect(row.on).toEqual({
      sentences: 1,
      activeMs: 60_000,
      keystrokes: 100,
      correctKeystrokes: 95,
      netWeighted: 40 * 60_000,
      rawWeighted: 45 * 60_000,
    })
    expect(row.off).toBeUndefined()
    expect(row.unknown).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// SOF `buildMigration` — IndexedDB'siz
// ---------------------------------------------------------------------------

describe('buildMigration (SOF, IDB\'siz)', () => {
  const lessons = new Map<string, readonly string[]>([[L1, L1_SENTENCES]])

  function empty(): StatsData {
    return { version: 1, sessions: [], words: {}, days: {} }
  }

  it('bo\'sh hujjatdan bo\'sh reja chiqadi', () => {
    const plan = buildMigration(empty(), new Map())

    expect(plan.words).toEqual([])
    expect(plan.days).toEqual([])
    expect(plan.sessions).toEqual([])
    expect(plan.lifetime).toEqual({
      activeMs: 0,
      correctKeystrokes: 0,
      netChars: 0,
      sessions: 0,
      keystrokes: 0,
    })
  })

  it('§6.5: `de`/`dx` yo\'q qator urug\'lantiriladi (`de = min(e, m)`, `dx = x·de/e`)', () => {
    const data = empty()
    data.words['big'] = { exposures: 50, errors: 10 }
    data.words['small'] = { exposures: 8, errors: 2 }

    const rows = buildMigration(data, new Map()).words
    const big = rows.find((row) => row.w === 'big')
    const small = rows.find((row) => row.w === 'small')

    expect(big?.de).toBe(SHRINKAGE_M)
    expect(big?.dx).toBeCloseTo(10 * (SHRINKAGE_M / 50), 10)
    // `e < m` bo'lganda `de = e` va `dx = x` — umrbod nisbat AYNAN saqlanadi.
    expect(small?.de).toBe(8)
    expect(small?.dx).toBeCloseTo(2, 10)
  })

  it('saqlangan `de`/`dx` urug\'lantirishni BOSADI', () => {
    const data = empty()
    data.words['big'] = { exposures: 50, errors: 10, de: 3.5, dx: 1.25 }

    const row = buildMigration(data, new Map()).words[0]

    expect(row?.de).toBe(3.5)
    expect(row?.dx).toBe(1.25)
  })

  it('§2.5: to\'qnashgan kalitlar BITTA qatorga birlashadi, hisoblagichlar QO\'SHILADI', () => {
    const data = empty()
    data.words['The'] = { exposures: 10, errors: 2 }
    data.words['the'] = { exposures: 5, errors: 1 }

    const rows = buildMigration(data, new Map()).words

    expect(rows).toHaveLength(1)
    expect(rows[0]?.w).toBe('the')
    expect(rows[0]?.e).toBe(15)
    expect(rows[0]?.x).toBe(3)
    // Urug'lantirilgan so'nuvchi hisoblagichlar ham qo'shiladi: 10 + 5, 2 + 1.
    expect(rows[0]?.de).toBe(15)
    expect(rows[0]?.dx).toBeCloseTo(3, 10)
  })

  it('§2.5: birlashganda `f` = MINIMUM, `l` = MAKSIMUM (biri yo\'q bo\'lsa mavjudi g\'olib)', () => {
    const data = empty()
    data.words['The'] = { exposures: 10, errors: 2, f: 100, l: 200 }
    data.words['the'] = { exposures: 5, errors: 1, l: 300 } // `f` YO'Q.

    const row = buildMigration(data, new Map()).words[0]

    expect(row?.f).toBe(100) // Faqat bittasida bor -> o'sha g'olib.
    expect(row?.l).toBe(300) // Ikkalasida bor -> eng kech kun.
  })

  it('§2.5: ikkala qatorda ham `f`/`l` yo\'q bo\'lsa maydon UMUMAN qo\'shilmaydi', () => {
    const data = empty()
    data.words['The'] = { exposures: 10, errors: 2 }
    data.words['the'] = { exposures: 5, errors: 1 }

    const row = buildMigration(data, new Map()).words[0]

    expect(row === undefined ? null : 'f' in row).toBe(false)
    expect(row === undefined ? null : 'l' in row).toBe(false)
  })

  it('§2.5: birlashtirgandan keyin `x <= e` va `dx <= de` invariantlari saqlanadi', () => {
    const data = empty()
    // v1 parseridan O'TMAGAN hujjat: `errors > exposures`.
    data.words['The'] = { exposures: 1, errors: 5 }
    data.words['the'] = { exposures: 1, errors: 5 }

    const row = buildMigration(data, new Map()).words[0]

    expect(row?.e).toBe(2)
    expect(row?.x).toBe(2) // 10 emas: `dx > de` ball shkalasini 1 dan oshirardi.
    expect(row?.de).toBe(2)
    expect(row?.dx).toBe(2)
  })

  it('§2.5: bo\'sh va faqat bo\'shliqdan iborat kalit TASHLANADI', () => {
    const data = empty()
    data.words[''] = { exposures: 3, errors: 1 }
    data.words['   '] = { exposures: 3, errors: 1 }
    data.words[' the '] = { exposures: 4, errors: 1 }

    const rows = buildMigration(data, new Map()).words

    // `trim()` ham `recordSession` qoidasining bir qismi.
    expect(rows.map((row) => row.w)).toEqual(['the'])
    expect(rows[0]?.e).toBe(4)
  })

  it('kirish hujjatini O\'ZGARTIRMAYDI (sof)', () => {
    const data = fixture()
    const snapshot = JSON.parse(JSON.stringify(data)) as StatsData

    buildMigration(data, lessons)

    expect(data).toEqual(snapshot)
  })

  it('bir xil kirishda natija DETERMINIK', () => {
    expect(buildMigration(fixture(), lessons)).toEqual(buildMigration(fixture(), lessons))
  })

  it('v1 `days` da BO\'LMAGAN kun uchun baza uchtasi NOL bilan qoladi', () => {
    const data = empty()
    data.sessions = [session('s1', L1, AT_1, [rec({ sentenceIndex: 0, at: AT_1 })])]

    const row = buildMigration(data, lessons).days[0]

    // Baza uchtasining YAGONA manbasi — v1 `days`. Uni seansdan to'ldirish
    // o'sha kun v1 da bo'lganida IKKILANISHGA olib kelardi.
    expect(row?.d).toBe(KEY_1)
    expect(row?.correctKeystrokes).toBe(0)
    expect(row?.activeMs).toBe(0)
    expect(row?.sentences).toBe(0)
    expect(row?.k).toBe(100)
  })

  it('so\'z jadvalida YO\'Q so\'z uchun qator YARATILMAYDI', () => {
    const data = empty()
    data.sessions = [session('s1', L1, AT_1, [rec({ sentenceIndex: 0, at: AT_1 })])]

    // `The quick fox.` dagi so'zlar v1 jadvalida yo'q -> `words` bo'sh qoladi:
    // `e: 0` li qator §6.5 ning `e > 0` invariantini buzardi.
    expect(buildMigration(data, lessons).words).toEqual([])
  })

  it('dars QISQARGAN bo\'lsa (gap indeksi chegaradan tashqarida) yiqilmaydi', () => {
    const data = empty()
    data.words['the'] = { exposures: 5, errors: 1 }
    data.sessions = [session('s1', L1, AT_1, [rec({ sentenceIndex: 99, at: AT_1 })])]

    const plan = buildMigration(data, lessons)

    expect(plan.words[0]?.l).toBeUndefined()
    // Kunlik hissa esa SAQLANADI: gap matni yo'qolgani `k`/`nc` ga daxlsiz.
    expect(plan.days[0]?.k).toBe(100)
  })

  it('⭐ v1 dagi `seedAnchorDay` rejaga KO\'CHIRILADI', () => {
    const data = empty()
    data.words['the'] = { exposures: 5, errors: 1 }
    data.seedAnchorDay = DAY_1

    expect(buildMigration(data, lessons).seedAnchorDay).toBe(DAY_1)
  })

  it('v1 da langar bo\'lmasa reja ham LANGARSIZ qoladi (uni `writePlan` qo\'yadi)', () => {
    const data = empty()
    data.words['the'] = { exposures: 5, errors: 1 }

    expect(buildMigration(data, lessons).seedAnchorDay).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ⭐ SO'NISH LANGARI (`PLAN.md` §11.3, 4-invariant)
// ---------------------------------------------------------------------------

describe("so'nish langari — `decayAnchorDay`", () => {
  it("⭐ `l` si YO'Q qatorlar uchun langar YOZILADI — usiz ular v2 da ABADIY muzlardi", async () => {
    seedAll()
    await migrateV1ToV2()

    const db = await open()
    const anchor = await readRow<number>(db, STORE_META, META_KEY_DECAY_ANCHOR_DAY)

    // `orphan` hech qaysi seansda uchramaydi, ya'ni `l` si YO'Q (yuqoridagi
    // §9.1 testi buni mixlagan). Uning urug'lantirilgan `de`/`dx` i so'nishi
    // uchun yagona asos — shu langar.
    expect((await word(db, 'orphan')).l).toBeUndefined()
    expect(anchor).toBeTypeOf('number')
    // Langar KUN raqami (ms EMAS): o'qish yo'li `dt` ni kunlarda hisoblaydi.
    expect(anchor).toBe(dayNumber(Date.now()))
  })

  it("⭐ v1 dagi `seedAnchorDay` migratsiya sanasidan AFZAL — u erta va haqiqiyroq", async () => {
    const data = fixture()
    // M0+M1 ombori urug'lantirishni AYNAN shu kuni bajargan edi.
    data.seedAnchorDay = DAY_1
    seedV1(data)
    seedLessons([{ id: L1, sentences: L1_SENTENCES }])

    await migrateV1ToV2()

    const db = await open()
    // Migratsiya kuni bilan almashtirilsa oradagi butun so'nish BEKOR bo'lar,
    // fossil qatorlar yana bir marta "yangi" bo'lib chiqardi.
    expect(await readRow<number>(db, STORE_META, META_KEY_DECAY_ANCHOR_DAY)).toBe(DAY_1)
    expect(DAY_1).toBeLessThan(dayNumber(Date.now()))
  })

  it("langar ko'rsatiladigan sanaga TEGMAYDI: `l`/`f` hamon NOMA'LUM qoladi (§9.1)", async () => {
    seedAll()
    await migrateV1ToV2()

    const db = await open()
    const orphan = await word(db, 'orphan')

    // ⚠️ Ajratishning butun mag'zi: langar SO'NISH uchun, ko'rsatish uchun EMAS.
    // Maydonlar UMUMAN yo'q — shundagina `by_l` indeksiga tushmaydi va UI da
    // "noma'lum (migratsiyagacha)" deb chiziladi.
    expect('l' in orphan).toBe(false)
    expect('f' in orphan).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ⚠️ MIGRATSIYA OYNASIDAGI POYGA (ko'rikning "JIDDIY 2" topilmasi)
// ---------------------------------------------------------------------------
//
// `migrateV1ToV2()` ning yozuv tranzaksiyasi `loadStatsV1()` + `buildMigration()`
// TUGAGANDAN KEYIN ochiladi, ular esa 2 MB hujjat uchun o'nlab ms yeydi. O'sha
// oynada omborga tushgan JONLI qator — agar `writePlan` ko'r `put()` qilsa —
// butunlay ustidan yozilardi: seans qatori diskda qolib, uning so'z/kun/umrbod
// hissasi yo'qolardi.
//
// ⭐ TEST HOLATNI SINAYDI, TAYMERNI EMAS. Poyganing kuzatiladigan natijasi
// bitta: "marker HALI YO'Q, lekin do'konlarda jonli qatorlar BOR". Testlar
// aynan shu holatni qo'yadi va migratsiyani undan keyin ishga tushiradi.
// Ikkita va'dani haqiqiy vaqtda musobaqalashtirish ayni shartni tekshirib,
// ustiga `fake-indexeddb` navbatiga bog'liq beqarorlik qo'shardi.
//
// ⚠️ BU HOLAT `writeSentences` DAGI QOROVULDAN KEYIN HAM YETIB BORILADIGAN
// (`stats.ts`, §9 qorovuli). Qorovul TAB ICHIDA tartib beradi; bu yerda esa
// ikkita boshqa yo'l qoladi:
//   (a) IKKINCHI TAB — uning migratsiyasi va yozuvi mustaqil, qorovul
//       ular orasida hech narsa kafolatlamaydi;
//   (b) YIQILGAN MIGRATSIYA — qorovul yozuvni O'TKAZIB YUBORADI (ombor
//       nosozligi foydalanuvchining mashqini yeb qo'ymasin), ya'ni keyingi
//       urinish aynan shu "jonli qator bor, marker yo'q" holatini ko'radi.
describe("⚠️ migratsiya oynasidagi yozuv — `writePlan` o'qi-birlashtir-yoz", () => {
  const RACE_LESSON = 'race-l1'
  const RACE_SENTENCES = ['Alpha beta gamma.']

  /** v1 ombori: bitta so'z (10 ta'sirlanish) va bitta kun (900 to'g'ri bosish). */
  function raceV1(over: Partial<StatsData> = {}): StatsData {
    return {
      version: 1,
      sessions: [],
      words: { alpha: { exposures: 10, errors: 2 } },
      days: { [KEY_1]: { correctKeystrokes: 900, activeMs: 600_000, sentences: 9 } },
      ...over,
    }
  }

  /**
   * Migratsiya oynasida `writeSentences` qoldirgan qatorlar.
   *
   * `*Since` uchtasi BUGUNGA qo'yilgan — bu `lifetimeForWrite` ning ta'mir
   * shoxi: konvert hali yo'q edi, ya'ni yozuv "shu kundan beri" degan belgini
   * o'zi qo'yishga majbur.
   */
  const LIVE_WORD: WordRow = { w: 'alpha', e: 1, x: 0, de: 1, dx: 0, s: 1, b: 1, f: DAY_1, l: DAY_1 }
  const LIVE_DAY: DayRow = {
    d: KEY_1,
    correctKeystrokes: 48,
    activeMs: 60_000,
    sentences: 1,
    k: 50,
    nc: 48,
  }
  const LIVE_LIFETIME: LifetimeMeta = {
    activeMs: 60_000,
    correctKeystrokes: 48,
    netChars: 48,
    sessions: 1,
    keystrokes: 50,
    netCharsSince: DAY_1,
    sessionsSince: DAY_1,
    keystrokesSince: DAY_1,
  }

  /** Do'konlarga TO'G'RIDAN-TO'G'RI yozadi — "boshqa yozuvchi ulgurdi" holati. */
  async function seedLive(data: {
    words?: readonly WordRow[]
    days?: readonly DayRow[]
    sessions?: readonly SessionRecord[]
    lifetime?: LifetimeMeta
  }): Promise<void> {
    const db = await open()
    await runTx(db, [STORE_WORDS, STORE_DAYS, STORE_SESSIONS, STORE_META], 'readwrite', (tx) => {
      for (const row of data.words ?? []) tx.objectStore(STORE_WORDS).put(row)
      for (const row of data.days ?? []) tx.objectStore(STORE_DAYS).put(row)
      for (const row of data.sessions ?? []) tx.objectStore(STORE_SESSIONS).put(row)
      if (data.lifetime !== undefined) {
        tx.objectStore(STORE_META).put(data.lifetime, META_KEY_LIFETIME)
      }
    })
  }

  it("⭐ ko'rikning aynan stsenariysi: 11 ta'sirlanish / 948 to'g'ri bosish / 1 seans", async () => {
    seedV1(raceV1())
    seedLessons([{ id: RACE_LESSON, sentences: RACE_SENTENCES }])
    await seedLive({
      words: [LIVE_WORD],
      days: [LIVE_DAY],
      sessions: [session('live-1', RACE_LESSON, AT_1, [rec({ sentenceIndex: 0, at: AT_1 })])],
      lifetime: LIVE_LIFETIME,
    })

    await migrateV1ToV2()

    const db = await open()
    // ⚠️ KO'R `put()` DA BU SONLAR 10 / 900 / 0 CHIQADI — jonli qatorlar
    // butunlay almashtirilib, faqat v1 tarixi qolardi. Uchalasi ham
    // foydalanuvchi ekranda ko'radigan raqam: `hardestWords` ta'sirlanishi,
    // bugungi to'g'ri bosishlar va `totals().sessions`.
    expect((await word(db, 'alpha')).e).toBe(11)
    expect((await day(db, KEY_1)).correctKeystrokes).toBe(948)
    expect((await lifetimeOf(db)).sessions).toBe(1)
  })

  it("umrbod konvertning QOLGAN maydonlari ham qo'shiladi, `max()` bilan olinmaydi", async () => {
    seedV1(raceV1())
    seedLessons([{ id: RACE_LESSON, sentences: RACE_SENTENCES }])
    await seedLive({ lifetime: LIVE_LIFETIME })

    await migrateV1ToV2()

    const lifetime = await lifetimeOf(await open())
    // v1 `days` dan: 900 to'g'ri bosish, 600 000 ms; jonlidan: 48 va 60 000.
    expect(lifetime.correctKeystrokes).toBe(948)
    expect(lifetime.activeMs).toBe(660_000)
    // v1 da omon qolgan seans YO'Q, ya'ni `netChars`/`keystrokes` ning yagona
    // manbasi — jonli yozuv. `max()` bo'lganida ular saqlanardi, lekin
    // `sessions` (1 vs 0) YO'QOLARDI — farq aynan shu yerda ko'rinadi.
    expect(lifetime.netChars).toBe(48)
    expect(lifetime.keystrokes).toBe(50)
  })

  it("kun qatorining `k`/`nc`/chelaklari QO'SHILADI — ALMASHTIRILMAYDI", async () => {
    // v1 da AYNI kunda omon qolgan seans bor, ya'ni rejadagi kun qatorida ham
    // `k`/`nc` va `on` chelagi chiqadi: ikkala tomon ham to'la.
    seedV1(
      raceV1({
        sessions: [session('v1-1', RACE_LESSON, AT_1, [rec({ sentenceIndex: 0, at: AT_1, audioEnabled: true })])],
      }),
    )
    seedLessons([{ id: RACE_LESSON, sentences: RACE_SENTENCES }])
    await seedLive({
      days: [
        {
          ...LIVE_DAY,
          off: {
            sentences: 1,
            activeMs: 60_000,
            keystrokes: 50,
            correctKeystrokes: 48,
            netWeighted: 24 * 60_000,
            rawWeighted: 25 * 60_000,
          },
        },
      ],
    })

    const expectedNc = netCharsOf(40, 60_000)
    await migrateV1ToV2()

    const row = await day(await open(), KEY_1)
    expect(row.k).toBe(50 + 100)
    expect(row.nc).toBe(48 + expectedNc)
    // Chelaklar HAR IKKALASI saqlanadi: jonli yozuv ovozsiz, v1 seansi ovozli.
    expect(row.off?.sentences).toBe(1)
    expect(row.on?.sentences).toBe(1)
  })

  it("so'z qatorida `f` eng ERTA, `l` eng KECH kunni oladi", async () => {
    // v1 seansi ERTAROQ kunda (`AT_1`), jonli yozuv esa KECHROQ (`AT_2`).
    seedV1(
      raceV1({
        sessions: [session('v1-1', RACE_LESSON, AT_1, [rec({ sentenceIndex: 0, at: AT_1 })])],
      }),
    )
    seedLessons([{ id: RACE_LESSON, sentences: RACE_SENTENCES }])
    await seedLive({ words: [{ ...LIVE_WORD, f: DAY_2, l: DAY_2 }] })

    await migrateV1ToV2()

    const row = await word(await open(), 'alpha')
    expect(row.f).toBe(DAY_1)
    expect(row.l).toBe(DAY_2)
    // Hisoblagichlar baribir qo'shiladi — `f`/`l` qoidasi ularga tegmaydi.
    expect(row.e).toBe(11)
    expect(row.x).toBe(2)
  })

  it("jonli qatorning SERIYASI (`s`/`b`) nolga tushirilmaydi", async () => {
    seedV1(raceV1())
    seedLessons([{ id: RACE_LESSON, sentences: RACE_SENTENCES }])
    // Migratsiya oynasida yozilgan qator: uchta toza ta'sirlanish ketma-ket,
    // eng yaxshisi esa oldinroqda beshta bo'lgan.
    await seedLive({ words: [{ ...LIVE_WORD, s: 3, b: 5 }] })

    await migrateV1ToV2()

    // v1 dan kelgan qatorda seriya YO'Q (`buildMigration` uni tiklay olmaydi,
    // shuning uchun 0), lekin `l` si jonli qatornikidan ERTA — ya'ni joriy
    // seriya jonli qatorniki. `Math.min` bo'lganida u 0 ga tushib ketardi.
    const row = await word(await open(), 'alpha')
    expect(row.s).toBe(3)
    expect(row.b).toBe(5)
  })

  it("jonli SEANS qatori saqlanadi va v1 seanslari uning yoniga qo'shiladi", async () => {
    seedV1(
      raceV1({
        sessions: [session('v1-1', RACE_LESSON, AT_1, [rec({ sentenceIndex: 0, at: AT_1 })])],
      }),
    )
    seedLessons([{ id: RACE_LESSON, sentences: RACE_SENTENCES }])
    await seedLive({
      sessions: [session('live-1', RACE_LESSON, AT_2, [rec({ sentenceIndex: 0, at: AT_2 })])],
    })

    await migrateV1ToV2()

    // `sessions` do'koni ATAYIN ko'r `put` bo'lib qoladi: v1 seanslarining `id`
    // lari ESKI build tomonidan ajratilgan, oynada yozilgani esa YANGI seans.
    const ids = (await readAllRows<SessionRecord>(await open(), STORE_SESSIONS))
      .map((row) => row.id)
      .sort()
    expect(ids).toEqual(['live-1', 'v1-1'])
  })

  it("diskdagi NOTANISH maydonlar birlashtirishdan omon o'tadi (§9.2)", async () => {
    seedV1(raceV1())
    seedLessons([{ id: RACE_LESSON, sentences: RACE_SENTENCES }])
    await seedLive({
      words: [{ ...LIVE_WORD, future: 'keep' } as WordRow & { future: string }],
      days: [{ ...LIVE_DAY, future: 'keep' } as DayRow & { future: string }],
      lifetime: { ...LIVE_LIFETIME, future: 'keep' } as LifetimeMeta & { future: string },
    })

    await migrateV1ToV2()

    const db = await open()
    expect((await word(db, 'alpha')) as WordRow & { future?: string }).toMatchObject({
      future: 'keep',
    })
    expect((await day(db, KEY_1)) as DayRow & { future?: string }).toMatchObject({ future: 'keep' })
    expect((await lifetimeOf(db)) as LifetimeMeta & { future?: string }).toMatchObject({
      future: 'keep',
    })
  })
})

// ---------------------------------------------------------------------------
// `mergeWordRows` — SOF birlashtirish qoidasi
// ---------------------------------------------------------------------------
//
// ⚠️ NEGA ALOHIDA, IDB'SIZ BLOK. Bu funksiya UCH joyda ishlatiladi va ularning
// har birida `a` boshqa narsani anglatadi: `buildMigration` (v1 ichidagi kalit
// to'qnashuvi, ikkala qator ham urug'), `writePlan` (`a` = DISKDAGI jonli
// qator) va `stats.ts` dagi `importJson` (`a` = zaxira faylining birinchi
// qatori). Migratsiya orqali sinash faqat BIRINCHI ikkitasini qamraydi —
// `s`/`b` qoidasining ahamiyati esa aynan UCHINCHISIDA ko'rinadi, chunki
// migratsiya rejasidagi qatorda `s`/`b` HAR DOIM 0.
describe('mergeWordRows — seriya va notanish maydonlar qoidasi', () => {
  const row = (over: Partial<WordRow>): WordRow => ({
    w: 'w',
    e: 0,
    x: 0,
    de: 0,
    dx: 0,
    s: 0,
    b: 0,
    ...over,
  })

  it("⭐ `b` — IKKALA tarixning MAKSIMUMI: hech biri ikkinchisining rekordini pasaytirmaydi", () => {
    // Aynan shu holat `importJson` da yetib boriladi: `"The"` va `"the"` —
    // bir so'zning ikkita yarim tarixi, ikkalasida ham HAQIQIY rekord bor.
    // `b = a.b` bo'lganida `b` tomonning eng yaxshi seriyasi JIMGINA yo'qolardi.
    expect(mergeWordRows(row({ b: 3, l: 10 }), row({ b: 9, l: 5 })).b).toBe(9)
    expect(mergeWordRows(row({ b: 9, l: 10 }), row({ b: 3, l: 5 })).b).toBe(9)
  })

  it("`b` hech qachon `s` dan kichik bo'lmaydi", () => {
    // `s` — joriy seriya, `b` — eng yaxshisi: `b < s` o'z-o'ziga zid holat va u
    // faqat diskdagi buzuq qatordan kelib chiqadi.
    expect(mergeWordRows(row({ s: 7, b: 0, l: 10 }), row({ b: 0, l: 5 })).b).toBe(7)
  })

  it("`s` — `l` si KECHROQ qatorniki (joriy seriya eng so'nggi ta'sirlanishga tegishli)", () => {
    expect(mergeWordRows(row({ s: 3, l: 10 }), row({ s: 8, l: 5 })).s).toBe(3)
    expect(mergeWordRows(row({ s: 3, l: 5 }), row({ s: 8, l: 10 })).s).toBe(8)
  })

  it("sana NOMA'LUM yoki TENG bo'lsa `s` ning KICHIGI olinadi — eng konservativ taxmin", () => {
    // Aralashgan tarixda seriya faqat UZILISHI mumkin, uzayishi emas.
    expect(mergeWordRows(row({ s: 3, l: 7 }), row({ s: 8, l: 7 })).s).toBe(3)
    expect(mergeWordRows(row({ s: 3 }), row({ s: 8 })).s).toBe(3)
    // Bir tomonda sana bor, ikkinchisida yo'q -> SANALISI g'olib.
    expect(mergeWordRows(row({ s: 3, l: 10 }), row({ s: 8 })).s).toBe(3)
    expect(mergeWordRows(row({ s: 3 }), row({ s: 8, l: 10 })).s).toBe(8)
  })

  it("`a` ning NOTANISH maydonlari saqlanadi, `f`/`l` esa spread'dan CHIQARILADI (§9.2, §9.1)", () => {
    const merged = mergeWordRows(
      { ...row({ e: 1 }), future: 'keep' } as WordRow & { future: string },
      row({ e: 2 }),
    )
    expect(merged as WordRow & { future?: string }).toMatchObject({ future: 'keep' })
    // ⚠️ Ikkala tomonda ham sana yo'q -> maydon UMUMAN bo'lmasligi SHART,
    // aks holda `by_l` indeksiga `undefined` bilan tushardi (§9.1).
    expect('l' in merged).toBe(false)
    expect('f' in merged).toBe(false)
  })
})

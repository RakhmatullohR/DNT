// Ombor modullarining CHOK testi (docs/stats-longterm.md §4, §9, §4.4).
//
// Har bir modul allaqachon alohida sinalgan. Bu fayl esa ularni BIRGA yuritadi:
// v1 payload -> `migrateV1ToV2()` -> IDB -> `compactSessions()` -> qayta o'qish.
// Sabab: alohida testlar har modulning O'Z shartnomasini tekshiradi, lekin
// modullar orasidagi MA'NO chokini emas — masalan migratsiya yozgan kun
// kalitining `compact` kutgani bilan bir xilligini, yoki qisqartirish umrbod
// hisoblagichlarni buzmasligini.
//
// Muhit: `fake-indexeddb/auto` `vitest.config.ts` dagi `store` proyektining
// `setupFiles` ida ulanadi; `localStorage` bu yerda qo'lda o'rnatiladi.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dayNumber } from '../../src/core/wordScore.ts'
import { closeDb, deleteDb, openDb, runTx } from '../../src/store/statsDb.ts'
import {
  META_KEY_LIFETIME,
  STORE_DAYS,
  STORE_META,
  STORE_SESSIONS,
  STORE_WORDS,
  dayKeyOf,
} from '../../src/store/statsSchema.ts'
import type { DayRow, LifetimeMeta, WordRow } from '../../src/store/statsSchema.ts'
import { migrateV1ToV2 } from '../../src/store/statsMigrate.ts'
import { compactSessions } from '../../src/store/statsCompact.ts'

/** Node muhitida `localStorage` yo'q — minimal xotiradagi nusxa. */
function memoryStorage(): Storage {
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

/** Qat'iy "hozir": 2026-06-15, tush payti — retention chegarasi determinik bo'lsin. */
const NOW = new Date(2026, 5, 15, 12, 0, 0, 0).getTime()

function daysAgo(n: number): number {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  return d.getTime()
}

const LESSON_ID = 'l1'
const SENTENCES = ['The quick fox.', 'The lazy dog.', 'Rhythm matters.']

/** Eski seans — 400 kun oldin, `compact` uni o'chirishi kerak. */
const OLD_AT = daysAgo(400)
/** Yangi seans — 10 kun oldin, qolishi kerak. */
const NEW_AT = daysAgo(10)
/** Seansi YO'Q kun — `k`/`nc`/chelaklar u yerda paydo bo'lmasligi kerak (§4.2). */
const BARE_AT = daysAgo(900)

function seedLessons(store: Storage): void {
  store.setItem(
    'dnt.lessons.v1',
    JSON.stringify([
      {
        id: LESSON_ID,
        title: 'Sinov',
        createdAt: OLD_AT,
        originalText: SENTENCES.join(' '),
        normalizedText: SENTENCES.join(' '),
        sentences: SENTENCES,
        progress: 3,
        skipped: [],
      },
    ]),
  )
}

function sentence(at: number, index: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    sentenceIndex: index,
    at,
    activeMs: 20_000,
    keystrokes: 100,
    correctKeystrokes: 90,
    netWpm: 36,
    rawWpm: 40,
    accuracy: 0.9,
    restarts: 0,
    skipped: false,
    audioEnabled: true,
    ...over,
  }
}

function seedStats(store: Storage): void {
  store.setItem(
    'dnt.stats.v1',
    JSON.stringify({
      version: 1,
      words: {
        the: { exposures: 10, errors: 2 },
        quick: { exposures: 5, errors: 3 },
        // Hech qaysi seansda uchramaydi -> `f`/`l` tiklanmaydi (§9.1).
        orphan: { exposures: 4, errors: 1 },
      },
      days: {
        // Seansi yo'q kun: baza uchtasi bor, `k`/`nc`/chelaklar BO'LMASLIGI kerak.
        [dayKeyOf(BARE_AT)]: { correctKeystrokes: 500, activeMs: 90_000, sentences: 5 },
        [dayKeyOf(OLD_AT)]: { correctKeystrokes: 180, activeMs: 40_000, sentences: 2 },
        [dayKeyOf(NEW_AT)]: { correctKeystrokes: 90, activeMs: 20_000, sentences: 1 },
      },
      sessions: [
        {
          id: 'old',
          lessonId: LESSON_ID,
          lessonTitle: 'Sinov',
          startedAt: OLD_AT,
          endedAt: OLD_AT,
          sentences: [sentence(OLD_AT, 0), sentence(OLD_AT, 1, { skipped: true })],
          activeMs: 20_000,
          keystrokes: 100,
          correctKeystrokes: 90,
          netWpm: 36,
          rawWpm: 40,
          accuracy: 0.9,
        },
        {
          id: 'new',
          lessonId: LESSON_ID,
          lessonTitle: 'Sinov',
          startedAt: NEW_AT,
          endedAt: NEW_AT,
          sentences: [sentence(NEW_AT, 2, { audioEnabled: false })],
          activeMs: 20_000,
          keystrokes: 100,
          correctKeystrokes: 90,
          netWpm: 36,
          rawWpm: 40,
          accuracy: 0.9,
        },
      ],
    }),
  )
}

async function readWords(db: IDBDatabase): Promise<Map<string, WordRow>> {
  const rows = await runTx<WordRow[]>(
    db,
    [STORE_WORDS],
    'readonly',
    (tx, collect) => {
      const req = tx.objectStore(STORE_WORDS).getAll()
      req.onsuccess = () => collect(req.result as WordRow[])
    },
    [],
  )
  return new Map(rows.map((row) => [row.w, row]))
}

async function readDays(db: IDBDatabase): Promise<Map<string, DayRow>> {
  const rows = await runTx<DayRow[]>(
    db,
    [STORE_DAYS],
    'readonly',
    (tx, collect) => {
      const req = tx.objectStore(STORE_DAYS).getAll()
      req.onsuccess = () => collect(req.result as DayRow[])
    },
    [],
  )
  return new Map(rows.map((row) => [row.d, row]))
}

function readLifetime(db: IDBDatabase): Promise<LifetimeMeta | undefined> {
  return runTx<LifetimeMeta | undefined>(
    db,
    [STORE_META],
    'readonly',
    (tx, collect) => {
      const req = tx.objectStore(STORE_META).get(META_KEY_LIFETIME)
      req.onsuccess = () => collect(req.result as LifetimeMeta | undefined)
    },
    undefined,
  )
}

function readSessionIds(db: IDBDatabase): Promise<string[]> {
  return runTx<string[]>(
    db,
    [STORE_SESSIONS],
    'readonly',
    (tx, collect) => {
      const req = tx.objectStore(STORE_SESSIONS).getAllKeys()
      req.onsuccess = () => collect((req.result as string[]).slice().sort())
    },
    [],
  )
}

async function open(): Promise<IDBDatabase> {
  const db = await openDb()
  if (db === null) throw new Error('test muhitida IndexedDB ochilmadi')
  return db
}

beforeEach(() => {
  const store = memoryStorage()
  seedLessons(store)
  seedStats(store)
  vi.stubGlobal('localStorage', store)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  closeDb()
  await deleteDb()
})

describe('migratsiya -> qisqartirish choki', () => {
  it('migratsiya uchala do\'konni va umrbod konvertni to\'ldiradi', async () => {
    const result = await migrateV1ToV2()
    expect(result).toMatchObject({ ok: true, migrated: true })

    const db = await open()
    expect(await readSessionIds(db)).toEqual(['new', 'old'])
    expect((await readWords(db)).size).toBe(3)
    expect((await readDays(db)).size).toBe(3)
  })

  it('⭐ §9.1: darsda uchragan so\'z sana oladi, uchramagani NOMA\'LUM qoladi', async () => {
    await migrateV1ToV2()
    const words = await readWords(await open())

    // `the` ikkala YOZILGAN gapda ham bor: 0-gap (eski) va 2-gapda yo'q,
    // shuning uchun faqat eski seansdan keladi. `quick` ham 0-gapda.
    const the = words.get('the')
    expect(the?.l).toBe(dayNumber(OLD_AT))
    expect(the?.f).toBe(dayNumber(OLD_AT))

    // ⚠️ Hech qaysi seansda uchramagan so'z: maydon UMUMAN yo'q — `undefined`
    // ham emas. Shundagina u `by_l` indeksiga tushmaydi va UI da "noma'lum"
    // deb chiziladi, migratsiya sanasi bilan EMAS.
    const orphan = words.get('orphan')
    expect(orphan).toBeDefined()
    expect('l' in (orphan as object)).toBe(false)
    expect('f' in (orphan as object)).toBe(false)
  })

  it('⭐ §4.2: seansi YO\'Q kunda k/nc/chelaklar paydo bo\'lmaydi', async () => {
    await migrateV1ToV2()
    const days = await readDays(await open())

    const bare = days.get(dayKeyOf(BARE_AT))
    // Baza uchtasi v1 `days` dan TO'G'RIDAN-TO'G'RI keladi.
    expect(bare).toMatchObject({ correctKeystrokes: 500, activeMs: 90_000, sentences: 5 })
    // Qolganlari — "o'lchanmagan", nol EMAS.
    expect(bare?.k).toBeUndefined()
    expect(bare?.nc).toBeUndefined()
    expect(bare?.on).toBeUndefined()
    expect(bare?.off).toBeUndefined()

    // Seansi BOR kunlarda esa ular to'ldirilgan, va ovoz holati bo'yicha ajratilgan.
    expect(days.get(dayKeyOf(OLD_AT))?.on?.sentences).toBe(1)
    expect(days.get(dayKeyOf(OLD_AT))?.off).toBeUndefined()
    expect(days.get(dayKeyOf(NEW_AT))?.off?.sentences).toBe(1)
    expect(days.get(dayKeyOf(NEW_AT))?.on).toBeUndefined()
  })

  it('⭐ §4.3: umrbod activeMs `days` YIG\'INDISIDAN, seanslardan EMAS', async () => {
    await migrateV1ToV2()
    const lifetime = await readLifetime(await open())

    // v1 `days`: 90_000 + 40_000 + 20_000 = 150_000.
    // Seanslar yig'indisi esa atigi 40_000 — farq ataylab yasalgan.
    expect(lifetime?.activeMs).toBe(150_000)
    expect(lifetime?.correctKeystrokes).toBe(770)

    // `activeMs` ANIQ bilinadi -> `since` YO'Q. `sessions` esa faqat qisman.
    expect('activeMsSince' in (lifetime as object)).toBe(false)
    expect(lifetime?.sessionsSince).toBe(dayNumber(OLD_AT))
  })

  it('⭐ qisqartirish eski seansni o\'chiradi, so\'z/kun/umrbodga TEGMAYDI', async () => {
    await migrateV1ToV2()
    const db = await open()
    const before = await readLifetime(db)

    const removed = await compactSessions(NOW)

    expect(removed).toBe(1)
    expect(await readSessionIds(db)).toEqual(['new'])
    // `days` va `words` ABADIY — qisqartirish ularga tegmaydi.
    expect((await readWords(db)).size).toBe(3)
    expect((await readDays(db)).size).toBe(3)
    // ⚠️ Eng muhimi: umrbod hisoblagichlar ORQAGA YURMAYDI. §4.3 aynan shu
    // nuqson uchun yaratilgan — `totals()` v1 da seanslar qisqarganda kamayardi.
    expect(await readLifetime(db)).toEqual(before)
  })

  it('qisqartirishdan keyingi qayta migratsiya o\'chirilgan seansni TIKLAMAYDI', async () => {
    await migrateV1ToV2()
    await compactSessions(NOW)

    // Marker o'z ishini qilishi shart: aks holda v1 payload hamon diskda
    // bo'lgani uchun ikkinchi migratsiya o'chirilgan seansni qaytarardi va
    // umrbod hisoblagichlarni IKKILANTIRARDI.
    const second = await migrateV1ToV2()
    expect(second).toMatchObject({ ok: true, migrated: false, reason: 'already-migrated' })

    const db = await open()
    expect(await readSessionIds(db)).toEqual(['new'])
    expect((await readWords(db)).get('the')?.e).toBe(10)
    expect((await readLifetime(db))?.activeMs).toBe(150_000)
  })
})

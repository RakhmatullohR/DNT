// `src/store/stats.ts` testlari — v2, IndexedDB (docs/stats-longterm.md §4, §8, §9).
//
// ⚠️ NEGA `tests/store/` DA, `tests/core/` DA EMAS. Ilgari bu fayl `core`
// proyektida yashardi va sabab `localStorage` ning yo'qligi edi. Endi sabab
// BOSHQA: v2 API butunlay IndexedDB ustida turadi, `core` esa sof mantiq uchun
// (`environment: 'node'`, global `indexedDB` YO'Q). `store` proyektining
// `setupFiles: ['fake-indexeddb/auto']` global `indexedDB` ni beradi — ya'ni
// bu faylning yashash joyi endi omborning O'ZI bilan belgilanadi.
//
// ⚠️ SOAT: `vi.useFakeTimers({ toFake: ['Date'] })` — FAQAT `Date`. Standart
// `vi.useFakeTimers()` `setImmediate` ni ham qotiradi, `fake-indexeddb` esa
// tranzaksiyalarni AYNAN `setImmediate` bilan navbatga qo'yadi: o'shanda har
// bir IDB so'rovi abadiy osilib qoladi va butun fayl timeout bilan yiqiladi.
// Bu tekshirilgan, taxmin emas.
//
// `localStorage` ham qo'lda o'rnatiladi (namuna: `tests/store/seam.test.ts`) —
// u faqat uchta yo'lda kerak: v1 migratsiyasi, v1 zaxira faylini import qilish
// va `clearStats()` ning §9.3 va'dasi.
//
// ---------------------------------------------------------------------------
// §9.2 — NIMA O'CHIRILDI VA NEGA (bu ALMASHUV, yaxshilanish EMAS)
// ---------------------------------------------------------------------------
//
// Uchta blok, jami 17 test o'chirildi. Ular qayta yozilmadi, chunki
// IndexedDB'da tekshiradigan mexanizmning O'ZI yo'q:
//
//   1. `buzuq payload zaxirasi` (11 test) — `corruptStatsBackup`,
//      `discardCorruptStatsBackup`, `backupCorrupt`. `localStorage` bitta SATR
//      saqlardi va u yarim yozilib buzilishi mumkin edi; IndexedDB'da esa
//      strukturaviy nusxa yo MUVAFFAQIYATLI, yo baza umuman ochilmaydi —
//      "buzuq satr" tushunchasi yo'q. O'rnini `persist()` + muntazam eksport
//      bosadi (`exportJson`/`importJson` bloki hamon shu faylda).
//
//   2. `buzuq seans yozuvi` (3 test) — `unknownSessions` mexanizmi. U parser
//      tanimagan yozuvni diskka QAYTARARDI, ya'ni yangi versiyada yozilgan
//      yozuvni eski build o'chirib yubormasdi. IndexedDB'ga o'tgach bu
//      OLDINGA MOSLIK himoyasi yo'qoldi. Yumshatish tipda emas, naqshda:
//      har o'qi-o'zgartir-yoz zanjiri qatorni `{ ...current, <ma'lum> }` bilan
//      BUTUNLAY qayta yozadi — notanish maydon yo'qolmaydi.
//
//   3. `kvota siqilganda qisqartirish` (3 test) — `writeStats` ning ikkinchi
//      urinishi. U `localStorage` ning ~5 MB lik SHIFT kvotasi uchun edi;
//      IndexedDB kvotasi disk hajmiga bog'liq va "sig'madi -> yarmini tashla"
//      strategiyasi u yerda ma'nosiz. Retention endi vaqt bo'yicha va ochiq:
//      `statsCompact.ts` (180 kun), o'z testi bilan.
//
// Qolgan HAR BIR test saqlandi va yangi (asinxron) shartnomaga moslandi.
// Shartnomasi O'ZGARGAN uchta test AYNI xatarni yangi API da tekshiradi va
// har birining ustida nimaga aylangani yozilgan (qidiring: "⚠️ SHARTNOMA
// O'ZGARDI").

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { planSentenceWrite } from '../../src/core/session.ts'
import type { SentenceWritePlan, WordDelta } from '../../src/core/session.ts'
import { DEFAULT_G, SHRINKAGE_M, dayNumber } from '../../src/core/wordScore.ts'
import { compactSessions } from '../../src/store/statsCompact.ts'
import { closeDb, deleteDb, openDb, runTx } from '../../src/store/statsDb.ts'
import {
  META_KEY_DECAY_ANCHOR_DAY,
  META_KEY_LIFETIME,
  STORE_DAYS,
  STORE_META,
  STORE_SESSIONS,
  STORE_WORDS,
  dayKeyOf,
} from '../../src/store/statsSchema.ts'
import type {
  DayRow,
  LifetimeMeta,
  SessionRecord,
  SentenceRecord,
  SessionEnvelope,
  WordRow,
} from '../../src/store/statsSchema.ts'
import { META_KEY_V1_MIGRATED_AT } from '../../src/store/statsMigrate.ts'
import { STATS_V1_KEY } from '../../src/store/statsV1.ts'
import {
  G_ORDER_FLIP,
  audioComparison,
  clearStats,
  dailySeries,
  exportJson,
  getSession,
  hardestWords,
  importJson,
  initStats,
  loadOverview,
  measureG,
  measureLifetimeG,
  previousSession,
  recentSessions,
  streakDays,
  totals,
  writeSentences,
  writeSessionEnvelope,
} from '../../src/store/stats.ts'
import type { SentenceWrite } from '../../src/store/stats.ts'

/** Darslar kaliti — `clearStats()` unga TEGMASLIGI kerak. */
const LESSONS_KEY = 'dnt.lessons.v1'

/** Xotiradagi `Storage`: modul faqat uchta metodni ishlatadi, qolgani realizm uchun. */
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

/** Qat'iy "hozir": 2026-03-15, LOKAL tush payti — kun kaliti mintaqada surilmasin. */
const NOW = new Date(2026, 2, 15, 12, 0, 0, 0).getTime()

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
  // ⚠️ FAQAT `Date` — fayl boshidagi izohga qarang.
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
// Vaqt yordamchilari
// ---------------------------------------------------------------------------

/**
 * `NOW` dan `offset` kun OLDINGI lokal `hour` soati (ms).
 * MANFIY `offset` — kelajak (so'nish testlari uchun).
 *
 * Kun `setDate` bilan suriladi, `n * 86_400_000` bilan EMAS — DST o'tgan
 * oraliqda millisekund ayirmasi bir kunni tashlab ketardi.
 */
function timeAt(offset: number, hour = 12): number {
  const date = new Date(NOW)
  date.setHours(hour, 0, 0, 0)
  date.setDate(date.getDate() - offset)
  return date.getTime()
}

/** `NOW` dan `offset` kun oldingi `'YYYY-MM-DD'`. */
function dayKey(offset: number): string {
  return dayKeyOf(timeAt(offset))
}

/**
 * `NOW` dan `offset` kun oldingi KUN RAQAMI (`WordRow.f`/`.l` uchun).
 * `dayNumber` ning O'ZI chaqiriladi: formulani testda takrorlash ikkala
 * tomonni bir vaqtda noto'g'ri qilish xatarini tug'dirardi.
 */
function dayNo(offset = 0): number {
  return dayNumber(timeAt(offset))
}

// ---------------------------------------------------------------------------
// IDB yordamchilari — to'g'ridan-to'g'ri urug'lantirish va o'qish
// ---------------------------------------------------------------------------

async function open(): Promise<IDBDatabase> {
  const db = await openDb()
  if (db === null) throw new Error('test muhitida IndexedDB ochilmadi')
  return db
}

/** Standart so'z qatori — faqat farq qiladigan maydonlar ko'rsatiladi. */
function word(w: string, over: Partial<WordRow> = {}): WordRow {
  return { w, e: 0, x: 0, de: 0, dx: 0, s: 0, b: 0, ...over }
}

/** `[bugundan necha kun oldin, to'g'ri bosishlar]` juftliklaridan kun qatorlari. */
function daysFrom(entries: Array<[number, number]>): DayRow[] {
  return entries.map(([offset, correctKeystrokes]) => ({
    d: dayKey(offset),
    correctKeystrokes,
    activeMs: 60_000,
    sentences: 1,
  }))
}

/**
 * Do'konlarga to'g'ridan-to'g'ri yozadi.
 *
 * ⚠️ O'QISH yo'lini sinaydigan testlar uchun ATAYIN: ular `writeSentences` ning
 * to'g'riligiga bog'lanmasligi kerak, aks holda bitta yozuv nuqsoni o'nlab
 * o'qish testini bir vaqtda YASHIL qilib qo'yardi.
 */
async function seed(data: {
  words?: readonly WordRow[]
  days?: readonly DayRow[]
  sessions?: readonly SessionRecord[]
  lifetime?: LifetimeMeta
  anchor?: number
  /** `meta[v1MigratedAt]` — MS TAMG'ASI. `totals()` izchil oynasining chegarasi. */
  migratedAt?: number
}): Promise<void> {
  const db = await open()
  await runTx(db, [STORE_WORDS, STORE_DAYS, STORE_SESSIONS, STORE_META], 'readwrite', (tx) => {
    for (const row of data.words ?? []) tx.objectStore(STORE_WORDS).put(row)
    for (const row of data.days ?? []) tx.objectStore(STORE_DAYS).put(row)
    for (const row of data.sessions ?? []) tx.objectStore(STORE_SESSIONS).put(row)
    const meta = tx.objectStore(STORE_META)
    if (data.lifetime !== undefined) meta.put(data.lifetime, META_KEY_LIFETIME)
    if (data.anchor !== undefined) meta.put(data.anchor, META_KEY_DECAY_ANCHOR_DAY)
    if (data.migratedAt !== undefined) meta.put(data.migratedAt, META_KEY_V1_MIGRATED_AT)
  })
}

async function readWords(): Promise<Map<string, WordRow>> {
  const rows = await runTx<WordRow[]>(
    await open(),
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

async function readDays(): Promise<Map<string, DayRow>> {
  const rows = await runTx<DayRow[]>(
    await open(),
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

function readMeta<T>(key: string): Promise<T | undefined> {
  return open().then((db) =>
    runTx<T | undefined>(
      db,
      [STORE_META],
      'readonly',
      (tx, collect) => {
        const req = tx.objectStore(STORE_META).get(key)
        req.onsuccess = () => collect(req.result as T | undefined)
      },
      undefined,
    ),
  )
}

const readLifetime = (): Promise<LifetimeMeta | undefined> =>
  readMeta<LifetimeMeta>(META_KEY_LIFETIME)
const readAnchor = (): Promise<number | undefined> => readMeta<number>(META_KEY_DECAY_ANCHOR_DAY)

// ---------------------------------------------------------------------------
// Yozuv yordamchilari — `useTypingSession.ts` dagi chaqiruv shaklining nusxasi
// ---------------------------------------------------------------------------

/** `lessonId` ATAYIN yo'q: u `SessionRecord` da qoladi, gap yozuvidan olib tashlangan (§2.3). */
function makeSentence(over: Partial<SentenceRecord> = {}): SentenceRecord {
  return {
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

/** Gap yozuvini SO'Z DELTASI bilan qo'shib `SentenceWrite` yasaydi (§8.1). */
function withWords(record: SentenceRecord, words: Record<string, WordDelta> = {}): SentenceWrite {
  return { ...record, words: new Map(Object.entries(words)) }
}

/**
 * Seans konverti — `useTypingSession.ts` dagi `envelopeOf` ning AYNAN nusxasi.
 *
 * Konvertni endi CHAQIRUVCHI hisoblaydi, ombor emas (§8.2.3). Nusxa shu yerda
 * turibdi, chunki §2.3 testlari aynan "konvert diskdagi YAXLITLANGAN gap
 * qiymatlaridan chiqadi" degan CHOKNI sinaydi.
 */
function envelopeFrom(
  records: readonly SentenceRecord[],
  over: Partial<SessionEnvelope> = {},
): SessionEnvelope {
  let activeMs = 0
  let keystrokes = 0
  let correctKeystrokes = 0
  let netWeighted = 0
  let rawWeighted = 0
  for (const record of records) {
    if (record.skipped) continue
    activeMs += record.activeMs
    keystrokes += record.keystrokes
    correctKeystrokes += record.correctKeystrokes
    netWeighted += record.netWpm * record.activeMs
    rawWeighted += record.rawWpm * record.activeMs
  }

  return {
    lessonId: 'l1',
    lessonTitle: 'Sinov darsi',
    startedAt: timeAt(0, 9),
    endedAt: timeAt(0, 10),
    activeMs,
    keystrokes,
    correctKeystrokes,
    netWpm: activeMs > 0 ? netWeighted / activeMs : 0,
    rawWpm: activeMs > 0 ? rawWeighted / activeMs : 0,
    accuracy: keystrokes > 0 ? correctKeystrokes / keystrokes : 1,
    ...over,
  }
}

/**
 * Bitta `writeSentences` chaqiruvi. Konvert `history` + `records` dan chiqadi —
 * ya'ni ketma-ket chaqiruvlarda u xuddi jonli seansdagidek O'SIB boradi.
 */
function writeAll(
  sessionId: string,
  records: readonly SentenceWrite[],
  history: readonly SentenceRecord[] = [],
  over: Partial<SessionEnvelope> = {},
): Promise<boolean> {
  return writeSentences(sessionId, envelopeFrom([...history, ...records], over), records)
}

/** Ikki gapli seans: 120 + 45 to'g'ri bosish, 90 s faol vaqt. Kutilgan sonlar BUTUN chiqadi. */
function twoSentences(words: Record<string, WordDelta> = {}): SentenceWrite[] {
  return [
    withWords(makeSentence({ sentenceIndex: 0 }), words),
    withWords(
      makeSentence({
        sentenceIndex: 1,
        activeMs: 30_000,
        keystrokes: 60,
        correctKeystrokes: 45,
        netWpm: 18, // (45 / 5) / 0.5 daqiqa
        rawWpm: 24, // (60 / 5) / 0.5 daqiqa
        accuracy: 0.75,
      }),
    ),
  ]
}

/** Ikki gapli seansni `s-1` id bilan yozadi. */
function writeTwoSentenceSession(words: Record<string, WordDelta> = {}): Promise<boolean> {
  return writeAll('s-1', twoSentences(words))
}

// ---------------------------------------------------------------------------
// Fayl yordamchilari (eksport/import)
// ---------------------------------------------------------------------------

function v1File(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, sessions: [], words: {}, days: {}, ...over })
}

function v2File(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 2,
    kind: 'stats',
    words: [],
    days: [],
    sessions: [],
    lifetime: { activeMs: 0, correctKeystrokes: 0, netChars: 0, sessions: 0, keystrokes: 0 },
    ...over,
  })
}

/** Rad etilishi kutilgan import: xato qaytadi VA ombor bir zarra ham o'zgarmaydi. */
async function expectRejected(raw: string): Promise<void> {
  const before = await exportJson()
  const result = await importJson(raw)
  if (result.ok) {
    throw new Error(`Import kutilmaganda muvaffaqiyatli bo'ldi: ${raw}`)
  }
  expect(result.error.length).toBeGreaterThan(0)
  expect(await exportJson()).toBe(before)
}

// ---------------------------------------------------------------------------
// Bo'sh ombor va buzuq v1 payload
// ---------------------------------------------------------------------------

describe('loadOverview va bo\'sh ombor', () => {
  it("bo'sh omborda tarix YO'Q va uchala sanoq nol", async () => {
    expect(await loadOverview()).toEqual({
      hasHistory: false,
      wordCount: 0,
      dayCount: 0,
      sessionCount: 0,
    })
  })

  it("buzuq v1 payload bo'sh ombor beradi, lekin saqlangan satrni O'CHIRMAYDI", async () => {
    const corrupt = 'bu umuman JSON emas {{{'
    localStorage.setItem(STATS_V1_KEY, corrupt)

    expect(await initStats(NOW)).toBe('ready')

    expect(await loadOverview()).toMatchObject({ hasHistory: false })
    // Qo'lda tiklash imkoni qolishi kerak — v1 ombori M3 dan keyin faqat
    // O'QILADI, ya'ni satrni bosib ketadigan yozuv umuman yo'q (§9.3).
    expect(localStorage.getItem(STATS_V1_KEY)).toBe(corrupt)
  })

  it("tanib bo'lmaydigan YAKKA yozuv tashlanadi, qolgan tarix saqlanadi", async () => {
    const good = {
      id: 'yaxshi',
      lessonId: 'l1',
      lessonTitle: 'Sinov',
      startedAt: timeAt(0, 9),
      endedAt: timeAt(0, 10),
      sentences: [],
      activeMs: 60_000,
      keystrokes: 120,
      correctKeystrokes: 120,
      netWpm: 24,
      rawWpm: 24,
      accuracy: 1,
    }

    expect(
      await importJson(
        v1File({
          sessions: [good, { id: '' }, 42, null],
          words: { the: { exposures: 10, errors: 2 }, '': { exposures: 5, errors: 5 } },
          days: { [dayKey(0)]: { correctKeystrokes: 150, activeMs: 60_000, sentences: 1 }, kecha: {} },
        }),
      ),
    ).toEqual({ ok: true })

    expect((await recentSessions(10)).map((s) => s.id)).toEqual(['yaxshi'])
    expect([...(await readWords()).keys()]).toEqual(['the'])
    expect([...(await readDays()).keys()]).toEqual([dayKey(0)])
  })

  it("fayldagi `x > e` KESILADI — begona fayl uchun invariant qorovuli", async () => {
    // ⚠️ Yozuv yo'lida bu holat umuman yuzaga kelmaydi: manba xatoni
    // TA'SIRLANISH darajasida sanaydi va `nextWordRow` deltani kesadi. Lekin
    // ombor `importJson` orqali qo'lda tahrirlangan yoki begona faylni ham
    // qabul qiladi, va `rate > 1` reyting ustunlarini 100% dan oshirib yuborardi.
    expect(await importJson(v2File({ words: [{ w: 'rhythm', e: 4, x: 99 }] }))).toEqual({ ok: true })

    const row = (await readWords()).get('rhythm')
    expect(row?.x).toBe(4)
    // Urug'lantirish ham KESILGAN sondan boradi: dx = 4·4/4 = 4, ya'ni `dx <= de`.
    expect(row?.de).toBe(4)
    expect(row?.dx).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Eksport / import (§9.5) — §9.2 dan keyin YAGONA tiklash vositasi
// ---------------------------------------------------------------------------

describe('exportJson va importJson', () => {
  it("eksport -> import aylanishi DEEP EQUAL: zaxiradan hamma narsa tiklanadi", async () => {
    await writeTwoSentenceSession({ The: { exposures: 3, errors: 1 }, cat: { exposures: 2, errors: 2 } })
    const backup = await exportJson()

    // ⚠️ TOZA ombor (yangi qurilma / brauzer ma'lumoti o'chirilgan) — ATAYIN
    // `clearStats()` EMAS. Sabab §9.5: umrbod konvert importda ALMASHTIRILMAYDI,
    // BIRLASHTIRILADI, ya'ni mavjud konvert natijaga ta'sir qiladi. Aylanishning
    // O'ZINI o'lchash uchun birlashtiradigan narsa bo'lmasligi kerak;
    // birlashtirishning O'ZI esa pastda, alohida sinaladi.
    closeDb()
    await deleteDb()
    expect(await loadOverview()).toMatchObject({ hasHistory: false })

    expect(await importJson(backup)).toEqual({ ok: true })

    // ⚠️ Satr emas, DEEP EQUAL: `toSessionRecord` maydonlarni sobit tartibda
    // qayta yig'adi, ya'ni JSON matnining O'ZI aylanishdan keyin boshqacha
    // TARTIBDA chiqadi. Sinalayotgan narsa — MA'LUMOT, uning yozilishi emas.
    expect(JSON.parse(await exportJson())).toEqual(JSON.parse(backup))
  })

  it("⭐ §9.5: umrbod konvert ALMASHTIRILMAYDI, BIRLASHTIRILADI — raqam ORQAGA yurmaydi", async () => {
    // Umrbod hisoblagichlar MONOTON: ular "kamida shuncha" degan ma'noni
    // tashiydi. Eski zaxirani tiklash ularni orqaga surib yuborsa, §4.3 aynan
    // oldini olish uchun yozilgan "umrbod raqam kamayadi" nuqsoni import
    // orqali qaytardi.
    await writeAll('eski', [withWords(makeSentence())])
    const oldBackup = await exportJson()
    expect(JSON.parse(oldBackup).lifetime).toMatchObject({ activeMs: 60_000, sessions: 1 })

    // Foydalanuvchi mashqda davom etdi — ombor eski zaxiradan OLDINGA ketdi.
    await writeAll('yangi', [withWords(makeSentence({ sentenceIndex: 1 }))])
    expect((await totals())?.activeMs).toBe(120_000)

    // Va endi ESKI zaxirani tiklaydi.
    expect(await importJson(oldBackup)).toEqual({ ok: true })

    // Ma'lumot ALMASHTIRILDI (fayldagi yagona seans qoldi)...
    expect((await recentSessions(10)).map((s) => s.id)).toEqual(['eski'])
    // ...umrbod hisoblagichlar esa `max()` bilan saqlanib qoldi.
    expect((await totals())?.activeMs).toBe(120_000)
    expect((await totals())?.sessions).toBe(2)
  })

  it("⭐ §9.5: `*Since` belgisining YO'QLIGI sanadan KUCHLIROQ — `min` emas, tushib qolish", async () => {
    // `*Since` — "bu son FAQAT shu kundan beri aniq bilinadi" degan belgi, ya'ni
    // KICHIKROQ sana ko'proq bilimni bildiradi va maydonning umuman yo'qligi
    // "to'liq bilinadi" degani. Shuning uchun uni `max()` qilish XATO bo'lardi.
    await writeAll('s-1', [withWords(makeSentence())])
    // Yozuv yo'li konvertsiz omborda uchala `*Since` ni BUGUNGA qo'yadi
    // (`lifetimeForWrite` ta'mirlash shoxi) — ya'ni sonlar "shu kundan beri".
    expect(JSON.parse(await exportJson()).lifetime).toMatchObject({
      netCharsSince: dayNo(),
      sessionsSince: dayNo(),
      keystrokesSince: dayNo(),
    })
    const partial = await exportJson()

    // `clearStats()` esa BELGISIZ (to'liq bilinadigan) bo'sh konvert yozadi.
    await clearStats(NOW)
    expect(JSON.parse(await exportJson()).lifetime).not.toHaveProperty('netCharsSince')

    expect(await importJson(partial)).toEqual({ ok: true })

    const lifetime = JSON.parse(await exportJson()).lifetime as Record<string, unknown>
    expect(lifetime).toMatchObject({ activeMs: 60_000, sessions: 1 })
    expect(lifetime).not.toHaveProperty('netCharsSince')
    expect(lifetime).not.toHaveProperty('sessionsSince')
    expect(lifetime).not.toHaveProperty('keystrokesSince')
  })

  it("eksport — o'qish mumkin bo'lgan, o'zini ATAYDIGAN va o'zi import qilinadigan JSON", async () => {
    await writeTwoSentenceSession({ the: { exposures: 3, errors: 1 } })
    const backup = await exportJson()

    expect(backup).toContain('\n  "version": 2')
    // `kind` v1 eksportida YO'Q edi: noto'g'ri tugmaga tashlangan dars fayli
    // jimgina "statistika" deb o'qilardi.
    expect(JSON.parse(backup)).toMatchObject({ version: 2, kind: 'stats' })
    expect(await importJson(backup)).toEqual({ ok: true })
  })

  it("import ALMASHTIRADI: bir xil faylni ikki marta yuklash yig'indilarni ikkilantirmaydi", async () => {
    await writeTwoSentenceSession({ the: { exposures: 3, errors: 1 } })
    const backup = await exportJson()

    expect(await importJson(backup)).toEqual({ ok: true })
    expect(await importJson(backup)).toEqual({ ok: true })

    // Birlashtirish bo'lganda seans 3 ta, `the` 9 ta ta'sirlanish bo'lib ketardi.
    expect(JSON.parse(await exportJson())).toEqual(JSON.parse(backup))
    expect((await totals())?.sessions).toBe(1)
    // So'nuvchi maydonlar ham aylanishdan o'zgarmasdan chiqadi: `de`/`dx` faylda
    // borligi uchun §6.5 urug'lantirishi ularni QAYTA hisoblamaydi.
    expect((await readWords()).get('the')).toMatchObject({
      e: 3,
      x: 1,
      de: 3,
      dx: 1,
      f: dayNo(),
      l: dayNo(),
    })
    expect((await readDays()).get(dayKey(0))).toMatchObject({
      correctKeystrokes: 165,
      activeMs: 90_000,
      sentences: 2,
    })
  })

  it("mavjud statistika ustiga import — birlashtirilmaydi, butunlay almashtiriladi", async () => {
    await writeTwoSentenceSession({ the: { exposures: 3, errors: 1 } })
    const backup = await exportJson()

    await clearStats(NOW)
    await writeAll('boshqa', [withWords(makeSentence(), { rhythm: { exposures: 8, errors: 6 } })])

    expect(await importJson(backup)).toEqual({ ok: true })
    expect((await recentSessions(10)).map((s) => s.id)).toEqual(['s-1'])
    expect([...(await readWords()).keys()]).toEqual(['the'])
  })

  it("JSON bo'lmagan matn rad etiladi, ombor tegilmaydi", async () => {
    await seed({ words: [word('the', { e: 10, x: 2, de: 10, dx: 2 })], days: daysFrom([[0, 150]]) })

    await expectRejected('bu fayl umuman JSON emas')
    await expectRejected('{"version": 1, ')
  })

  it("shakli noto'g'ri JSON rad etiladi, ombor tegilmaydi", async () => {
    await seed({ words: [word('the', { e: 10, x: 2, de: 10, dx: 2 })], days: daysFrom([[0, 150]]) })

    await expectRejected('[]') // massiv — obyekt kutilgan edi
    await expectRejected('"salom"')
    await expectRejected('{"version": 1}') // `sessions` yo'q
    await expectRejected('{"version": 1, "sessions": {}, "words": {}, "days": {}}')
    await expectRejected('{"version": 2, "kind": "stats", "words": {}, "days": [], "sessions": []}')
    await expectRejected('{"version": 2, "kind": "stats", "words": [], "days": null, "sessions": []}')
    // Boshqa turdagi zaxira fayli — `kind` aynan shuning uchun qo'shilgan.
    await expectRejected('{"version": 2, "kind": "lessons", "words": [], "days": [], "sessions": []}')
  })

  it("qo'llab-quvvatlanmaydigan versiya rad etiladi, ombor tegilmaydi", async () => {
    await seed({ days: daysFrom([[0, 150]]) })

    await expectRejected('{"version": 3, "words": [], "days": [], "sessions": []}')
    await expectRejected('{"version": "2", "words": [], "days": [], "sessions": []}')
    await expectRejected('{"words": [], "days": [], "sessions": []}')
  })

  it("null va bo'sh kirish rad etiladi, ombor tegilmaydi", async () => {
    await seed({ days: daysFrom([[0, 150]]) })

    await expectRejected('null')
    await expectRejected('')
    await expectRejected('   ')
  })

  it("v1 zaxira fayli HAM qabul qilinadi — eski nusxalar o'qilishi SHART (§9.5)", async () => {
    expect(
      await importJson(
        v1File({
          words: { thorough: { exposures: 50, errors: 10 } },
          days: { [dayKey(0)]: { correctKeystrokes: 150, activeMs: 60_000, sentences: 2 } },
        }),
      ),
    ).toEqual({ ok: true })

    // Import yo'li boot migratsiyasi bilan AYNAN bir xil qoidalarga bo'ysunadi:
    // §6.5 urug'lantirishi ham, so'nish langari ham qo'yiladi.
    expect((await readWords()).get('thorough')).toMatchObject({ e: 50, x: 10, de: 20, dx: 4 })
    expect(await readAnchor()).toBe(dayNo())
    expect(await streakDays(NOW)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Eng qiyin so'zlar
// ---------------------------------------------------------------------------

describe('hardestWords', () => {
  it("XOM xato soni bo'yicha EMAS — so'nuvchi hisoblagichlardan chiqqan BALL bo'yicha", async () => {
    await seed({
      words: [
        // `the` da xato KO'P (20 > 5), lekin u shunchaki tez-tez uchraydi.
        word('the', { e: 200, x: 20, de: 20, dx: 2, l: dayNo(0) }),
        word('thorough', { e: 10, x: 5, de: 10, dx: 5, l: dayNo(0) }),
      ],
    })

    const rows = await hardestWords()

    expect(rows.map((r) => r.word)).toEqual(['thorough', 'the'])
    // ⚠️ Tartib `score` bo'yicha (§6.1), `rate` bo'yicha EMAS — `rate` qatorda
    // faqat KO'RSATISH uchun qoladi.
    expect(rows[0]?.score).toBeGreaterThan(rows[1]?.score ?? 0)
    expect(rows[0]?.rate).toBe(0.5)
    expect(rows[1]?.rate).toBe(0.1)
    // Xom son bo'yicha tartiblansa ro'yxat boshini `the` egallardi (PLAN §6).
    expect(rows[1]?.errors).toBeGreaterThan(rows[0]?.errors ?? 0)
  })

  it("`minExposures` dan kam uchragan so'z ro'yxatga UMUMAN kirmaydi", async () => {
    await seed({
      words: [
        // nisbat 1.0, lekin ma'lumot yetarli emas
        word('rhythm', { e: 4, x: 4, de: 4, dx: 4, l: dayNo(0) }),
        word('the', { e: 200, x: 20, de: 20, dx: 2, l: dayNo(0) }),
      ],
    })

    expect((await hardestWords()).map((r) => r.word)).toEqual(['the'])
    // Chegara pasaytirilsa o'sha so'z darhol birinchi o'ringa chiqadi.
    expect((await hardestWords(4)).map((r) => r.word)).toEqual(['rhythm', 'the'])
  })

  it("bir xil ballda ko'proq uchragani oldinda, so'ng alifbo tartibi", async () => {
    await seed({
      words: [
        word('gamma', { e: 10, x: 2, de: 10, dx: 2, l: dayNo(0) }),
        word('beta', { e: 20, x: 4, de: 20, dx: 4, l: dayNo(0) }),
        word('alfa', { e: 10, x: 2, de: 10, dx: 2, l: dayNo(0) }),
      ],
    })

    // Uchalasining nisbati AYNAN `g` ga teng (0.2), ya'ni ballari ham teng —
    // tartibni faqat tenglik kalitlari hal qiladi.
    expect((await hardestWords()).map((r) => r.word)).toEqual(['beta', 'alfa', 'gamma'])
  })

  it("⭐ DETERMINIK: natija so'zlarning YOZILISH TARTIBIGA bog'liq emas", async () => {
    // ⚠️ Bu test v1 dan KUCHSIZROQ, va buni ochiq yozish kerak: IndexedDB
    // `getAll()` qatorlarni BIRLAMCHI KALIT tartibida qaytaradi, ya'ni
    // "saqlash tartibi" endi umuman sizib chiqmaydi. Ushlab turadigan xatar
    // esa o'sha-o'sha: tenglikda tartiblash kalitining yetishmasligi.
    // Shuning uchun kutilgan ro'yxat AYNAN yozilgan — `alfa` va `gamma`
    // (ball ham, `exposures` ham teng) orasidagi tartibni faqat alifbo hal qiladi.
    const rows = [
      word('gamma', { e: 10, x: 2, de: 10, dx: 2, l: dayNo(0) }),
      word('beta', { e: 20, x: 4, de: 20, dx: 4, l: dayNo(0) }),
      word('alfa', { e: 10, x: 2, de: 10, dx: 2, l: dayNo(0) }),
      word('thorough', { e: 10, x: 5, de: 10, dx: 5, l: dayNo(0) }),
    ]

    await seed({ words: rows })
    const first = await hardestWords()

    // Butunlay yangi ombor — TESKARI yozish tartibi bilan.
    closeDb()
    await deleteDb()
    await seed({ words: [...rows].reverse() })
    const second = await hardestWords()

    expect(first.map((r) => r.word)).toEqual(['thorough', 'alfa', 'gamma', 'beta'])
    expect(second).toEqual(first)
  })

  it("`limit` ro'yxat uzunligini kesadi, 0 esa bo'sh beradi", async () => {
    await seed({
      words: [
        word('alfa', { e: 10, x: 5, de: 10, dx: 5, l: dayNo(0) }),
        word('beta', { e: 10, x: 4, de: 10, dx: 4, l: dayNo(0) }),
        word('gamma', { e: 10, x: 3, de: 10, dx: 3, l: dayNo(0) }),
      ],
    })

    expect((await hardestWords(5, 2)).map((r) => r.word)).toEqual(['alfa', 'beta'])
    expect(await hardestWords(5, 0)).toEqual([])
  })

  it("bo'sh omborda bo'sh ro'yxat", async () => {
    expect(await hardestWords()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// So'nuvchi hisoblagichlar (§5) va so'nish langari
// ---------------------------------------------------------------------------

describe("so'nuvchi hisoblagichlar (§5)", () => {
  it("§6.5: `de`/`dx` siz fayl qatori umrbod hisoblagichlardan urug'lantiriladi", async () => {
    expect(await importJson(v2File({ words: [{ w: 'thorough', e: 50, x: 10 }] }))).toEqual({ ok: true })

    const row = (await readWords()).get('thorough')
    // de = min(e, m) = min(50, 20) = 20;  dx = x·de/e = 10·20/50 = 4.
    expect(row?.de).toBe(Math.min(50, SHRINKAGE_M))
    expect(row?.de).toBe(20)
    expect(row?.dx).toBe(4)
    // `de = dx = 0` bilan boshlanganda hamma so'z aynan `g` ga teng ball olib,
    // reyting O'LIK bo'lardi — urug'lantirish aynan shuning oldini oladi.
    expect(row?.dx).toBeGreaterThan(0)

    // ⚠️ Kun maydonlari esa urug'lantirilMAYDI (§9.1): ular HAQIQATAN noma'lum.
    // IndexedDB'da "yo'q maydon" tekshiruvi `in` bilan bo'lishi SHART:
    // `{ f: undefined }` diskda saqlanadi va `by_l` indeksiga axlat tushardi.
    expect('f' in (row as object)).toBe(false)
    expect('l' in (row as object)).toBe(false)
  })

  it("urug'lantirish umrbod nisbatni saqlaydi: `de` ustidan ham `dx/de = x/e`", async () => {
    expect(await importJson(v2File({ words: [{ w: 'rhythm', e: 8, x: 2 }] }))).toEqual({ ok: true })

    const row = (await readWords()).get('rhythm')
    // e < m, ya'ni butun tarix sig'adi: de = 8, dx = 2·8/8 = 2.
    expect(row?.de).toBe(8)
    expect(row?.dx).toBe(2)
  })

  it("yaroqsiz `de`/`dx` butun qatorni EMAS, faqat o'sha juftlikni yo'q qiladi", async () => {
    expect(
      await importJson(
        v2File({
          words: [
            // ⚠️ `dx` ATAYIN 9: `seedDecayed(50, 10).dx` aynan 4 chiqadi, ya'ni
            // saqlangan `dx: 4` bilan "juftlikdan biri yo'q bo'lsa IKKALASI
            // qayta urug'lantiriladi" qoidasi umuman tekshirilmasdi.
            { w: 'the', e: 50, x: 10, de: null, dx: 9, l: dayNo(2) },
            { w: 'rhythm', e: 50, x: 10, de: -3, dx: 'salom', f: 'kecha' },
          ],
        }),
      ),
    ).toEqual({ ok: true })

    const words = await readWords()
    // Mashq tarixi joyida qoladi...
    expect(words.get('the')?.e).toBe(50)
    expect(words.get('rhythm')?.x).toBe(10)
    // ...so'nuvchi juftlik esa §6.5 bo'yicha qayta tiklanadi: `dx: 9` TASHLANADI
    // va `dx = x·de/e = 10·20/50 = 4` bilan almashtiriladi.
    expect(words.get('the')).toMatchObject({ de: 20, dx: 4, l: dayNo(2) })
    expect(words.get('rhythm')).toMatchObject({ de: 20, dx: 4 })
    expect('f' in (words.get('rhythm') as object)).toBe(false)
  })

  it("⚠️ TARTIB: avval so'ndiriladi, keyin qo'shiladi (90 kun: 8·0.5 + 1 = 5)", async () => {
    await seed({
      words: [word('rhythm', { e: 40, x: 20, f: dayNo(400), l: dayNo(90), de: 8, dx: 4 })],
    })

    await writeAll('s-1', [withWords(makeSentence(), { rhythm: { exposures: 1, errors: 0 } })])

    const row = (await readWords()).get('rhythm')
    expect(row?.de).toBe(5) // 8·0.5 + 1 — yangi ta'sirlanish TO'LIQ og'irlikda
    expect(row?.dx).toBe(2) // 4·0.5 + 0
    expect(row?.l).toBe(dayNo())
    // Umrbod hisoblagichlar so'nmaydi — ular boshqa savolga javob beradi.
    expect(row?.e).toBe(41)
    expect(row?.x).toBe(20)
  })

  it("⭐ LANGAR: `l` yo'q qator urug'lantirish KUNIDAN so'nadi, o'sha kuni esa dt = 0", async () => {
    expect(await importJson(v1File({ words: { thorough: { exposures: 50, errors: 10 } } }))).toEqual({
      ok: true,
    })

    // Urug'lantirish import paytida sodir bo'ldi -> langar BUGUN.
    expect(await readAnchor()).toBe(dayNo())

    await writeAll('s-1', [withWords(makeSentence(), { thorough: { exposures: 1, errors: 1 } })])

    const row = (await readWords()).get('thorough')
    // Urug': de = 20, dx = 4. Langar bugun bo'lgani uchun `dt = 0`, ya'ni
    // koeffitsiyent aynan 1 va qiymatlar to'g'ridan-to'g'ri ustiga qo'shildi.
    expect(row?.de).toBe(21)
    expect(row?.dx).toBe(5)
    // Birinchi ta'sirlanishdan keyin kun maydonlari paydo bo'ladi.
    expect(row?.f).toBe(dayNo())
    expect(row?.l).toBe(dayNo())
  })

  it("⭐ v2 IMPORTI ham langar qo'yadi: urug'lantirish bo'ldi-yu faylda langar YO'Q", async () => {
    // ⚠️ v1 yo'li bundan himoyalangan edi (`parseStatsV1`: `storedAnchor ??
    // (seeded ? today : undefined)`), v2 yo'lida esa EKVIVALENT ZAXIRA YO'Q edi:
    // `de`/`dx` urug'lantirilardi, langar esa FAQAT faylda `decayAnchorDay`
    // bo'lganda yozilardi. `l` ham, `de`/`dx` ham, langar ham yo'q fayl
    // qatorlarni ABADIY muzlatardi — §1.1 fossili, endi import orqali.
    expect(await importJson(v2File({ words: [{ w: 'thorough', e: 50, x: 10 }] }), NOW)).toEqual({
      ok: true,
    })

    expect(await readAnchor()).toBe(dayNo())
  })

  it("⭐ v2 import langari SO'NISHNI ROSTDAN boshlaydi (90 kun -> koeffitsiyent 0.5)", async () => {
    // Langar shunchaki yozilishi yetarli emas — u O'QISH yo'lida ishlashi kerak.
    await importJson(v2File({ words: [{ w: 'thorough', e: 50, x: 10 }] }), NOW)

    // Urug': de = min(50, 20) = 20, dx = 10·20/50 = 4. 90 kundan keyin YOZUV:
    const later = timeAt(-90)
    await writeAll('s-1', [
      withWords(makeSentence({ at: later }), { thorough: { exposures: 1, errors: 0 } }),
    ])

    const row = (await readWords()).get('thorough')
    expect(row?.de).toBe(11) // 20·0.5 + 1
    expect(row?.dx).toBe(2) // 4·0.5 + 0
  })

  it("fayldagi langar BUGUNGI kundan AFZAL — u erta qo'yilgan, ya'ni haqiqiyroq", async () => {
    await importJson(
      v2File({ words: [{ w: 'thorough', e: 50, x: 10 }], decayAnchorDay: dayNo(200) }),
      NOW,
    )

    expect(await readAnchor()).toBe(dayNo(200))
  })

  it("urug'lantirish BO'LMASA langar TO'QIB CHIQARILMAYDI", async () => {
    // Langar yo'qligi ham MA'LUMOT: `de`/`dx` faylda bor, ya'ni ular haqiqiy
    // o'lchov va qaysi kunga tegishli ekanini biz bilmaymiz.
    await importJson(v2File({ words: [{ w: 'thorough', e: 50, x: 10, de: 20, dx: 4 }] }), NOW)

    expect(await readAnchor()).toBeUndefined()
  })

  it("⭐ LANGAR BIR MARTA qo'yiladi va keyingi o'qish/yozuvlarda SURILMAYDI", async () => {
    await importJson(v1File({ words: { thorough: { exposures: 50, errors: 10 } } }))
    const anchor = dayNo()
    expect(await readAnchor()).toBe(anchor)

    // 100 kun o'tdi. Langar bugungi kunga surilsa so'nish har o'qishda noldan
    // boshlanar va qator YANA abadiy muzlab qolardi.
    const later = timeAt(-100)
    expect(dayNumber(later)).toBeGreaterThan(anchor)
    await hardestWords(1, 20, later)
    await measureG(later)
    expect(await readAnchor()).toBe(anchor)

    // Va yozuvdan keyin ham o'sha langar diskda qoladi.
    await writeAll('s-1', [
      withWords(makeSentence({ at: later }), { boshqa: { exposures: 1, errors: 0 } }),
    ])
    expect(await readAnchor()).toBe(anchor)
  })

  it("⚠️ `l` MONOTON: gap vaqti ORQAGA ketsa ham saqlangan kun KAMAYMAYDI", async () => {
    // ⚠️ v1 da bu "tizim soati orqaga surildi" deb yozilgan edi. v2 da kun
    // GAPNING `at` idan chiqadi (`planWrite`), ya'ni AYNI xatarni eskiroq `at`
    // bilan modellash to'g'riroq: mintaqa almashishi ham, soat surilishi ham
    // shu yerga tushadi.
    await writeAll('s-1', [withWords(makeSentence(), { the: { exposures: 1, errors: 0 } })])
    expect((await readWords()).get('the')?.l).toBe(dayNo())

    await writeAll('s-2', [
      withWords(makeSentence({ at: timeAt(5, 9) }), { the: { exposures: 1, errors: 0 } }),
    ])

    const row = (await readWords()).get('the')
    expect(row?.l).toBe(dayNo())
    // `f` esa aksincha — u MINIMUM, ya'ni orqaga surilishi to'g'ri.
    expect(row?.f).toBe(dayNo(5))
    // Va so'nish koeffitsiyenti 1 dan oshmagan: `de` shishmadi.
    expect(row?.de).toBe(2)
  })
})

describe('hardestWords — empirik Bayes reytingi (§6)', () => {
  it("⭐ FOSSILLASHUV: uch yil oldin qiynalgan so'z yaqinda qiynalganidan PASTDA turadi", async () => {
    await seed({
      words: [
        // Uch yil oldin: umrbod nisbat 0.5, lekin oxirgi ta'sirlanish 1095 kun oldin.
        word('thorough', { e: 50, x: 25, f: dayNo(1200), l: dayNo(1095), de: 20, dx: 10 }),
        // Bugun: umrbod nisbat AYNAN O'SHA 0.5, lekin ma'lumot yangi.
        word('rhythm', { e: 10, x: 5, f: dayNo(3), l: dayNo(0), de: 10, dx: 5 }),
        // Bazaviy darajani beradigan keng tarqalgan so'z — `g` shundan chiqadi.
        word('the', { e: 600, x: 12, f: dayNo(500), l: dayNo(0), de: 60, dx: 1.2 }),
      ],
    })

    const rows = await hardestWords(1)

    expect(rows.map((r) => r.word)).toEqual(['rhythm', 'thorough', 'the'])
    // Eski tartiblash (umrbod `errors / exposures`) da ikkalasi TENG chiqardi,
    // tenglikda esa ko'proq uchragani oldinda — ya'ni fossil birinchi bo'lardi.
    // Bu §1.1 dagi asosiy shikoyatning bevosita testi.
    expect(rows[0]?.rate).toBe(rows[1]?.rate)
    expect(rows[1]?.exposures).toBeGreaterThan(rows[0]?.exposures ?? 0)
    expect(rows[0]?.score).toBeGreaterThan(rows[1]?.score ?? 0)
  })

  it("⭐ VAQT O'TISHI: `l` si YO'Q v1 qatori ham so'nadi — tartib ikki yilda O'ZGARADI", async () => {
    // ⚠️ Bu test langarning butun sababi (M1 dagi BLOKER 1). v1 ma'lumotining
    // 100% ida `l` yo'q: migratsiya `de`/`dx` ni §6.5 bo'yicha urug'lantiradi,
    // `l` esa §9.1 bo'yicha NOMA'LUM qoladi — langarsiz qator na qayta
    // urug'lanardi, na so'nardi, ya'ni ABADIY MUZLAB qolardi. So'ndirish kuchi
    // aynan teskari joyga tushardi: yaqinda terilgan so'z so'nar, qayta
    // terilmagani turaverardi.
    await importJson(v1File({ words: { fossil: { exposures: 50, errors: 25 } } }))

    // Bugun ro'yxatda faqat o'sha bitta so'z bor.
    expect((await hardestWords()).map((r) => r.word)).toEqual(['fossil'])

    // Ikki yil o'tdi (730 kun ≈ 8.1 yarim yemirilish davri, koeffitsiyent ~0.0036).
    const later = timeAt(-730, 9)

    // Yaqinda mashq qilingan ikkita so'z: `fresh` qiyinroq, `the` bazaviy daraja.
    await writeAll('s-2', [
      withWords(makeSentence({ at: later }), {
        fresh: { exposures: 10, errors: 3 },
        the: { exposures: 200, errors: 4 },
      }),
    ])

    const rows = await hardestWords(5, 20, later)
    // So'ndirilganda `fossil` ning so'nuvchi hisoblagichlari ~0.07 ga tushadi va
    // uning bali bazaviy darajaga tortiladi. So'ndirilmasa (nuqson qaytsa) u
    // de = 20, dx = 10 bilan qolib, ro'yxat boshiga BIRINCHI bo'lib chiqardi.
    expect(rows.map((r) => r.word)).toEqual(['fresh', 'fossil', 'the'])

    const byWord = new Map(rows.map((r) => [r.word, r]))
    expect(byWord.get('fresh')?.score).toBeGreaterThan(byWord.get('fossil')?.score ?? 0)
    // Umrbod nisbat esa hamon `fossil` da eng yuqori — ya'ni tartibni AYNAN
    // so'nish o'zgartirdi, boshqa hech narsa emas.
    expect(byWord.get('fossil')?.rate).toBeGreaterThan(byWord.get('fresh')?.rate ?? 0)
  })

  it("⚠️ ESKIRISH INVARIANTI: qator TARTIBLASHDAN OLDIN bugunga so'ndiriladi", async () => {
    await seed({
      words: [
        // Saqlangan `de`/`dx` bir xil — farq FAQAT `l` da.
        word('eski', { e: 30, x: 15, f: dayNo(400), l: dayNo(180), de: 20, dx: 10 }),
        word('yangi', { e: 30, x: 15, f: dayNo(30), l: dayNo(0), de: 20, dx: 10 }),
        // Bazaviy daraja: `g` qatorlarning o'z nisbatidan past bo'lishi kerak,
        // aks holda shrinkage hech narsani siljitmaydi va test hech nimani
        // o'lchamaydi (ball aynan `g` ga teng bo'lib qoladi).
        word('the', { e: 600, x: 12, f: dayNo(500), l: dayNo(0), de: 60, dx: 1.2 }),
      ],
    })

    const rows = await hardestWords(1)

    // So'ndirilmaganda `eski` va `yangi` ayni ballni olib, tartib alifboga
    // tushardi ('eski' birinchi) — ya'ni nuqson jimgina, xatosiz chiqardi.
    expect(rows.map((r) => r.word)).toEqual(['yangi', 'eski', 'the'])
    expect(rows[0]?.score).toBeGreaterThan(rows[1]?.score ?? 0)
  })

  it("`lastDay` qaytariladi; noma'lum bo'lsa `undefined` — migratsiya sanasi EMAS (§9.1)", async () => {
    await seed({
      words: [
        word('yangi', { e: 10, x: 5, f: dayNo(3), l: dayNo(1), de: 10, dx: 5 }),
        word('migratsiya', { e: 10, x: 5, de: 10, dx: 5 }),
      ],
    })

    const byWord = new Map((await hardestWords(1)).map((r) => [r.word, r]))

    expect(byWord.get('yangi')?.lastDay).toBe(dayNo(1))
    expect(byWord.get('migratsiya')?.lastDay).toBeUndefined()
  })

  it("⚠️ §6.2: `g` yuqori bo'lsa formula `1/1` ni ushlab tura olmaydi — kafolat TO'SIQDA", async () => {
    // Sinov holati: bitta kuzatuv (100%) va ishonchli 50 ta kuzatuv (20%).
    await importJson(
      v1File({ words: { bir: { exposures: 1, errors: 1 }, ellik: { exposures: 50, errors: 10 } } }),
    )

    // Shu ikki qatorda `g = 5/21 ≈ 0.238` — ag'darilish chegarasidan yuqori.
    expect(await measureG(NOW)).toBeGreaterThan(G_ORDER_FLIP)
    // Va tartib haqiqatan ag'dariladi: hech qanday `m` buni tuzata olmaydi,
    // chunki chegara `m → ∞` da ham 9/49 ≈ 0.184 da to'yinadi.
    expect((await hardestWords(1)).map((r) => r.word)).toEqual(['bir', 'ellik'])
    // Yagona ishonchli himoya — minimal ta'sirlanish to'sig'i (§11.4), va u
    // UMRBOD `exposures` ga qo'llanadi, so'nuvchi `de` ga emas.
    expect((await hardestWords(5)).map((r) => r.word)).toEqual(['ellik'])
  })

  it("`G_ORDER_FLIP` — `m = 20` uchun tartib ag'dariladigan `g` (≈0.1429)", () => {
    expect(G_ORDER_FLIP).toBeCloseTo(0.142_857, 6)
    expect(G_ORDER_FLIP).toBeLessThan(9 / 49) // nazariy shift, `m → ∞`
  })
})

describe('measureG (§6.1)', () => {
  it("bo'sh bazada `null` — o'lchanmagan holat 0.08 dan FARQLANADI", async () => {
    // Qorovul imzoning O'ZIDA, chaqiruv joyidagi alohida bayroqda emas: ekran
    // uni haqiqiy 0.08 o'lchovi bilan aralashtira olmaydi.
    expect(await measureG(NOW)).toBeNull()
    expect(await measureLifetimeG()).toBeNull()
  })

  it("`Σde = 0` bo'lsa reyting ZAXIRA `DEFAULT_G` ga tushadi — ball `NaN` bo'lmaydi", async () => {
    // `de` aynan nol bo'lgan qator: `g` o'lchab bo'lmaydi (`0/0`), lekin
    // ro'yxat baribir chizilishi kerak. Zaxira `hardestWords` ICHIDA
    // qo'llanadi, `measureG()` esa halol "o'lchanmagan" deb qaytadi.
    await seed({ words: [word('muzlagan', { e: 10, x: 0, de: 0, dx: 0, l: dayNo(0) })] })

    expect(await measureG(NOW)).toBeNull()
    // ball = (0 + 20·0.08) / (0 + 20) = 0.08.
    expect((await hardestWords())[0]?.score).toBe(DEFAULT_G)
  })

  it("⭐ §12 M0: `measureLifetimeG()` — UMRBOD `Σx/Σe`, urug'langan `g` dan FARQLI", async () => {
    await importJson(
      v1File({
        words: {
          // Ko'p uchraydigan, oson so'z: urug'lantirishda `de = min(200, 20) = 20`,
          // ya'ni uning og'irligi 10 barobar KESILADI.
          the: { exposures: 200, errors: 10 },
          rhythm: { exposures: 3, errors: 1 },
        },
      }),
    )

    // §12 M0 aynan shu sonni talab qiladi: bir qatorda, urug'siz.
    expect(await measureLifetimeG()).toBe(11 / 203)

    // `measureG()` esa urug'langan jadvaldan: de = 20 + 3, dx = 1 + 1.
    expect(await measureG(NOW)).toBe(2 / 23)

    // ⚠️ Ikkalasi BIR XIL emas, va farq bir tomonga — `min(e, 20)` eng oson
    // so'zning og'irligini kesgani uchun `measureG()` YUQORIGA siljiydi.
    expect((await measureG(NOW)) ?? 0).toBeGreaterThan((await measureLifetimeG()) ?? 0)
  })

  it("`Σdx / Σde` — umrbod emas, SO'NUVCHI hisoblagichlar bo'yicha", async () => {
    await seed({
      words: [
        // Umrbod nisbat 4/100 = 0.04, so'nuvchisi esa 1/20 = 0.05.
        word('the', { e: 100, x: 4, f: dayNo(30), l: dayNo(0), de: 20, dx: 1 }),
        word('rhythm', { e: 10, x: 4, f: dayNo(5), l: dayNo(0), de: 10, dx: 4 }),
      ],
    })

    expect(await measureG(NOW)).toBe(5 / 30)
    // Umrbod yig'indi (8/110) butunlay boshqa son bo'lardi.
    expect(await measureG(NOW)).not.toBe(8 / 110)
  })

  it("eskirgan qator so'ndirilib kiradi — `g` bugungi bazaviy daraja", async () => {
    await seed({
      words: [
        word('thorough', { e: 20, x: 10, f: dayNo(200), l: dayNo(90), de: 10, dx: 8 }),
        word('the', { e: 100, x: 2, f: dayNo(10), l: dayNo(0), de: 10, dx: 1 }),
      ],
    })

    // (8·0.5 + 1) / (10·0.5 + 10) = 5 / 15.
    expect(await measureG(NOW)).toBe(5 / 15)
  })
})

// ---------------------------------------------------------------------------
// Yozuvni ixchamlashtirish (§2.3)
// ---------------------------------------------------------------------------

/** Sonning o'nlik yozuvidagi kasr xonalari soni. */
function decimalsOf(value: number): number {
  const text = String(value)
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

describe("yozuvni ixchamlashtirish (§2.3)", () => {
  it("`netWpm`/`rawWpm` 1 kasrgacha, `accuracy` 3 kasrgacha yaxlitlanadi", async () => {
    await writeAll('s-1', [
      withWords(
        makeSentence({
          activeMs: 61_234,
          keystrokes: 120,
          correctKeystrokes: 110,
          netWpm: 39.713_889_185_438_24,
          rawWpm: 41.234_567_8,
          accuracy: 110 / 120,
        }),
      ),
    ])

    const record = (await getSession('s-1'))?.sentences[0]
    expect(record?.netWpm).toBe(39.7)
    expect(record?.rawWpm).toBe(41.2)
    expect(record?.accuracy).toBe(0.917)
    // ⚠️ v1 da bu yerda saqlangan SATR ham tekshirilardi (17 ta ma'nosiz belgi
    // bitta yozuvni 261 B ga shishirardi). IndexedDB strukturaviy nusxa saqlaydi
    // — satr yo'q, shuning uchun tekshiruv qiymatning O'ZIDA.
    expect(decimalsOf(record?.netWpm ?? 0)).toBeLessThanOrEqual(1)
  })

  it("seans konverti YAXLITLANGAN gap qiymatlaridan hisoblanadi", async () => {
    const records = [
      makeSentence({ activeMs: 60_000, keystrokes: 120, correctKeystrokes: 110, netWpm: 24.04, rawWpm: 26.06 }),
      makeSentence({
        sentenceIndex: 1,
        activeMs: 60_000,
        keystrokes: 120,
        correctKeystrokes: 100,
        netWpm: 12.04,
        rawWpm: 14.06,
      }),
    ]
    // ⚠️ SHARTNOMA O'ZGARDI: konvertni endi CHAQIRUVCHI hisoblaydi (§8.2.3),
    // ombor esa uni faqat yaxlitlaydi. Chok saqlanadi, chunki chaqiruvchi
    // AYNAN `roundSentence` dan chiqqan sonlarni ko'radi (`useTypingSession`
    // gapni `recordsRef` ga yaxlitlab qo'yadi) — shuning uchun test ham konvertni
    // yaxlitlangan gaplardan yasaydi.
    const rounded = records.map((r) => ({ ...r, netWpm: 24.0, rawWpm: 26.1 }))
    rounded[1] = { ...records[1]!, netWpm: 12.0, rawWpm: 14.1 }

    await writeSentences(
      's-1',
      envelopeFrom(rounded),
      records.map((r) => withWords(r)),
    )

    const session = await getSession('s-1')
    // Gaplar 24.0 va 12.0 ga yaxlitlangan, konvert esa AYNAN shulardan: 18.
    expect(session?.sentences.map((r) => r.netWpm)).toEqual([24, 12])
    expect(session?.netWpm).toBe(18)
    expect(session?.rawWpm).toBe(20.1) // (26.1 + 14.1) / 2
    expect(session?.accuracy).toBe(0.875) // 210 / 240
    expect(decimalsOf(session?.netWpm ?? 0)).toBeLessThanOrEqual(1)
    expect(decimalsOf(session?.rawWpm ?? 0)).toBeLessThanOrEqual(1)
    expect(decimalsOf(session?.accuracy ?? 0)).toBeLessThanOrEqual(3)
  })

  it("yopilish konverti ham yaxlitlanadi (`writeSessionEnvelope`)", async () => {
    await writeAll('s-1', [withWords(makeSentence())])

    expect(
      await writeSessionEnvelope('s-1', envelopeFrom([makeSentence()], { netWpm: 24.0499 })),
    ).toBe(true)

    expect((await getSession('s-1'))?.netWpm).toBe(24)
  })

  it("`SentenceRecord` da `lessonId` YO'Q — u `SessionRecord` da qoladi (§2.3)", async () => {
    await writeAll('s-1', [withWords(makeSentence())])

    const session = await getSession('s-1')
    expect(session?.sentences[0]).not.toHaveProperty('lessonId')
    // Ma'lumot yo'qolmaydi: dars id'si seans darajasida turibdi.
    expect(session?.lessonId).toBe('l1')
  })

  it("eski, `lessonId` li gap yozuvi o'qilganda YIQILMAYDI — maydon jimgina tashlanadi", async () => {
    expect(
      await importJson(
        v2File({
          sessions: [
            {
              id: 'eski',
              lessonId: 'l1',
              lessonTitle: 'Sinov',
              startedAt: timeAt(0, 9),
              endedAt: timeAt(0, 10),
              activeMs: 60_000,
              keystrokes: 120,
              correctKeystrokes: 120,
              netWpm: 24,
              rawWpm: 24,
              accuracy: 1,
              sentences: [{ ...makeSentence({ sentenceIndex: 4 }), lessonId: 'l1' }],
            },
          ],
        }),
      ),
    ).toEqual({ ok: true })

    const session = await getSession('eski')
    expect(session?.id).toBe('eski')
    expect(session?.sentences).toHaveLength(1)
    expect(session?.sentences[0]?.sentenceIndex).toBe(4)
    expect(session?.sentences[0]).not.toHaveProperty('lessonId')
  })
})

// ---------------------------------------------------------------------------
// Seriya (streak)
// ---------------------------------------------------------------------------

describe('streakDays', () => {
  it("bo'sh omborda 0", async () => {
    expect(await streakDays(NOW)).toBe(0)
  })

  it("kunlik chegara aynan 100 ta to'g'ri bosish", async () => {
    await seed({ days: daysFrom([[0, 100]]) })
    expect(await streakDays(NOW)).toBe(1)

    await seed({ days: daysFrom([[0, 99]]) })
    expect(await streakDays(NOW)).toBe(0)
  })

  it('ketma-ket kunlar bugundan orqaga sanaladi', async () => {
    await seed({ days: daysFrom([[0, 150], [1, 120], [2, 100]]) })
    expect(await streakDays(NOW)).toBe(3)
  })

  it("chegaraga yetmagan BUGUN seriyani UZMAYDI — kun hali tugamagan", async () => {
    await seed({ days: daysFrom([[0, 40], [1, 120], [2, 150], [3, 110]]) })
    expect(await streakDays(NOW)).toBe(3)
  })

  it('bugun umuman mashq qilinmagan ham seriya turaveradi', async () => {
    await seed({ days: daysFrom([[1, 120], [2, 150]]) })
    expect(await streakDays(NOW)).toBe(2)
  })

  it("o'rtadagi bo'shliq seriyani uzadi", async () => {
    await seed({ days: daysFrom([[0, 150], [1, 120], [3, 200], [4, 200]]) })
    // 2-kun yo'q: sanash 0 va 1 dan keyin to'xtaydi, eski kunlar qo'shilmaydi.
    expect(await streakDays(NOW)).toBe(2)
  })

  it("chegaradan past kun ham bo'shliq kabi uzadi", async () => {
    await seed({ days: daysFrom([[0, 150], [1, 50], [2, 200]]) })
    expect(await streakDays(NOW)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Yozish va yig'indilar
// ---------------------------------------------------------------------------

describe('writeSentences', () => {
  it("seans konverti va gaplari omborga tushadi", async () => {
    expect(await writeTwoSentenceSession()).toBe(true)

    const session = await getSession('s-1')
    expect(session?.activeMs).toBe(90_000)
    expect(session?.keystrokes).toBe(180)
    expect(session?.correctKeystrokes).toBe(165)
    expect(session?.netWpm).toBe(22) // (24·60000 + 18·30000) / 90000 — og'irlikli o'rtacha
    expect(session?.rawWpm).toBe(24) // (24·60000 + 24·30000) / 90000
    // Yozuvda 3 kasr (§2.3): 165/180 = 0.91666… -> 0.917.
    expect(session?.accuracy).toBe(0.917)
    expect(session?.sentences).toHaveLength(2)
    expect(await loadOverview()).toMatchObject({ hasHistory: true, sessionCount: 1 })
  })

  it("`skipped` gap kunlik jadvalga ham, so'z hisoblagichlarga ham KIRMAYDI", async () => {
    await writeAll('s-1', [
      withWords(makeSentence(), { the: { exposures: 1, errors: 0 } }),
      withWords(
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
        { tashlangan: { exposures: 9, errors: 9 } },
      ),
    ])

    const session = await getSession('s-1')
    expect(session?.activeMs).toBe(60_000)
    expect(session?.keystrokes).toBe(120)
    expect(session?.correctKeystrokes).toBe(120)
    expect(session?.netWpm).toBe(24)
    expect(session?.accuracy).toBe(1)
    // Gapning O'ZI seans yozuviga KIRADI — u seans hajmini yegan.
    expect(session?.sentences).toHaveLength(2)

    expect((await readDays()).get(dayKey(0))).toMatchObject({
      correctKeystrokes: 120,
      activeMs: 60_000,
      sentences: 1,
    })
    // Tashlangan gapning so'z deltasi ham hisobga OLINMAYDI.
    expect([...(await readWords()).keys()]).toEqual(['the'])
  })

  it("kunlik jadval gapning `at` vaqtidan to'ldiriladi — yarim tunlik seans ikki kunga bo'linadi", async () => {
    await writeAll('s-1', [
      withWords(makeSentence({ at: timeAt(1, 23) })),
      withWords(makeSentence({ at: timeAt(0, 0), correctKeystrokes: 90, keystrokes: 90 })),
    ])

    const days = await readDays()
    expect(days.get(dayKey(1))).toMatchObject({ correctKeystrokes: 120, activeMs: 60_000, sentences: 1 })
    expect(days.get(dayKey(0))).toMatchObject({ correctKeystrokes: 90, activeMs: 60_000, sentences: 1 })
  })

  it("bitta gapli seans ham kunlik jadvalga tushadi — seriya bo'shab qolmaydi", async () => {
    // ⚠️ SHARTNOMA O'ZGARDI: v1 da kunlik jadval SEANS KONVERTIDAN to'ldirilardi
    // va shuning uchun "gap yozuvisiz seans" ham seriyani ushlab turardi. v2 da
    // yozuv nuqtasi GAP (§8), ya'ni gapsiz seans umuman yozilmaydi
    // (`writeSentences` `records.length === 0` da `false` qaytaradi — pastdagi
    // test). Xatar o'sha-o'sha: kunlik jadval bo'sh qolib, seriya uzilishi.
    await writeAll('s-1', [withWords(makeSentence({ correctKeystrokes: 120, keystrokes: 130 }))])

    expect((await readDays()).get(dayKey(0))).toMatchObject({
      correctKeystrokes: 120,
      activeMs: 60_000,
      sentences: 1,
    })
    expect(await streakDays(NOW)).toBe(1)
  })

  it("so'zlar seanslar bo'ylab yig'iladi va KICHIK HARFGA keltiriladi", async () => {
    await writeTwoSentenceSession({ The: { exposures: 3, errors: 1 }, cat: { exposures: 2, errors: 2 } })
    await writeAll('s-2', [
      withWords(makeSentence(), { the: { exposures: 2, errors: 0 }, '  ': { exposures: 9, errors: 9 } }),
    ])

    const words = await readWords()
    expect(words.get('the')).toMatchObject({ e: 5, x: 1, de: 5, dx: 1, f: dayNo(), l: dayNo() })
    expect(words.get('cat')).toMatchObject({ e: 2, x: 2, de: 2, dx: 2, f: dayNo(), l: dayNo() })
    // Bo'sh (faqat probel) kalit umuman yozilmaydi.
    expect([...words.keys()].sort()).toEqual(['cat', 'the'])
  })

  it("begona delta DELTA darajasida kesiladi — `x <= e` invarianti", async () => {
    // ⚠️ Bu YO'L ODATIY EMAS. Manba (`wordDeltaOf`) xatoni TA'SIRLANISH
    // darajasida sanaydi (`min(…, 1)`), ya'ni jonli mashqda `errors > exposures`
    // deltasi umuman kelmaydi. Qisqich saqlanadi, chunki ombor `importJson`
    // orqali begona faylni ham qabul qiladi.
    await writeAll('s-1', [withWords(makeSentence(), { rhythm: { exposures: 1, errors: 4 } })])

    expect((await readWords()).get('rhythm')).toMatchObject({
      e: 1,
      x: 1,
      de: 1,
      dx: 1,
      f: dayNo(),
      l: dayNo(),
    })
    expect((await hardestWords(1))[0]?.rate).toBe(1)
  })

  it("⭐ TARTIBGA BOG'LIQ EMAS: ayni ikkita delta qaysi tartibda yozilsa ham natija BIR XIL", async () => {
    // ⚠️ Ilgari qisqich YIG'INDIGA qo'yilgani uchun natija tartibga bog'liq edi:
    //   {e:1,x:3} keyin {e:5,x:0}  ->  e 6, x 1  (nisbat 17%)
    //   {e:5,x:0} keyin {e:1,x:3}  ->  e 6, x 3  (nisbat 50%)
    // Buzilish UMRBOD `x` da — §4.1 "abadiy haqiqat" deb ta'riflagan son.
    // Kesilgan farq na diskda, na seanslarda qolmaydi, ya'ni TIKLAB BO'LMAYDI.
    //
    // ⚠️ Taqqoslash `s`/`b` SIZ: toza seriya — ta'rifi bo'yicha TARTIBLI son,
    // ya'ni uni tartibdan mustaqil deb kutish qatorning ma'nosini buzardi.
    const scalar = (row: WordRow | undefined) =>
      row === undefined ? null : { e: row.e, x: row.x, de: row.de, dx: row.dx, f: row.f, l: row.l }

    await writeAll('s-1', [withWords(makeSentence(), { rhythm: { exposures: 1, errors: 3 } })])
    await writeAll('s-2', [withWords(makeSentence(), { rhythm: { exposures: 5, errors: 0 } })])
    const forward = scalar((await readWords()).get('rhythm'))

    closeDb()
    await deleteDb()

    await writeAll('s-1', [withWords(makeSentence(), { rhythm: { exposures: 5, errors: 0 } })])
    await writeAll('s-2', [withWords(makeSentence(), { rhythm: { exposures: 1, errors: 3 } })])
    const reversed = scalar((await readWords()).get('rhythm'))

    expect(forward).toEqual(reversed)
    expect(forward).toEqual({ e: 6, x: 1, de: 6, dx: 1, f: dayNo(), l: dayNo() })
  })

  it("⭐ `{exposures: 0}` deltasi DISKKA UMUMAN TUSHMAYDI — zombi qator qolmaydi", async () => {
    // ⚠️ Bu v1 shartnomasining TIKLANISHI. M3 ning oraliq holatida
    // `nextWordRow` bunday delta uchun ham qator yaratardi
    // (`{w, e: 0, x: 0, de: 0, dx: 0, f, l}`) va u reyting uchun zararsiz
    // bo'lsa-da IKKI joyda ko'rinardi: `loadOverview().wordCount` da va eksport
    // faylida. Ustiga `f`/`l` BUGUNGA qo'yilardi — hech qachon terilmagan so'z
    // "bugun mashq qilingan" bo'lib qolardi.
    //
    // `errors: 5` ATAYIN: `nextWordRow` xatoni ta'sirlanish soniga KESADI, ya'ni
    // hissa baribir aynan nol — qorovul KESILGAN qiymatga qarashi shart.
    await writeAll('s-1', [withWords(makeSentence(), { zombi: { exposures: 0, errors: 5 } })])

    // ⭐ Qator YO'Q: sanoq ham, eksport ham shishmaydi.
    expect((await readWords()).has('zombi')).toBe(false)
    expect(await loadOverview()).toMatchObject({ wordCount: 0 })
    expect(JSON.parse(await exportJson()).words).toEqual([])

    // Va reyting/o'lchov yo'llari ham avvalgidek toza qoladi.
    expect(await hardestWords()).toEqual([])
    expect(await hardestWords(1)).toEqual([])
    expect(await measureG(NOW)).toBeNull()
    expect(await measureLifetimeG()).toBeNull()
  })

  it("nol delta MAVJUD qatorning `l` ini ham SURMAYDI", async () => {
    // Qator allaqachon bo'lsa ham nol delta qo'llanmasligi kerak: `nextWordRow`
    // `l` ni BUGUNGA ko'taradi va so'ndirishni qayta langarlaydi, ya'ni
    // terilmagan so'z "yaqinda mashq qilingan" bo'lib ko'rinardi.
    await seed({ words: [word('rhythm', { e: 10, x: 2, de: 10, dx: 2, f: dayNo(30), l: dayNo(30) })] })

    await writeAll('s-1', [withWords(makeSentence(), { rhythm: { exposures: 0, errors: 3 } })])

    expect((await readWords()).get('rhythm')).toMatchObject({
      e: 10,
      x: 2,
      de: 10,
      dx: 2,
      l: dayNo(30),
    })
  })

  it("yozilgan seansni `getSession` id bo'yicha topadi", async () => {
    await writeTwoSentenceSession()

    expect((await getSession('s-1'))?.correctKeystrokes).toBe(165)
    expect(await getSession('yoq')).toBeNull()
  })
})

describe('writeSentences — yaroqsiz kirish', () => {
  it("bo'sh `id` HECH NARSA yozmaydi va `false` qaytaradi", async () => {
    // ⚠️ SHARTNOMA O'ZGARDI: v1 da bo'sh id li seans YO'QOLMASDI — ombor unga
    // yangi id TIKLARDI. v2 da id seans BOSHIDA ajratiladi (§8.2.4), ya'ni bo'sh
    // id chaqiruvchidagi nuqson. Xatar o'sha-o'sha va u shu yerda mixlanadi:
    // YARIM YOZUV bo'lmasin — kunlik jadvalda gap turib, seansning o'zi yo'qolsa
    // `totals()` kun jadvali bilan ABADIY kelishmay qolardi.
    expect(await writeAll('', [withWords(makeSentence(), { the: { exposures: 3, errors: 1 } })])).toBe(
      false,
    )

    expect(await loadOverview()).toEqual({
      hasHistory: false,
      wordCount: 0,
      dayCount: 0,
      sessionCount: 0,
    })
    expect(await readLifetime()).toBeUndefined()
  })

  it("gapsiz ro'yxat HECH NARSA yozmaydi — yarim yozuv yo'q", async () => {
    expect(await writeAll('s-1', [])).toBe(false)

    expect(await loadOverview()).toEqual({
      hasHistory: false,
      wordCount: 0,
      dayCount: 0,
      sessionCount: 0,
    })
    expect(await readLifetime()).toBeUndefined()
  })

  it("ikkita HAR XIL id li seans bir-birini BOSMAYDI", async () => {
    await writeAll('s-1', [withWords(makeSentence())])
    await writeAll('s-2', [withWords(makeSentence())])

    expect(await loadOverview()).toMatchObject({ sessionCount: 2 })
    expect((await totals())?.sessions).toBe(2)
    expect((await readDays()).get(dayKey(0))?.sentences).toBe(2)
  })

  it("`writeSessionEnvelope` seans qatori YO'Q bo'lsa bo'sh yozuv YARATMAYDI", async () => {
    // Qator yo'qligi "bitta ham gap quyilmadi" degani, ya'ni bo'sh seans
    // yozuvini yaratish bo'sh seans darvozasini (PLAN §7) chetlab o'tardi.
    expect(await writeSessionEnvelope('yoq', envelopeFrom([makeSentence()]))).toBe(false)

    expect(await loadOverview()).toMatchObject({ sessionCount: 0 })
    expect(await getSession('yoq')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ⭐ §8.2 — GAP DARAJASIDAGI YOZUV SHARTNOMASI (§13 dagi eng jiddiy xatar)
// ---------------------------------------------------------------------------

describe('⭐ §8.2 yozuv shartnomasi', () => {
  /** Uchta gapni jonli seansdagidek KETMA-KET yozadi. */
  async function writeThreeSentences(): Promise<SentenceRecord[]> {
    const history: SentenceRecord[] = []
    const deltas: Array<Record<string, WordDelta>> = [
      { the: { exposures: 1, errors: 0 }, cat: { exposures: 1, errors: 1 } },
      { the: { exposures: 1, errors: 0 } },
      { the: { exposures: 1, errors: 0 } },
    ]
    for (const [index, delta] of deltas.entries()) {
      const record = makeSentence({ sentenceIndex: index })
      await writeAll('s-1', [withWords(record, delta)], history)
      history.push(record)
    }
    return history
  }

  it("⭐ IKKI MARTA SANASH YO'Q: uchta gap so'z/kun/umrbodni AYNAN bir marta sanaydi", async () => {
    await writeThreeSentences()

    // So'z: `the` uchta gapda, `cat` bittasida.
    const words = await readWords()
    expect(words.get('the')).toMatchObject({ e: 3, x: 0 })
    expect(words.get('cat')).toMatchObject({ e: 1, x: 1 })

    // Kun: uchta gap, uch marta 120 to'g'ri bosish.
    expect((await readDays()).get(dayKey(0))).toMatchObject({
      sentences: 3,
      correctKeystrokes: 360,
      activeMs: 180_000,
      k: 360,
      nc: 360,
    })

    // Umrbod: `sessions` AYNAN BIR MARTA oshgan — "birinchi gap" ni ombor
    // O'ZI aniqlaydi (seans qatori hali yo'q edimi), chaqiruvchi emas. Bayroq
    // chaqiruvchida tursa, u `pagehide` bilan yo'qolib, keyingi yozuv seansni
    // IKKINCHI marta sanardi.
    expect(await readLifetime()).toMatchObject({
      sessions: 1,
      activeMs: 180_000,
      keystrokes: 360,
      correctKeystrokes: 360,
      netChars: 360,
    })
    expect((await totals())?.sessions).toBe(1)

    // Seans qatori ham bitta, gaplar esa YIG'ILGAN — almashtirilmagan.
    expect(await loadOverview()).toMatchObject({ sessionCount: 1 })
    expect((await getSession('s-1'))?.sentences.map((r) => r.sentenceIndex)).toEqual([0, 1, 2])
  })

  it("⭐ §8.2.2: `meta.lifetime` HAR GAPDA oshadi — yopilishni KUTMAYDI", async () => {
    const first = makeSentence({ sentenceIndex: 0 })
    await writeAll('s-1', [withWords(first, { the: { exposures: 1, errors: 0 } })])

    // ⚠️ Seans HALI yopilmagan. `pagehide` aynan shu nuqtada sahifani o'ldirsa,
    // umrbod hisoblagichlar allaqachon diskda bo'lishi SHART — aks holda §4.3
    // dagi bosh to'g'rilik tuzatishi shu stsenariyning yagona qurboni bo'lardi.
    expect(await readLifetime()).toMatchObject({
      sessions: 1,
      activeMs: 60_000,
      keystrokes: 120,
      correctKeystrokes: 120,
      netChars: 120,
    })

    await writeAll('s-1', [withWords(makeSentence({ sentenceIndex: 1 }))], [first])
    expect(await readLifetime()).toMatchObject({ sessions: 1, activeMs: 120_000 })
  })

  it("⭐ §8.2.3: `writeSessionEnvelope` so'z/kun/umrbodga TEGMAYDI", async () => {
    const history = await writeThreeSentences()

    const wordsBefore = await readWords()
    const daysBefore = await readDays()
    const lifetimeBefore = await readLifetime()

    expect(await writeSessionEnvelope('s-1', envelopeFrom(history, { endedAt: timeAt(0, 11) }))).toBe(
      true,
    )

    // Bu yerda qayta qo'shish §8.1 dagi ikki marta sanashning to'g'ridan-to'g'ri
    // o'zi bo'lardi.
    expect(await readWords()).toEqual(wordsBefore)
    expect(await readDays()).toEqual(daysBefore)
    expect(await readLifetime()).toEqual(lifetimeBefore)

    // Yangilanadigan YAGONA narsa — konvert.
    const session = await getSession('s-1')
    expect(session?.endedAt).toBe(timeAt(0, 11))
    expect(session?.sentences).toHaveLength(3)
  })

  it("⭐ PLAN §7: butunlay `skipped` seans HECH NARSA yozmaydi", async () => {
    // ⚠️ Darvoza IKKI qatlamda: qaror `planSentenceWrite` da (sof, `core` da
    // sinalgan), yozuv esa shu yerda. Test ikkalasini BIRGA yuritadi — chunki
    // aynan chok buziladi: `writeSentences` ni har gapda so'zsiz chaqirish
    // darvozani jimgina ochib yuborardi.
    let pending: readonly SentenceWrite[] = []
    let hasWritten = false

    for (let index = 0; index < 3; index++) {
      const write = withWords(makeSentence({ sentenceIndex: index, skipped: true }))
      // ⚠️ Annotatsiya SHART: `pending`/`hasWritten` `plan` dan qayta
      // o'zlashtiriladi, ya'ni annotatsiyasiz TS generikni o'z-o'ziga bog'lab
      // `implicitly has type 'any'` (TS7022) beradi.
      const plan: SentenceWritePlan<SentenceWrite> = planSentenceWrite(pending, hasWritten, write)
      pending = plan.pending
      hasWritten = plan.hasWritten
      if (plan.write.length > 0) await writeAll('s-1', plan.write)
    }

    expect(hasWritten).toBe(false)
    expect(await loadOverview()).toEqual({
      hasHistory: false,
      wordCount: 0,
      dayCount: 0,
      sessionCount: 0,
    })
    expect(await readLifetime()).toBeUndefined()
  })

  it("⭐ §8.2.5: buferlangan `skipped` gaplar birinchi yozilgan gap bilan BIRGA quyiladi", async () => {
    let pending: readonly SentenceWrite[] = []
    let hasWritten = false
    const records: SentenceRecord[] = []

    const inputs = [
      makeSentence({ sentenceIndex: 0, skipped: true }),
      makeSentence({ sentenceIndex: 1, skipped: true }),
      makeSentence({ sentenceIndex: 2 }),
    ]
    for (const record of inputs) {
      const write = withWords(record, record.skipped ? {} : { the: { exposures: 1, errors: 0 } })
      // ⚠️ Annotatsiya SHART: `pending`/`hasWritten` `plan` dan qayta
      // o'zlashtiriladi, ya'ni annotatsiyasiz TS generikni o'z-o'ziga bog'lab
      // `implicitly has type 'any'` (TS7022) beradi.
      const plan: SentenceWritePlan<SentenceWrite> = planSentenceWrite(pending, hasWritten, write)
      pending = plan.pending
      hasWritten = plan.hasWritten
      if (plan.write.length > 0) {
        await writeAll('s-1', plan.write, records)
        records.push(...plan.write)
      }
    }

    // Uchala gap ham seans yozuviga tushdi — ular seans hajmini YEGAN...
    expect((await getSession('s-1'))?.sentences.map((r) => r.sentenceIndex)).toEqual([0, 1, 2])
    // ...lekin kun/so'z hisoblagichlarga faqat YOZILGANI kirdi.
    expect((await readDays()).get(dayKey(0))?.sentences).toBe(1)
    expect([...(await readWords()).keys()]).toEqual(['the'])
  })

  it("⭐ SO'NISH LANGARI: `l` si yo'q qator 2 yilda bazaviy darajaga tushadi", async () => {
    // M1 dagi BLOKER 1 ning IDB versiyasi: langar `meta.decayAnchorDay` da,
    // qatorning O'ZIDA emas — ya'ni migratsiya `l` ni tiklay olmagan qator ham
    // so'nadi. Langarni unutish uni ABADIY muzlatardi (§1.1 dagi fossil).
    // ⚠️ Bazaviy daraja beradigan IKKINCHI so'z SHART. Yagona qator bilan
    // `g = Σdx/Σde` aynan o'sha qatorning nisbatiga teng bo'lib qoladi va
    // shrinkage hech narsani siljitmaydi — ball so'nishdan QAT'IY NAZAR
    // o'zgarmasdi, ya'ni test hech nimani o'lchamasdi.
    await importJson(
      v1File({
        words: { fossil: { exposures: 50, errors: 25 }, the: { exposures: 600, errors: 12 } },
      }),
    )
    const anchor = await readAnchor()
    expect(anchor).toBe(dayNo())

    const row = (await readWords()).get('fossil')
    expect('l' in (row as object)).toBe(false)

    // Bugun ball urug'lantirilgan hisoblagichlardan chiqadi: de = 20, dx = 10.
    const gToday = (await measureG(NOW)) ?? 0
    const today = (await hardestWords(1))[0]
    expect(today?.word).toBe('fossil')
    expect(today?.score).toBeCloseTo(shrunk(10, 20, gToday), 12)

    // Ikki yildan keyin so'nuvchi juftlik ~0.0036 koeffitsiyentga qisqaradi va
    // ball bazaviy darajaga (`g`) tushadi — langar bo'lmaganda u 0.38 da
    // ABADIY muzlab turardi.
    const later = timeAt(-730)
    const after = (await hardestWords(1, 20, later))[0]
    const g = (await measureG(later)) ?? 0
    expect(after?.word).toBe('fossil')
    expect(after?.score).toBeLessThan(today?.score ?? 0)
    expect(after?.score).toBeCloseTo(g, 2)
    // Umrbod hisoblagichlar esa o'zgarmaydi — so'nish ularga tegmaydi.
    expect(after?.exposures).toBe(50)
    expect(after?.errors).toBe(25)
  })
})

/** `shrunkScore` ning testdagi nusxasi — kutilgan ballni QO'LDA yozmaslik uchun. */
function shrunk(dx: number, de: number, g: number): number {
  return (dx + SHRINKAGE_M * g) / (de + SHRINKAGE_M)
}

// ---------------------------------------------------------------------------
// Umumiy yig'indi
// ---------------------------------------------------------------------------

describe('totals', () => {
  it("boot'dan keyin bo'sh omborda XOM sonlar 0, NISBATLAR esa `null` (o'lchov yo'q)", async () => {
    // ⚠️ `initStats()` migratsiyani yuritadi va u umrbod konvertni HAR DOIM
    // yozadi — bo'sh ombor uchun ham. Shuning uchun XOM sonlardagi nol NOL,
    // "noma'lum" emas.
    //
    // ⚠️ SHARTNOMA O'ZGARDI: nisbatlar endi 0 EMAS, `null`. Ilgari 0 "chalg'ituvchi
    // 100% ko'rsatmaslik" uchun tanlangan edi, lekin u boshqa yolg'onni aytardi —
    // "0 wpm bilan tergansiz". `null` esa AYNAN "o'lchov yo'q" degani va tip
    // ekranni uni ko'rsatishga majburlaydi.
    expect(await initStats(NOW)).toBe('ready')

    expect(await totals()).toEqual({
      sessions: 0,
      activeMs: 0,
      correctKeystrokes: 0,
      keystrokes: 0,
      netChars: 0,
      netWpm: null,
      accuracy: null,
    })
  })

  it("⭐ `meta` YO'Q bo'lsa `null` — 'noma'lum' nol bilan ARALASHTIRILMAYDI (§4.3)", async () => {
    // F4: yo'q konvert uchun `emptyLifetime()` qaytarish QISMAN sonni yalang'och
    // umrbod raqam deb ko'rsatardi. Farq TIPDA: UI "noma'lum" chizadi, nol emas.
    await seed({ words: [word('the', { e: 10, x: 2, de: 10, dx: 2 })] })

    expect(await totals()).toBeNull()
    // Ombor esa ISHLAYAPTI — "meta yo'q" "IDB yo'q" degani emas.
    expect(await loadOverview()).toMatchObject({ hasHistory: true, wordCount: 1 })
  })

  it("bir necha seansni qo'lda hisoblangan qiymatlarga aynan teng yig'adi", async () => {
    await writeTwoSentenceSession()
    await writeAll('s-2', [
      withWords(
        makeSentence({
          at: timeAt(1, 9),
          activeMs: 60_000,
          keystrokes: 60,
          correctKeystrokes: 60,
          netWpm: 12,
          rawWpm: 12,
        }),
      ),
    ])

    const t = await totals()
    expect(t?.sessions).toBe(2)
    expect(t?.activeMs).toBe(150_000)
    // netChars = 120 + 45 + 60 = 225; 225 / 5 / 2.5 daqiqa = 18.
    expect(t?.netWpm).toBe(18)
    expect(t?.accuracy).toBe(225 / 240)
    // Marker YO'Q -> oyna BUTUN tarixni qamraydi -> belgi ham qo'yilmaydi.
    expect(t?.ratiosSince).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // ⭐ BLOKER: nisbatlar IZCHIL OYNADAN, konvertdan EMAS
  // -------------------------------------------------------------------------

  /**
   * Migratsiyadan keyingi omborning AYNAN nomutanosib holati (§4.3 jadvali):
   *
   *   - `dayKey(20)` — migratsiyadan OLDINGI kun. Baza uchtasi v1 `days` dan
   *     TO'LIQ keldi, `k`/`nc` esa YO'Q: o'sha kunning seansi qisqartirilgan.
   *   - `dayKey(5)`  — migratsiyadan KEYINGI kun, butunlay v2 yozuv yo'lidan:
   *     to'rtala maydon ham AYNI gaplardan.
   *
   * Konvert §4.3 bo'yicha to'ldirilgan: `activeMs`/`correctKeystrokes` IKKALA
   * kundan (TO'LIQ), `netChars`/`keystrokes` esa faqat omon qolgan seansdan
   * (QISMAN).
   */
  async function seedMismatchedLifetime(): Promise<void> {
    await seed({
      migratedAt: timeAt(10),
      days: [
        { d: dayKey(20), correctKeystrokes: 900, activeMs: 600_000, sentences: 10 },
        { d: dayKey(5), correctKeystrokes: 96, activeMs: 60_000, sentences: 1, k: 100, nc: 200 },
      ],
      lifetime: {
        activeMs: 660_000, // 600_000 + 60_000 — `days` dan TO'LIQ
        correctKeystrokes: 996, // 900 + 96 — `days` dan TO'LIQ
        netChars: 200, // faqat omon qolgan seansdan — QISMAN
        keystrokes: 100, // faqat omon qolgan seansdan — QISMAN
        sessions: 1,
        netCharsSince: dayNo(5),
        keystrokesSince: dayNo(5),
        sessionsSince: dayNo(5),
      },
    })
  }

  it("⭐ BLOKER: nisbat SURATI va MAXRAJI bir oynadan — konvertdagi aralashma EMAS", async () => {
    // ⚠️ Konvertdan hisoblaganda chiqadigan sonlar (eski, BUZUQ yo'l):
    //     netWpm   = 200 / 5 / 11 daqiqa = 3.64   (DOIM past)
    //     accuracy = 996 / 100 = 9.96 -> clamp01 -> 1.00   (DOIM 100%)
    // Ya'ni migratsiyagacha tarixi bor HAR BIR foydalanuvchining aniqlik
    // plitkasi "100.0%" bo'lib qolardi. Bu v1 ga nisbatan REGRESSIYA edi:
    // v1 da ikkala son ham AYNI `sessions` massividan olinardi.
    await seedMismatchedLifetime()

    const t = await totals()

    // Izchil oyna = faqat `dayKey(5)`: 200 net belgi / 5 / 1 daqiqa = 40 wpm,
    // 96 to'g'ri / 100 bosish = 96%.
    expect(t?.netWpm).toBe(40)
    expect(t?.accuracy).toBe(0.96)
    // ⚠️ Eski, buzuq qiymatlar QAYTMASLIGI mixlanadi.
    expect(t?.accuracy).not.toBe(1)
    expect(t?.netWpm).not.toBeCloseTo(200 / 5 / 11, 6)
  })

  it("⭐ oyna TOR bo'lsa `ratiosSince` NISBATLAR qaysi kundan o'lchanganini aytadi", async () => {
    await seedMismatchedLifetime()

    // Migratsiya kunining O'ZI ham chiqariladi, ya'ni birinchi izchil kun —
    // undan KEYINGISI.
    expect((await totals())?.ratiosSince).toBe(dayNo(10) + 1)
  })

  it("⭐ XOM hisoblagichlar O'ZGARISHSIZ konvertdan keladi — ular TO'G'RI edi", async () => {
    // Tuzatish faqat NISBATGA tegadi. Xom sonlar §4.3 bo'yicha to'g'ri va
    // ularning halolligi `*Since` belgilari orqali UI ga topshiriladi.
    await seedMismatchedLifetime()

    expect(await totals()).toMatchObject({
      sessions: 1,
      activeMs: 660_000,
      correctKeystrokes: 996,
      keystrokes: 100,
      netChars: 200,
      netCharsSince: dayNo(5),
      keystrokesSince: dayNo(5),
      sessionsSince: dayNo(5),
    })
  })

  it("⭐ migratsiya KUNINING O'ZI oynadan chiqariladi — u ARALASH bo'lishi mumkin", async () => {
    // Migratsiya kunida yozilgan kun qatorida v1 dan kelgan baza uchtasi ham,
    // o'sha kuni v2 yo'li bilan yozilgan `k`/`nc` ham bo'lishi mumkin — ya'ni
    // to'rtala maydon AYNI gaplardan degan kafolat AYNAN shu kunda buziladi.
    await seed({
      migratedAt: timeAt(3),
      days: [{ d: dayKey(3), correctKeystrokes: 96, activeMs: 60_000, sentences: 1, k: 100, nc: 200 }],
      lifetime: {
        activeMs: 60_000,
        correctKeystrokes: 96,
        netChars: 200,
        keystrokes: 100,
        sessions: 1,
      },
    })

    const t = await totals()
    expect(t?.netWpm).toBeNull()
    expect(t?.accuracy).toBeNull()
    // Oyna TOR (migratsiya kunida qator bor) -> belgi QO'YILADI.
    expect(t?.ratiosSince).toBe(dayNo(3) + 1)
  })

  it("migratsiyadan OLDIN kun BO'LMASA oyna butun tarix — `ratiosSince` YO'Q", async () => {
    await seed({
      migratedAt: timeAt(10),
      days: [{ d: dayKey(5), correctKeystrokes: 96, activeMs: 60_000, sentences: 1, k: 100, nc: 200 }],
      lifetime: {
        activeMs: 60_000,
        correctKeystrokes: 96,
        netChars: 200,
        keystrokes: 100,
        sessions: 1,
      },
    })

    const t = await totals()
    expect(t?.netWpm).toBe(40)
    expect(t?.ratiosSince).toBeUndefined()
  })

  it("⚠️ oynadagi `k`/`nc` SIZ kun BUTUNLAY tashlanadi — maxrajni yolg'iz shishirmasin", async () => {
    // Bunday qator oynaga faqat begona/qo'lda tahrirlangan import fayli orqali
    // tushadi (v2 yozuv yo'li ikkalasini ham HAR DOIM yozadi). Uni qo'shish
    // aynan tuzatilayotgan xatoni qaytarardi: `activeMs` maxrajga tushib,
    // `nc` surati esa tushmasdi.
    await seed({
      migratedAt: timeAt(10),
      days: [
        { d: dayKey(5), correctKeystrokes: 96, activeMs: 60_000, sentences: 1, k: 100, nc: 200 },
        // `k`/`nc` YO'Q: qo'shilsa netWpm 40 -> 20 ga tushardi.
        { d: dayKey(4), correctKeystrokes: 900, activeMs: 60_000, sentences: 9 },
      ],
      lifetime: {
        activeMs: 120_000,
        correctKeystrokes: 996,
        netChars: 200,
        keystrokes: 100,
        sessions: 1,
      },
    })

    expect((await totals())?.netWpm).toBe(40)
    expect((await totals())?.accuracy).toBe(0.96)
  })
})

// ---------------------------------------------------------------------------
// Kunlik trend
// ---------------------------------------------------------------------------

describe('dailySeries', () => {
  it("oxirgi N kun eskidan yangiga, bugun doim oxirgi element", async () => {
    await writeTwoSentenceSession()
    await writeAll('s-2', [
      withWords(
        makeSentence({ at: timeAt(2, 9), keystrokes: 60, correctKeystrokes: 60, netWpm: 12 }),
      ),
    ])

    const series = await dailySeries(3, NOW)

    expect(series.map((p) => p.day)).toEqual([dayKey(2), dayKey(1), dayKey(0)])
    // ⭐ `nc` bor kunda WPM ANIQ (§4.2) — `approx: false`.
    expect(series[0]).toEqual({ day: dayKey(2), netWpm: 12, correctKeystrokes: 60, approx: false })
    // Ma'lumotsiz kun bo'shliq emas, aniq nol bo'lishi kerak (grafik uzilib qolmasin).
    expect(series[1]).toEqual({ day: dayKey(1), netWpm: 0, correctKeystrokes: 0, approx: false })
    expect(series[2]).toEqual({ day: dayKey(0), netWpm: 22, correctKeystrokes: 165, approx: false })
  })

  it("`nc` YO'Q kun TAQRIBIY hisoblanadi: to'g'ri bosishlar / 5 / daqiqa, `approx: true`", async () => {
    // Migratsiyada tiklanmagan kunlar aynan shunday: `nc` yo'q, ya'ni
    // backspace'dan keyin qayta yozilgan harf IKKI MARTA sanaladi. Bayroq
    // chaqiruvchiga CHIQARILADI — UI bunday kunni "o'lchanmagan" deb ko'rsatishi
    // kerak, jimgina aniq son sifatida emas (`PLAN.md` §11.3, 4-invariant).
    await seed({
      days: [{ d: dayKey(0), correctKeystrokes: 150, activeMs: 60_000, sentences: 2 }],
    })

    expect(await dailySeries(1, NOW)).toEqual([
      { day: dayKey(0), netWpm: 30, correctKeystrokes: 150, approx: true },
    ])
  })

  it("nol yoki manfiy so'rov bo'sh massiv beradi", async () => {
    await seed({ days: daysFrom([[0, 150]]) })

    expect(await dailySeries(0, NOW)).toEqual([])
    expect(await dailySeries(-7, NOW)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Seans yozuvlari (§9.4)
// ---------------------------------------------------------------------------

describe('seans yozuvlari', () => {
  /** `endedAt` si `offset` kun oldin bo'lgan minimal seans qatori. */
  function session(id: string, offset: number): SessionRecord {
    return {
      id,
      lessonId: 'l1',
      lessonTitle: 'Sinov',
      startedAt: timeAt(offset, 9),
      endedAt: timeAt(offset, 10),
      sentences: [],
      activeMs: 60_000,
      keystrokes: 120,
      correctKeystrokes: 120,
      netWpm: 24,
      rawWpm: 24,
      accuracy: 1,
    }
  }

  it("`recentSessions` YANGIDAN ESKIGA qaytaradi va `limit` da to'xtaydi", async () => {
    await seed({ sessions: [session('eski', 3), session("o'rta", 2), session('yangi', 1)] })

    expect((await recentSessions(10)).map((s) => s.id)).toEqual(['yangi', "o'rta", 'eski'])
    expect((await recentSessions(2)).map((s) => s.id)).toEqual(['yangi', "o'rta"])
    expect(await recentSessions(0)).toEqual([])
  })

  it("`previousSession` `by_endedAt` bo'yicha TESKARI yurib qo'shnisini topadi", async () => {
    await seed({ sessions: [session('eski', 3), session("o'rta", 2), session('yangi', 1)] })

    const current = (await getSession("o'rta")) as SessionRecord
    expect((await previousSession(current))?.id).toBe('eski')

    // Eng eskisidan oldin hech narsa yo'q.
    expect(await previousSession((await getSession('eski')) as SessionRecord)).toBeNull()
  })

  it("`previousSession` joriy seansning O'ZINI va undan YANGIROQLARINI o'tkazib yuboradi", async () => {
    // Joriy seans hali yozilmagan bo'lishi ham mumkin — kursor eng yangisidan
    // boshlanadi, shuning uchun ikkala qorovul ham kerak.
    await seed({ sessions: [session('eski', 3), session('yangi', 1)] })

    const notYetWritten = session('hali-yozilmagan', 2)
    expect((await previousSession(notYetWritten))?.id).toBe('eski')
  })
})

// ---------------------------------------------------------------------------
// Hammasini o'chirish
// ---------------------------------------------------------------------------

describe('clearStats', () => {
  it("statistikani butunlay o'chiradi", async () => {
    await writeTwoSentenceSession({ the: { exposures: 3, errors: 1 } })
    expect((await totals())?.sessions).toBe(1)

    await clearStats(NOW)

    expect(await loadOverview()).toEqual({
      hasHistory: false,
      wordCount: 0,
      dayCount: 0,
      sessionCount: 0,
    })
    // ⭐ Konvert BO'SH holatda QAYTA yoziladi, shunchaki o'chirilmaydi: aks holda
    // keyingi gap `lifetimeForWrite` ning ta'mirlash shoxiga tushib, hamma sonni
    // "bugundan beri" deb belgilardi.
    expect(await totals()).toEqual({
      sessions: 0,
      activeMs: 0,
      correctKeystrokes: 0,
      keystrokes: 0,
      netChars: 0,
      netWpm: null,
      accuracy: null,
    })
    expect(await hardestWords()).toEqual([])
    expect(await streakDays(NOW)).toBe(0)
  })

  it("darslar kalitiga tegmaydi, v1 nusxasini esa O'CHIRADI (§9.3)", async () => {
    localStorage.setItem(LESSONS_KEY, '[]')
    localStorage.setItem(STATS_V1_KEY, v1File({ words: { the: { exposures: 3, errors: 1 } } }))
    await writeTwoSentenceSession()

    await clearStats(NOW)

    expect(localStorage.getItem(LESSONS_KEY)).toBe('[]')
    // "Hammasini o'chir" dan keyin o'sha ma'lumotning YASHIRIN nusxasi qolib
    // ketishi va'daga zid bo'lardi. Ustiga u keyingi boot'da qayta ko'chirilib,
    // o'chirilgan tarix TIRILARDI.
    expect(localStorage.getItem(STATS_V1_KEY)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ⭐ M2/M3 gate (PLAN §8)
// ---------------------------------------------------------------------------

describe('audioComparison — ⭐ M2/M3 gate (PLAN §8)', () => {
  it("gaplarni ovoz holati bo'yicha ajratadi", async () => {
    await writeAll('s-1', [
      withWords(makeSentence({ audioEnabled: true })),
      withWords(makeSentence({ sentenceIndex: 1, audioEnabled: false })),
      withWords(makeSentence({ sentenceIndex: 2, audioEnabled: false })),
    ])

    const result = await audioComparison()
    expect(result.on.sentences).toBe(1)
    expect(result.off.sentences).toBe(2)
    expect(result.unknown).toBe(0)
  })

  it("ovoz holati YOZILMAGAN eski gaplar taqqoslashga kirmaydi", async () => {
    await writeAll('s-1', [
      withWords(makeSentence({ audioEnabled: true })),
      withWords(makeSentence({ sentenceIndex: 1 })), // maydonsiz — eski yozuv
    ])

    const result = await audioComparison()
    expect(result.on.sentences).toBe(1)
    // Eng muhimi: yo'q maydon "ovozsiz" ustuniga TUSHMAYDI.
    expect(result.off.sentences).toBe(0)
    expect(result.unknown).toBe(1)
  })

  it("`skipped` gap ikkala ustunga ham kirmaydi", async () => {
    await writeAll('s-1', [
      withWords(makeSentence({ audioEnabled: true })),
      withWords(makeSentence({ sentenceIndex: 1, audioEnabled: true, skipped: true })),
    ])

    const result = await audioComparison()
    expect(result.on.sentences).toBe(1)
    expect(result.unknown).toBe(0)
  })

  it("wpm `activeMs` bo'yicha og'irlanadi — qisqa gap uzun gapga teng vazn olmaydi", async () => {
    await writeAll('s-1', [
      withWords(makeSentence({ audioEnabled: true, activeMs: 60_000, netWpm: 24, rawWpm: 24 })),
      withWords(
        makeSentence({
          sentenceIndex: 1,
          audioEnabled: true,
          activeMs: 30_000,
          netWpm: 18,
          rawWpm: 24,
          keystrokes: 60,
          correctKeystrokes: 45,
        }),
      ),
    ])

    const result = await audioComparison()
    // (24·60000 + 18·30000) / 90000 = 22 — sodda o'rtacha 21 bo'lardi.
    expect(result.on.netWpm).toBe(22)
    expect(result.on.accuracy).toBe(165 / 180)
  })

  it("bir nechta seansdagi gaplar yig'iladi", async () => {
    await writeAll('s-1', [withWords(makeSentence({ audioEnabled: true }))])
    await writeAll('s-2', [withWords(makeSentence({ audioEnabled: true }))])

    expect((await audioComparison()).on.sentences).toBe(2)
  })

  it("ma'lumot yo'q bo'lsa nollar qaytadi, xato bermaydi", async () => {
    const result = await audioComparison()
    expect(result.on.sentences).toBe(0)
    expect(result.on.netWpm).toBe(0)
    expect(result.on.accuracy).toBe(0)
    expect(result.unknown).toBe(0)
  })

  it("eksport/import ovoz holatini saqlaydi", async () => {
    await writeAll('s-1', [
      withWords(makeSentence({ audioEnabled: true })),
      withWords(makeSentence({ sentenceIndex: 1, audioEnabled: false })),
    ])
    const dump = await exportJson()
    await clearStats(NOW)
    expect((await audioComparison()).on.sentences).toBe(0)

    expect(await importJson(dump)).toEqual({ ok: true })

    const result = await audioComparison()
    expect(result.on.sentences).toBe(1)
    expect(result.off.sentences).toBe(1)
    expect(result.unknown).toBe(0)
  })

  it("⭐ §1.3: seanslar QISQARTIRILGANDAN keyin ham gate TO'LIQ yashaydi", async () => {
    // ⚠️ Bu funksiyaning manbasi endi `sessions` EMAS, `days`. §1.3 aynan shu
    // nuqsonni ta'riflaydi: v1 da gate faqat seans yozuvlarini o'qirdi, seanslar
    // esa tashlanadi — ya'ni loyihaning butun pedagogik farazini tekshiradigan
    // YAGONA o'lchov asbobi eskirish bilan JIMGINA zaiflashardi.
    const old = timeAt(400, 9)
    await writeAll(
      'eski',
      [
        withWords(makeSentence({ at: old, audioEnabled: true })),
        withWords(makeSentence({ at: old, sentenceIndex: 1, audioEnabled: false })),
      ],
      [],
      { startedAt: old, endedAt: old },
    )
    await writeAll('yangi', [withWords(makeSentence({ audioEnabled: true }))])

    const before = await audioComparison()
    expect(before.on.sentences).toBe(2)
    expect(before.off.sentences).toBe(1)

    // 180 kunlik retention eski seansni o'chiradi...
    expect(await compactSessions(NOW)).toBe(1)
    expect(await loadOverview()).toMatchObject({ sessionCount: 1 })

    // ...gate esa O'ZGARMAYDI: `days` HECH QACHON qisqartirilmaydi.
    expect(await audioComparison()).toEqual(before)
  })
})

// `dnt-stats` IndexedDB ulanishi — INGICHKA o'ram (docs/stats-longterm.md §8.4).
//
// Bu fayl statistika mantiqini BILMAYDI: u faqat bazani ochadi, sxemani
// yaratadi va tranzaksiya/kursor ustida xavfsiz yuzani beradi. Qator tiplari
// va ular ustidagi arifmetika qo'shni `statsSchema.ts` da.
//
// ⚠️ §8.4 dagi TO'RTTA operatsion tuzoq — kesh, bloklanish, sxema, muhit
// farqlari — endi `idb.ts` dagi UMUMIY fabrikada hal qilingan: ikkinchi baza
// (`dnt-notes`) qo'shilganda o'sha mantiqning nusxasi ikkita HAR XIL
// xatti-harakatga aylanardi. Bu fayl o'sha fabrikaning statistika nusxasi:
// nomi, versiyasi, sxemasi va bloklanish tipi shu yerda.
//
// Ommaviy yuza O'ZGARMAGAN (`openDb`, `closeDb`, `deleteDb`, `runTx`,
// `withStatsDb`, `eachCursor`) — iste'molchilar va testlar avvalgidek shu
// fayldan import qiladi.

import { createIdbHandle } from './idb.ts'
import {
  DB_NAME,
  DB_VERSION,
  INDEX_SESSIONS_BY_ENDED_AT,
  INDEX_WORDS_BY_L,
  STORE_DAYS,
  STORE_META,
  STORE_SESSIONS,
  STORE_WORDS,
} from './statsSchema.ts'

export { runTx, eachCursor } from './idb.ts'
export type { TxBody } from './idb.ts'

/**
 * Boshqa tab eski versiyani ushlab turgani uchun ish bajarilmadi (§8.4b).
 *
 * ALOHIDA tip: chaqiruvchi buni "IDB umuman yo'q" holatidan (`openDb()` →
 * `null`) farqlashi shart, chunki bannerdagi maslahat butunlay boshqa —
 * "boshqa tabni yoping" va "bu brauzerda statistika saqlanmaydi".
 */
export class StatsDbBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StatsDbBlockedError'
  }
}

/**
 * (§8.4c) Sxema FAQAT shu yerda — `onupgradeneeded` ichida — yaratiladi.
 *
 * `createObjectStore` va `createIndex` boshqa joyda umuman ishlamaydi:
 * ular `versionchange` tranzaksiyasini talab qiladi, va uni faqat brauzer
 * versiya o'sganda beradi. Shuning uchun har qanday do'kon/indeks o'zgarishi
 * `DB_VERSION` ni oshirishni TALAB qiladi.
 */
function createSchemaV1(db: IDBDatabase): void {
  const words = db.createObjectStore(STORE_WORDS, { keyPath: 'w' })
  // `l` si yo'q qatorlar bu indeksga TUSHMAYDI — bu ATAYIN (§9.1: migratsiyada
  // tiklanmagan "oxirgi kun" noma'lum bo'lib qoladi, soxta sana OLMAYDI).
  words.createIndex(INDEX_WORDS_BY_L, 'l')

  db.createObjectStore(STORE_DAYS, { keyPath: 'd' })

  const sessions = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' })
  // TESKARI kursor uchun (§9.4): `previousSession` butun omborni yuklab
  // saralamasin — bitta qadamda oxirgi seansni olsin.
  sessions.createIndex(INDEX_SESSIONS_BY_ENDED_AT, 'endedAt')

  // `keyPath` YO'Q — out-of-line: kalit (`META_KEY_LIFETIME`) qiymatdan tashqarida.
  db.createObjectStore(STORE_META)
}

const handle = createIdbHandle({
  name: DB_NAME,
  version: DB_VERSION,
  upgrade: (db, oldVersion) => {
    // `oldVersion` tekshiruvi kelajakdagi v2 uchun: v1 do'konlarini ikkinchi
    // marta yaratish `ConstraintError` berardi.
    if (oldVersion < 1) createSchemaV1(db)
  },
  blockedError: (message) => new StatsDbBlockedError(message),
})

export const openDb = handle.openDb
export const closeDb = handle.closeDb
export const deleteDb = handle.deleteDb

/**
 * `openDb()` + `runTx()` — statistika iste'molchilari uchun YAGONA yuqori
 * darajali yuza (§8.2). Xatti-harakati `idb.ts` da tushuntirilgan: IDB yo'q
 * bo'lsa `false`/`null`, bloklanishda `StatsDbBlockedError`, o'lgan ulanishda
 * bir marta qayta ulanish.
 */
export const withStatsDb = handle.withDb

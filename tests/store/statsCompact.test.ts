// `statsCompact.ts` — 180 kunlik retention (docs/stats-longterm.md §4.4, §12 M4).
//
// Muhit: `fake-indexeddb/auto` `vitest.config.ts` dagi `store` proyektining
// `setupFiles` ida ulanadi.

import { afterEach, describe, expect, it } from 'vitest'

import { closeDb, deleteDb, openDb, runTx } from '../../src/store/statsDb.ts'
import { STORE_DAYS, STORE_SESSIONS, STORE_WORDS } from '../../src/store/statsSchema.ts'
import { RETENTION_DAYS, compactSessions } from '../../src/store/statsCompact.ts'

/** Sinov uchun qat'iy "hozir": 2026-06-15, tush payti. */
const NOW = new Date(2026, 5, 15, 12, 0, 0, 0).getTime()

/**
 * `NOW` dan `n` kun oldingi tush payti.
 *
 * `setDate()` bilan suriladi, `n * 86_400_000` bilan EMAS: DST o'tgan oraliqda
 * millisekund ayirmasi bir kunni tashlab ketardi va chegara testi jimgina
 * noto'g'ri kunni sinardi (`stats.ts` dagi `startOfLocalDay` bilan bir xil sabab).
 */
function daysAgo(n: number): number {
  const d = new Date(NOW)
  d.setDate(d.getDate() - n)
  return d.getTime()
}

async function open(): Promise<IDBDatabase> {
  const db = await openDb()
  if (db === null) throw new Error('test muhitida IndexedDB ochilmadi')
  return db
}

/** Seanslarni `id -> necha kun oldin tugagan` juftliklaridan quyadi. */
function seedSessions(db: IDBDatabase, ages: Record<string, number>): Promise<void> {
  return runTx(db, [STORE_SESSIONS], 'readwrite', (tx) => {
    const store = tx.objectStore(STORE_SESSIONS)
    for (const [id, age] of Object.entries(ages)) {
      store.put({ id, endedAt: daysAgo(age), sentences: [] })
    }
  })
}

function sessionIds(db: IDBDatabase): Promise<string[]> {
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

afterEach(async () => {
  closeDb()
  await deleteDb()
})

describe('compactSessions (§4.4)', () => {
  it('RETENTION_DAYS dan eski seanslar o\'chadi, yangilari qoladi', async () => {
    const db = await open()
    await seedSessions(db, { eski: 400, chegara: 181, yangi: 10, bugun: 0 })

    const removed = await compactSessions(NOW)

    expect(removed).toBe(2)
    expect(await sessionIds(db)).toEqual(['bugun', 'yangi'])
  })

  it('AYNAN RETENTION_DAYS kunlik seans QOLADI, bir kun eskirog\'i o\'chadi', async () => {
    const db = await open()
    // Chegara ochiq-oydin sinaladi: "180 kun saqlanadi" degani 180-kunlik
    // yozuv HALI saqlanadi degani. Bir kunlik siljish yillar davomida
    // sezilmasdi, lekin va'da bilan kod ayrilib ketardi.
    await seedSessions(db, { qoladi: RETENTION_DAYS, ochadi: RETENTION_DAYS + 1 })

    const removed = await compactSessions(NOW)

    expect(removed).toBe(1)
    expect(await sessionIds(db)).toEqual(['qoladi'])
  })

  it('o\'chiradigan narsa bo\'lmasa 0 qaytadi va hech narsa yo\'qolmaydi', async () => {
    const db = await open()
    await seedSessions(db, { a: 1, b: 2, c: 3 })

    expect(await compactSessions(NOW)).toBe(0)
    expect(await sessionIds(db)).toEqual(['a', 'b', 'c'])
  })

  it('bo\'sh omborda 0 qaytadi (kursor birorta qator bermaydi)', async () => {
    await open()
    // Kursor birorta qator bermaydi, ya'ni `collect` UMUMAN chaqirilmaydi —
    // natija `runTx` ga berilgan boshlang'ich `0` dan kelishi shart.
    expect(await compactSessions(NOW)).toBe(0)
  })

  it('⚠️ `words` va `days` ga UMUMAN tegmaydi — ular ABADIY', async () => {
    const db = await open()
    await seedSessions(db, { eski: 400 })
    await runTx(db, [STORE_WORDS, STORE_DAYS], 'readwrite', (tx) => {
      tx.objectStore(STORE_WORDS).put({ w: 'the', e: 120, x: 3, de: 8, dx: 0.4, s: 5, b: 9 })
      tx.objectStore(STORE_DAYS).put({
        d: '2024-01-01',
        correctKeystrokes: 900,
        activeMs: 60_000,
        sentences: 12,
      })
    })

    expect(await compactSessions(NOW)).toBe(1)

    const kept = await runTx<{ words: number; days: number }>(
      db,
      [STORE_WORDS, STORE_DAYS],
      'readonly',
      (tx, collect) => {
        const wordsReq = tx.objectStore(STORE_WORDS).count()
        wordsReq.onsuccess = () => {
          const daysReq = tx.objectStore(STORE_DAYS).count()
          daysReq.onsuccess = () => collect({ words: wordsReq.result, days: daysReq.result })
        }
      },
      { words: -1, days: -1 },
    )

    expect(kept).toEqual({ words: 1, days: 1 })
  })

  it('IDB yo\'q bo\'lsa 0 qaytadi va TASHLAMAYDI (§8.4d)', async () => {
    closeDb()
    const real = globalThis.indexedDB
    Reflect.deleteProperty(globalThis, 'indexedDB')

    try {
      await expect(compactSessions(NOW)).resolves.toBe(0)
    } finally {
      globalThis.indexedDB = real
    }
  })
})

// `statsDb.ts` — IndexedDB o'ramining §8.4 dagi TO'RTTA majburiy talabi
// (docs/stats-longterm.md). Har bir describe bloki bitta bandga to'g'ri keladi.
//
// Muhit: `fake-indexeddb/auto` `vitest.config.ts` dagi `store` proyektining
// `setupFiles` ida ulanadi — ishlab chiqarish kodida u UMUMAN import qilinmaydi.

import { afterEach, describe, expect, it } from 'vitest'
import { forceCloseDatabase } from 'fake-indexeddb'

import {
  DB_NAME,
  DB_VERSION,
  INDEX_SESSIONS_BY_ENDED_AT,
  INDEX_WORDS_BY_L,
  STORE_DAYS,
  STORE_META,
  STORE_SESSIONS,
  STORE_WORDS,
} from '../../src/store/statsSchema.ts'
import type { DayRow } from '../../src/store/statsSchema.ts'
import {
  StatsDbBlockedError,
  closeDb,
  deleteDb,
  eachCursor,
  openDb,
  runTx,
  withStatsDb,
} from '../../src/store/statsDb.ts'

/** `openDb()` `null` qaytarsa test muhitining o'zi buzuq — darrov yiqiladi. */
async function open(): Promise<IDBDatabase> {
  const db = await openDb()
  if (db === null) throw new Error('test muhitida IndexedDB ochilmadi')
  return db
}

const DAY = '2024-03-01'

function emptyDay(d: string): DayRow {
  return { d, correctKeystrokes: 0, activeMs: 0, sentences: 0 }
}

/** Bitta kun qatorini o'qiydi (`undefined` — qator yo'q). */
function readDay(db: IDBDatabase, d: string): Promise<DayRow | undefined> {
  return runTx<DayRow | undefined>(
    db,
    [STORE_DAYS],
    'readonly',
    (tx, collect) => {
      const req = tx.objectStore(STORE_DAYS).get(d)
      req.onsuccess = () => collect(req.result as DayRow | undefined)
    },
    undefined,
  )
}

/**
 * `openDb()` ni chetlab o'tadigan XOM ulanish — `onversionchange`/`onclose`
 * osilmaydi, ya'ni u boshqa tabning "band ushlab turuvchi"si rolini o'ynaydi.
 */
function rawOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('xom ochilish yiqildi'))
  })
}

/**
 * "Brauzer ulanishni G'AYRIODDIY yopdi" ni simulyatsiya qiladi — DevTools yoki
 * "sayt ma'lumotini tozalash" bilan bir xil yo'l. `fake-indexeddb` bu yerda
 * `close` hodisasini HAQIQATAN dispatch qiladi, ya'ni handler qo'lda emas,
 * tinglovchi sifatida sinaladi.
 *
 * Kast kerak: paketning `types.d.ts` si argumentni `typeof FDBDatabase`
 * (KONSTRUKTOR) deb e'lon qiladi — upstream tipografik xatosi; kutilayotgani
 * esa ulanishning O'ZI.
 */
function forceClose(db: IDBDatabase): void {
  ;(forceCloseDatabase as unknown as (connection: IDBDatabase) => void)(db)
}

afterEach(async () => {
  closeDb()
  await deleteDb()
})

// ---------------------------------------------------------------------------
// §8.4c — sxema FAQAT `onupgradeneeded` ichida
// ---------------------------------------------------------------------------

describe('sxema (§8.4c)', () => {
  it('to\'rtta do\'kon yaratiladi', async () => {
    const db = await open()

    expect(db.objectStoreNames.length).toBe(4)
    expect(db.objectStoreNames.contains(STORE_WORDS)).toBe(true)
    expect(db.objectStoreNames.contains(STORE_DAYS)).toBe(true)
    expect(db.objectStoreNames.contains(STORE_SESSIONS)).toBe(true)
    expect(db.objectStoreNames.contains(STORE_META)).toBe(true)
  })

  it('ikkita indeks yaratiladi', async () => {
    const db = await open()
    const tx = db.transaction([STORE_WORDS, STORE_SESSIONS], 'readonly')

    expect(tx.objectStore(STORE_WORDS).indexNames.contains(INDEX_WORDS_BY_L)).toBe(true)
    expect(tx.objectStore(STORE_SESSIONS).indexNames.contains(INDEX_SESSIONS_BY_ENDED_AT)).toBe(
      true,
    )
  })

  it('kalit yo\'llari §4 ga mos, `meta` esa out-of-line', async () => {
    const db = await open()
    const tx = db.transaction([STORE_WORDS, STORE_DAYS, STORE_SESSIONS, STORE_META], 'readonly')

    expect(tx.objectStore(STORE_WORDS).keyPath).toBe('w')
    expect(tx.objectStore(STORE_DAYS).keyPath).toBe('d')
    expect(tx.objectStore(STORE_SESSIONS).keyPath).toBe('id')
    // `keyPath` YO'Q: kalit qiymatdan tashqarida beriladi.
    expect(tx.objectStore(STORE_META).keyPath).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// §8.4a — tranzaksiya avto-commit: zanjir uzilmasligi shart
// ---------------------------------------------------------------------------

describe('runTx (§8.4a)', () => {
  it('bitta tranzaksiyada o\'qi-o\'zgartir-yoz zanjiri ishlaydi', async () => {
    const db = await open()

    // `get` -> (onsuccess) -> `put`: keyingi so'rov oldingisining hodisasidan
    // chiqadi, ya'ni tranzaksiya faol qoladi. `await` bilan bo'linsa,
    // `put` `TransactionInactiveError` bilan yiqilardi.
    const bump = () =>
      runTx(db, [STORE_DAYS], 'readwrite', (tx) => {
        const store = tx.objectStore(STORE_DAYS)
        const req = store.get(DAY)
        req.onsuccess = () => {
          const row = (req.result as DayRow | undefined) ?? emptyDay(DAY)
          store.put({ ...row, sentences: row.sentences + 1, activeMs: row.activeMs + 100 })
        }
      })

    await bump()
    await bump()

    const row = await readDay(db, DAY)
    expect(row?.sentences).toBe(2)
    expect(row?.activeMs).toBe(200)
  })

  it('`collect` qilingan qiymat bilan hal bo\'ladi', async () => {
    const db = await open()

    const count = await runTx<number>(
      db,
      [STORE_DAYS],
      'readonly',
      (tx, collect) => {
        const req = tx.objectStore(STORE_DAYS).count()
        req.onsuccess = () => collect(req.result)
      },
      -1,
    )

    expect(count).toBe(0)
  })

  it('`collect` UMUMAN chaqirilmasa boshlang\'ich qiymat qaytadi, `undefined` EMAS', async () => {
    const db = await open()

    // ⚠️ Aynan shu bo'shliq `runTx<number>` ni yolg'onga aylantirardi: promise
    // `number` deb e'lon qilinib, `undefined` bilan hal bo'lardi. Endi
    // boshlang'ich qiymat imzo bilan MAJBURIY, ya'ni uni unutib bo'lmaydi.
    const value = await runTx<number>(db, [STORE_DAYS], 'readonly', () => {}, 42)

    expect(value).toBe(42)
  })

  it('`abort` da promise RAD etiladi va yozuv QO\'LLANMAYDI', async () => {
    const db = await open()

    await expect(
      runTx(db, [STORE_DAYS], 'readwrite', (tx) => {
        const store = tx.objectStore(STORE_DAYS)
        const req = store.put({ ...emptyDay(DAY), sentences: 7 })
        // Yozuv muvaffaqiyatli bo'lgandan KEYIN bekor qilamiz — atomiklik
        // aynan shu holatda sinaladi.
        req.onsuccess = () => tx.abort()
      }),
    ).rejects.toThrow()

    expect(await readDay(db, DAY)).toBeUndefined()
  })

  it('`body` sinxron tashlasa tranzaksiya bekor qilinadi va promise rad etiladi', async () => {
    const db = await open()

    await expect(
      runTx(db, [STORE_DAYS], 'readwrite', (tx) => {
        tx.objectStore(STORE_DAYS).put({ ...emptyDay(DAY), sentences: 3 })
        throw new Error('body yiqildi')
      }),
    ).rejects.toThrow('body yiqildi')

    expect(await readDay(db, DAY)).toBeUndefined()
  })

  it('⚠️ `async` body RAD etiladi va yozuv QO\'LLANMAYDI', async () => {
    const db = await open()

    const asyncBody = async (tx: IDBTransaction): Promise<void> => {
      const store = tx.objectStore(STORE_DAYS)
      store.put({ ...emptyDay(DAY), sentences: 5 })
      // Shu `await` tranzaksiyani O'LDIRADI: hodisalar siklga qaytadi va
      // avto-commit ishlaydi (§8.4a).
      await Promise.resolve()
      store.put({ ...emptyDay(DAY), sentences: 6 })
    }

    // ⚠️ `as never` ATAYIN: `runTx` ning imzosi bu body'ni KOMPILYATSIYADA
    // rad etadi (`void | boolean` — yalang'och `void` emas), ya'ni himoyaning
    // birinchi qatlami test yozilishiga ham yo'l qo'ymaydi. Kast aynan shu
    // qatlamni chetlab o'tib, IKKINCHI — ish vaqti — qatlamini sinaydi.
    await expect(
      runTx(db, [STORE_DAYS], 'readwrite', asyncBody as never),
    ).rejects.toThrow(/SINXRON/)

    // Muhimi: tranzaksiya bekor qilingani uchun `await` gacha ulgurgan `put`
    // ham DISKKA TUSHMAYDI — yarim yozilgan holat qolmaydi.
    expect(await readDay(db, DAY)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// §9.4 — `by_endedAt` bo'yicha teskari kursor
// ---------------------------------------------------------------------------

describe('eachCursor', () => {
  type SessionRow = { id: string; endedAt: number }

  async function seed(db: IDBDatabase): Promise<void> {
    await runTx(db, [STORE_SESSIONS], 'readwrite', (tx) => {
      const store = tx.objectStore(STORE_SESSIONS)
      // ATAYIN tartibsiz quyiladi: tartib indeksdan chiqishi kerak.
      store.put({ id: 'b', endedAt: 200 })
      store.put({ id: 'a', endedAt: 100 })
      store.put({ id: 'c', endedAt: 300 })
    })
  }

  it('`by_endedAt` bo\'yicha TESKARI yuradi', async () => {
    const db = await open()
    await seed(db)

    const ids = await runTx<string[]>(
      db,
      [STORE_SESSIONS],
      'readonly',
      (tx, collect) => {
        const seen: string[] = []
        const index = tx.objectStore(STORE_SESSIONS).index(INDEX_SESSIONS_BY_ENDED_AT)
        eachCursor<SessionRow>(index, 'prev', (row) => {
          seen.push(row.id)
        })
        collect(seen)
      },
      [],
    )

    expect(ids).toEqual(['c', 'b', 'a'])
  })

  it('`false` qaytarilsa TO\'XTAYDI — `previousSession` butun omborni yuklamaydi', async () => {
    const db = await open()
    await seed(db)

    const ids = await runTx<string[]>(
      db,
      [STORE_SESSIONS],
      'readonly',
      (tx, collect) => {
        const seen: string[] = []
        const index = tx.objectStore(STORE_SESSIONS).index(INDEX_SESSIONS_BY_ENDED_AT)
        eachCursor<SessionRow>(index, 'prev', (row) => {
          seen.push(row.id)
          return false
        })
        collect(seen)
      },
      [],
    )

    expect(ids).toEqual(['c'])
  })
})

// ---------------------------------------------------------------------------
// §8.4d — muhit farqlari: IDB yo'q bo'lsa `null`, TASHLAMAYDI
// ---------------------------------------------------------------------------

describe('openDb (§8.4d)', () => {
  it('`indexedDB` global\'i yo\'q bo\'lsa `null` qaytaradi', async () => {
    closeDb()
    const real = globalThis.indexedDB
    Reflect.deleteProperty(globalThis, 'indexedDB')

    try {
      // Muhim: TASHLAMAYDI. Chaqiruvchi shu `null` ga qarab banner ko'rsatadi.
      await expect(openDb()).resolves.toBeNull()
    } finally {
      globalThis.indexedDB = real
    }
  })
})

// ---------------------------------------------------------------------------
// §8.4b — `versionchange` / `blocked`: ulanish o'zini yopadi, blokirovka
// ko'rinadigan xato bo'ladi
// ---------------------------------------------------------------------------

describe('versionchange (§8.4b)', () => {
  it('ulanish yopiladi va keyingi `openDb()` YANGI ulanish beradi', async () => {
    const first = await open()

    // ⚠️ Hodisa DISPATCH qilinadi, `first.onversionchange` QO'LDA chaqirilmaydi:
    // qo'lda chaqiruv handler haqiqiy tinglovchi sifatida ro'yxatdan o'tganini
    // tekshirmasdi. `deleteDatabase` — brauzer `versionchange` beradigan
    // haqiqiy yo'llardan biri (boshqa tab bazani o'chiryapti/yangilayapti).
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error ?? new Error("o'chirish yiqildi"))
      // Bu YIQILISH shartidir: `blocked` chiqishi handler ulanishni yopmaganini
      // anglatadi, ya'ni boshqa tabdagi migratsiya muzlab qolardi.
      req.onblocked = () => reject(new Error("`versionchange` ulanishni yopmadi"))
    })

    // Ulanish haqiqatan yopilgan: yopiq ulanishda tranzaksiya ochib bo'lmaydi.
    expect(() => first.transaction([STORE_DAYS], 'readonly')).toThrow()

    // Kesh ham tozalangan.
    const second = await open()
    expect(second).not.toBe(first)
    expect(() => second.transaction([STORE_DAYS], 'readonly')).not.toThrow()
  })

  it('`deleteDb()` ochiq XOM ulanish borida `StatsDbBlockedError` beradi', async () => {
    // Xom ulanishda `onversionchange` yo'q, ya'ni u "yo'ldan chiqmaydigan
    // boshqa tab" — `deleteDatabase` bloklanadi.
    const squatter = await rawOpen()

    try {
      await expect(deleteDb()).rejects.toBeInstanceOf(StatsDbBlockedError)
    } finally {
      // `afterEach` dagi `deleteDb()` ham bloklanmasin.
      squatter.close()
    }
  })
})

// ---------------------------------------------------------------------------
// §8.4b — `onblocked` va parallel ochilish. `onblocked` shoxini HAQIQIY
// `fake-indexeddb` bilan qo'zg'ab bo'lmaydi: u faqat ochilayotgan versiya
// diskdagisidan KATTA bo'lganda chiqadi, `DB_VERSION` esa hozir 1. Shox esa
// §12 M2 ning qabul qilish mezoni, shuning uchun u fabrika darajasida sinaladi.
// ---------------------------------------------------------------------------

type StubHandlers = {
  onblocked: (() => void) | null
  onerror: (() => void) | null
  onsuccess: (() => void) | null
  onupgradeneeded: ((event: { oldVersion: number }) => void) | null
}

type StubDb = { closes: number } & Pick<IDBDatabase, 'close'>

/** Hodisalari QO'LDA boshqariladigan ochilish so'rovi (`req.result` — soxta baza). */
function stubRequest(): StubHandlers & { result: StubDb } {
  const result: StubDb = {
    closes: 0,
    close(): void {
      this.closes += 1
    },
  }
  return { result, onblocked: null, onerror: null, onsuccess: null, onupgradeneeded: null }
}

/**
 * `globalThis.indexedDB` ni soxta fabrika bilan almashtiradi va `restore()` beradi.
 * `opens` — `open()` necha marta chaqirilgani (K1 uchun hal qiluvchi o'lchov).
 */
function stubFactory(req: ReturnType<typeof stubRequest>): {
  opens: () => number
  restore: () => void
} {
  const real = globalThis.indexedDB
  let opens = 0

  globalThis.indexedDB = {
    open: () => {
      opens += 1
      return req
    },
  } as unknown as IDBFactory

  return {
    opens: () => opens,
    restore: () => {
      globalThis.indexedDB = real
    },
  }
}

describe('onblocked va ochilish keshi (§8.4b)', () => {
  it('`onblocked` da `StatsDbBlockedError` bilan RAD etiladi', async () => {
    closeDb()
    const req = stubRequest()
    const factory = stubFactory(req)

    try {
      const pending = openDb()
      req.onblocked?.()
      await expect(pending).rejects.toBeInstanceOf(StatsDbBlockedError)
    } finally {
      factory.restore()
      closeDb()
    }
  })

  it('bloklanishdan KEYIN kelgan `onsuccess` ulanishni yopadi, keshga qo\'ymaydi', async () => {
    closeDb()
    const req = stubRequest()
    const factory = stubFactory(req)

    try {
      await expect(
        (() => {
          const pending = openDb()
          req.onblocked?.()
          return pending
        })(),
      ).rejects.toBeInstanceOf(StatsDbBlockedError)

      // Blokir tab yopildi va ochilish ulgurdi — lekin bizga endi kerak emas:
      // ushlab qolsak, u boshqa tabdagi migratsiyani bloklab turardi.
      req.onsuccess?.()

      expect(req.result.closes).toBe(1)
    } finally {
      factory.restore()
      closeDb()
    }
  })

  it('bloklanishdan keyingi qayta urinish YANGI `open()` CHIQARMAYDI', async () => {
    closeDb()
    const req = stubRequest()
    const factory = stubFactory(req)

    try {
      const first = openDb()
      req.onblocked?.()
      await expect(first).rejects.toBeInstanceOf(StatsDbBlockedError)
      expect(factory.opens()).toBe(1)

      // "Qayta urinish" tugmasi. Birinchi so'rov hamon kutmoqda va uni bekor
      // qilib bo'lmaydi, shuning uchun yangisi chiqarilmasligi SHART.
      const second = openDb()
      expect(factory.opens()).toBe(1)

      // O'sha so'rov nihoyat ochildi — endi qayta urinish uni oladi.
      req.onsuccess?.()
      await expect(second).resolves.toBe(req.result)
      expect(req.result.closes).toBe(0)
    } finally {
      factory.restore()
      closeDb()
    }
  })

  it('ochilish davomidagi `closeDb()` ulanishni TIRILTIRMAYDI', async () => {
    closeDb()
    const req = stubRequest()
    const factory = stubFactory(req)

    try {
      const pending = openDb()
      closeDb()
      req.onsuccess?.()

      // Ochilish natijasi darrov yopiladi va keshga tushmaydi.
      await expect(pending).resolves.toBeNull()
      expect(req.result.closes).toBe(1)
      expect(factory.opens()).toBe(1)

      // Keshda hech narsa qolmagani uchun keyingi `openDb()` YANGIDAN ochadi.
      openDb()
      expect(factory.opens()).toBe(2)
    } finally {
      factory.restore()
      closeDb()
    }
  })

  it('parallel `openDb()` chaqiruvlari BITTA ochilishni bo\'lishadi', async () => {
    closeDb()

    const [first, second, third] = await Promise.all([openDb(), openDb(), openDb()])

    expect(first).not.toBeNull()
    expect(second).toBe(first)
    expect(third).toBe(first)
  })
})

// ---------------------------------------------------------------------------
// §8.4d — `close`: brauzer ulanishni g'ayrioddiy yopdi
// ---------------------------------------------------------------------------

describe('close (§8.4d)', () => {
  it('g\'ayrioddiy yopilish keshni tozalaydi — O\'LIK ulanish qaytmaydi', async () => {
    const first = await open()

    // Foydalanuvchi tab ochiq turganda sayt ma'lumotini tozaladi.
    forceClose(first)

    // Kesh tozalanmasa shu yerda AYNAN O'SHA o'lik ulanish qaytardi va har
    // `runTx` `InvalidStateError` berardi — statistika sahifa qayta
    // yuklanmaguncha jimgina yozilmasdi.
    const second = await open()
    expect(second).not.toBe(first)

    await runTx(second, [STORE_DAYS], 'readwrite', (tx) => {
      tx.objectStore(STORE_DAYS).put({ ...emptyDay(DAY), sentences: 1 })
    })
    expect((await readDay(second, DAY))?.sentences).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// §8.2 — `withStatsDb`: o'lik ulanishdan keyin gap YO'QOLMAYDI
// ---------------------------------------------------------------------------

describe('withStatsDb (§8.2)', () => {
  it('yozadi va `true` qaytaradi', async () => {
    const db = await open()

    const written = await withStatsDb([STORE_DAYS], 'readwrite', (tx) => {
      tx.objectStore(STORE_DAYS).put({ ...emptyDay(DAY), sentences: 4 })
    })

    expect(written).toBe(true)
    expect((await readDay(db, DAY))?.sentences).toBe(4)
  })

  it('qiymat variantida `collect` chaqirilmasa boshlang\'ich qiymat qaytadi', async () => {
    await open()

    const count = await withStatsDb<number>(
      [STORE_DAYS],
      'readonly',
      (tx, collect) => {
        const req = tx.objectStore(STORE_DAYS).count()
        req.onsuccess = () => collect(req.result)
      },
      -1,
    )

    expect(count).toBe(0)
  })

  it('⚠️ o\'lik ulanishdan keyin QAYTA ulanadi va yozuv YO\'QOLMAYDI', async () => {
    const dead = await open()

    // Boshqa tab bazani yangiladi (`versionchange` -> ulanish yopildi), lekin
    // ilova keshni tozalashdan oldin `runTx` ni qo'lidagi havola bilan
    // chaqirib ulgurdi. Buni modellashtirish uchun keshga O'LIK ulanishni
    // qaytarib qo'yamiz — bu §8.2 dagi "gap jimgina yo'qoladi" holati.
    dead.close()

    const written = await withStatsDb([STORE_DAYS], 'readwrite', (tx) => {
      tx.objectStore(STORE_DAYS).put({ ...emptyDay(DAY), sentences: 9 })
    })

    expect(written).toBe(true)

    const fresh = await open()
    expect((await readDay(fresh, DAY))?.sentences).toBe(9)
  })

  it('qayta ulanishga ARZIMAYDIGAN xato darrov ko\'tariladi', async () => {
    await open()

    // `NotFoundError` — turg'un nosozlik, qayta ulanish uni tuzatmaydi.
    await expect(withStatsDb(['yo-q-do-kon'], 'readonly', () => {})).rejects.toThrow()
  })

  it('IKKINCHI urinish ham yiqilsa xato KO\'TARILADI — jim yutilmaydi', async () => {
    const dead = await open()
    dead.close()

    // Birinchi urinish `InvalidStateError` (o'lik ulanish) -> qayta ulanadi;
    // ikkinchisi esa yangi ulanishda `NotFoundError` beradi. Cheksiz aylanish
    // yo'q: xato chaqiruvchiga chiqadi.
    await expect(withStatsDb(['yo-q-do-kon'], 'readonly', () => {})).rejects.toThrow()
  })

  it('IDB yo\'q bo\'lsa `false`/`null` qaytaradi va TASHLAMAYDI (§8.4d)', async () => {
    closeDb()
    const real = globalThis.indexedDB
    Reflect.deleteProperty(globalThis, 'indexedDB')

    try {
      await expect(withStatsDb([STORE_DAYS], 'readwrite', () => {})).resolves.toBe(false)
      await expect(
        withStatsDb<number>([STORE_DAYS], 'readonly', (_tx, collect) => collect(1), 0),
      ).resolves.toBeNull()
    } finally {
      globalThis.indexedDB = real
    }
  })
})

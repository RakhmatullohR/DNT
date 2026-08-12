// IndexedDB ustidagi UMUMIY o'ram — bazaga bog'liq bo'lmagan qism.
//
// Bu fayl na statistikani, na izohlarni biladi: u faqat ulanishni ochadi,
// keshlaydi va tranzaksiya/kursor ustida xavfsiz yuzani beradi. Konkret baza
// (nomi, versiyasi, sxemasi) `createIdbHandle` ga UZATILADI — `statsDb.ts` va
// `notesDb.ts` shu fabrikaning ikkita nusxasi.
//
// ⚠️ O'ram `docs/stats-longterm.md` §8.4 dagi TO'RTTA operatsion tuzoqni HAL
// QILADI — ular (a)/(b)/(c)/(d) deb belgilangan. Bu tuzoqlar mashhur, va
// ularni bilmasdan yozilgan o'ram JIMGINA buziladi: yiqilish belgisi ma'lumot
// yo'qolganidan keyin, boshqa joyda chiqadi.
//
// ⚠️ Har handle O'Z holatini ushlaydi, ya'ni `closeDb()` endi butun IDB
// qatlamini emas, FAQAT o'sha bazani yopadi. Kelajakda "hamma ma'lumotni
// tozalash" yo'li qo'shilsa, u `statsDb` va `notesDb` ning ikkalasini ham
// yopishi kerak.
//
// ⭐ NEGA FABRIKA, ikkita alohida o'ram emas: ikkinchi baza (`dnt-notes`)
// qo'shilganda quyidagi mantiq — kesh, `epoch` avlodi, bloklangan so'rovga
// qayta ulanish, o'lgan ulanishni bir marta qayta ochish — nusxalanishi kerak
// bo'lardi. Nusxa ikkita HAR XIL xatti-harakat degani: tuzatish bittasiga
// tushib, ikkinchisida qolib ketardi. Shu sababdan holat modul darajasida emas,
// har bir handle'ning YOPILMASIDA (closure) yashaydi.

/** `runTx`/`withDb` ning tranzaksiya tanasi (`collect` — natija belgilagichi). */
export type TxBody<T> = (tx: IDBTransaction, collect: (value: T) => void) => void | boolean

export type IdbHandleOptions = {
  /** Baza nomi (`dnt-stats`, `dnt-notes`). Xato xabarlarida ham shu ko'rinadi. */
  name: string
  version: number
  /**
   * Sxemani yaratadi/yangilaydi. FAQAT `onupgradeneeded` ichida chaqiriladi
   * (§8.4c) — `createObjectStore` boshqa joyda umuman ishlamaydi.
   *
   * `oldVersion` tekshiruvi CHAQIRUVCHIDA: qaysi versiyadan qaysisiga
   * o'tilayotgani faqat o'sha bazaning o'ziga ma'lum.
   */
  upgrade: (db: IDBDatabase, oldVersion: number) => void
  /**
   * Bloklanish xatosini yasaydi (§8.4b). Har baza O'Z tipini beradi: chaqiruvchi
   * "boshqa tabni yoping" bannerini aynan shu tip bo'yicha ajratadi.
   */
  blockedError: (message: string) => Error
}

export type IdbHandle = {
  openDb: () => Promise<IDBDatabase | null>
  closeDb: () => void
  deleteDb: () => Promise<void>
  withDb: {
    (stores: string[], mode: IDBTransactionMode, body: TxBody<void>): Promise<boolean>
    <T>(
      stores: string[],
      mode: IDBTransactionMode,
      body: TxBody<T>,
      initial: T,
    ): Promise<T | null>
  }
}

export function createIdbHandle(options: IdbHandleOptions): IdbHandle {
  const { name, version, upgrade, blockedError } = options

  /**
   * Ochiq ulanish keshi. Har chaqiruvda qayta ochish har safar yangi ulanish
   * yaratardi, va ularning har biri boshqa tabdagi migratsiyani bloklardi.
   */
  let connection: IDBDatabase | null = null

  /** Parallel `openDb()` chaqiruvlari BITTA ochilishni bo'lishadi. */
  let opening: Promise<IDBDatabase | null> | null = null

  /**
   * `closeDb()` avlodi.
   *
   * `closeDb()` KUTILAYOTGAN ochilishni ham bekor qilishi shart: aks holda
   * uning `onsuccess` i keshni qaytadan to'ldirib, chaqiruvchi yopilgan deb
   * o'ylagan ulanishni "tiriltirardi", va keyingi `openDb()` o'sha tirilgan
   * ulanishni qaytarardi. `IDBOpenDBRequest` ni bekor qilib bo'lmaydi, shuning
   * uchun har ochilish o'z avlodini eslab qoladi va u eskirgan bo'lsa natijani
   * keshga QO'YMASDAN darrov yopadi.
   */
  let epoch = 0

  /**
   * `onblocked` dan keyin ham TIRIK qolgan ochilish so'rovi.
   *
   * `IDBOpenDBRequest` bekor qilinmaydi: blokirovka ochilgach u baribir
   * `onsuccess` (yoki `onerror`) beradi. Shuning uchun bloklanishdan keyingi
   * `openDb()` yangi `open()` CHIQARMAYDI — o'sha so'rovga qayta ulanadi.
   * Aks holda UI dagi "qayta urinish" tugmasi har bosishda bekor qilib
   * bo'lmaydigan yana bitta so'rov qo'shardi, va blokir tab yopilgan lahzada
   * ularning HAMMASI birdan ulanish yaratardi.
   */
  let blockedReq: IDBOpenDBRequest | null = null

  /**
   * Bazani ochadi (kerak bo'lsa sxemani yaratadi) va ulanishni keshlaydi.
   *
   * (§8.4d) MUHIT FARQLARI: `indexedDB` global'i yo'q bo'lsa, `open()` tashlasa
   * yoki `onerror` bersa — funksiya `null` QAYTARADI, TASHLAMAYDI. Firefox
   * private rejimida baza seans bilan tozalanadi, WebKit esa skript yozadigan
   * omborni ma'lum sharoitlarda cheklaydi. Chaqiruvchi shu `null` ga qarab
   * ochiq banner ko'rsatadi — jim ishlamaslik EMAS.
   *
   * (§8.4b) BLOKLANISH esa `null` EMAS, `blockedError()` bilan RAD etiladi:
   * "boshqa tab eski versiyani ushlab turibdi" — bu vaqtinchalik va
   * tuzatiladigan holat, uni "IDB yo'q" bilan bir xil ko'rsatish foydalanuvchini
   * adashtirardi. Bloklanishdan keyingi QAYTA URINISH yangi so'rov chiqarmaydi,
   * o'shanisini davom ettiradi (`blockedReq`).
   *
   * ⚠️ Iste'molchilar bunga TO'G'RIDAN-TO'G'RI tayanmasin: qaytgan havola boshqa
   * tab sxemani yangilaganda O'LADI. Yozuv/o'qish uchun `withDb` bor.
   */
  function openDb(): Promise<IDBDatabase | null> {
    if (connection !== null) return Promise.resolve(connection)
    if (opening !== null) return opening

    let req: IDBOpenDBRequest
    if (blockedReq !== null) {
      // Oldingi urinish bloklangan edi va o'sha so'rov HAMON kutmoqda —
      // yangisini chiqarish faqat so'rovlarni ko'paytirardi (`blockedReq` izohi).
      req = blockedReq
      blockedReq = null
    } else {
      const idb: IDBFactory | null | undefined = globalThis.indexedDB
      if (idb === null || idb === undefined) return Promise.resolve(null) // (§8.4d)

      try {
        req = idb.open(name, version)
      } catch {
        // Firefox private rejimi `open()` ning O'ZIDA tashlaydi (§8.4d).
        return Promise.resolve(null)
      }
    }

    const generation = epoch

    const pending = new Promise<IDBDatabase | null>((resolve, reject) => {
      let settled = false
      // Ochilish tugadi: keyingi `openDb()` yangidan urinishi mumkin bo'lsin.
      // `generation` qorovuli SHART: `closeDb()` dan keyin boshlangan yangi
      // ochilishning `opening` ini eskirgan `finish()` o'chirib yubormasin.
      const finish = (): void => {
        settled = true
        if (generation === epoch) opening = null
      }

      // Kutilayotgan bloklangan so'rov TUGADI — endi uni qayta ishlatib bo'lmaydi.
      // Busiz keyingi `openDb()` allaqachon hal bo'lgan so'rovga handler osib,
      // abadiy kutib qolardi.
      const releaseBlocked = (): void => {
        if (blockedReq === req) blockedReq = null
      }

      req.onupgradeneeded = (event) => {
        // (§8.4c) Sxema o'zgarishining YAGONA joyi.
        upgrade(req.result, event.oldVersion)
      }

      req.onblocked = () => {
        // (§8.4b) Boshqa tab eski versiyani ushlab turibdi. JIM KUTIB QOLMAYMIZ:
        // aks holda ilova "yuklanmoqda" holatida abadiy osilib qolardi va
        // sababi hech qayerda ko'rinmasdi.
        if (settled) return
        finish()
        // So'rovning o'zi O'LMAYDI — keyingi urinish aynan shuni davom ettiradi.
        if (generation === epoch) blockedReq = req
        reject(
          blockedError(`'${name}' bazasi bloklandi: boshqa tab eski versiyani ushlab turibdi.`),
        )
      }

      req.onerror = () => {
        if (settled) {
          releaseBlocked()
          return
        }
        finish()
        resolve(null) // (§8.4d) — kvota/ruxsat xatosi ham "IDB ishlamayapti" demak.
      }

      req.onsuccess = () => {
        const db = req.result

        if (settled) {
          // `onblocked` dan keyin ochilish baribir ulgurdi. Ulanishni USHLAB
          // QOLMAYMIZ: u boshqa tabdagi migratsiyani bloklab turardi.
          releaseBlocked()
          db.close()
          return
        }

        if (generation !== epoch) {
          // Ochilish davomida `closeDb()` chaqirilgan. Keshga QO'YMAYMIZ: aks
          // holda yopilgan deb o'ylangan baza tirilardi. Chaqiruvchi uchun bu
          // "hozir IDB yo'q" bilan bir xil (§8.4d) — TASHLAMAYDI.
          db.close()
          finish()
          resolve(null)
          return
        }

        // (§8.4b) Boshqa tab yangi versiyaga o'tmoqchi bo'lsa — YO'LDAN CHIQAMIZ.
        // Ulanish yopilmasa, u yerdagi `onblocked` abadiy kutib qolardi.
        db.onversionchange = () => {
          db.close()
          // Kesh tozalanadi: keyingi `openDb()` yangi versiyaga QAYTA ulanadi.
          if (connection === db) connection = null
        }

        // (§8.4d) `close` — brauzer ulanishni G'AYRIODDIY yopdi: foydalanuvchi
        // tab ochiq turganda sayt ma'lumotini tozaladi, disk/kvota xatosi bo'ldi,
        // yoki §3.3 dagi WebKit cheklovi ishladi. Kesh tozalanmasa `openDb()`
        // abadiy O'LIK ulanishni qaytarardi, har `runTx` `InvalidStateError`
        // berardi va yozuv sahifa qayta yuklanmaguncha JIMGINA yo'qolardi —
        // aynan §8.4d rad etadigan holat.
        db.onclose = () => {
          if (connection === db) connection = null
        }

        connection = db
        finish()
        resolve(db)
      }
    })

    opening = pending
    return pending
  }

  /**
   * Keshlangan ulanishni yopadi (testlar uchun va qo'lda tozalash uchun).
   *
   * KUTILAYOTGAN ochilish ham bekor qilinadi (`epoch`): usiz ochilish jarayonida
   * chaqirilgan `closeDb()` dan keyin so'rov baribir `connection` ni qaytadan
   * o'rnatardi va keyingi `openDb()` "tirilgan" ulanishni qaytarardi.
   */
  function closeDb(): void {
    epoch += 1
    opening = null
    // Bloklangan so'rovga qayta ulanishdan ham voz kechamiz. Hech narsa sizib
    // chiqmaydi: uning `settled === true` bo'lgan `onsuccess` i bazani yopadi.
    blockedReq = null

    if (connection === null) return
    connection.close()
    connection = null
  }

  /** Bazani butunlay o'chiradi (testlar uchun). Avval ochiq ulanish yopiladi. */
  function deleteDb(): Promise<void> {
    closeDb()

    const idb: IDBFactory | null | undefined = globalThis.indexedDB
    if (idb === null || idb === undefined) return Promise.resolve()

    return new Promise<void>((resolve, reject) => {
      const req = idb.deleteDatabase(name)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error ?? new Error(`'${name}' o'chirilmadi.`))
      req.onblocked = () => reject(blockedError(`'${name}' o'chirilmadi: ochiq ulanish bor.`))
    })
  }

  /**
   * `openDb()` + `runTx()` — iste'molchilar uchun YAGONA yuqori darajali yuza.
   *
   * ⚠️ Nega alohida yordamchi kerak (§8.2): `await openDb()` bilan olingan `db`
   * havolasi boshqa tab sxemani yangilaganda O'LADI (`onversionchange` ulanishni
   * yopadi). Shu havola bilan yozishga urinish `InvalidStateError` beradi, ya'ni
   * "har gapda bitta tranzaksiya" shartnomasida O'SHA GAP JIMGINA YO'QOLARDI.
   * Bu yerda esa kesh tozalanib BIR MARTA qayta ulaniladi va yozuv o'tadi.
   *
   * Bir marta, chunki ikkinchi `InvalidStateError` — bu vaqtinchalik poyga emas,
   * balki turg'un nosozlik; cheksiz qayta urinish uni jimgina yashirardi.
   *
   * (§8.4d) IDB umuman yo'q bo'lsa TASHLAMAYDI — `false`/`null` qaytaradi.
   * (§8.4b) Bloklanish esa `blockedError()` bo'lib KO'TARILADI: u boshqa banner
   * va boshqa maslahat talab qiladi.
   */
  async function withDb<T>(
    stores: string[],
    mode: IDBTransactionMode,
    body: TxBody<T>,
    ...rest: [initial: T] | []
  ): Promise<T | boolean | null> {
    // `rest.length` — overload'lar orasidagi YAGONA ish vaqti farqi. `initial ===
    // undefined` bilan ajratib bo'lmasdi: `T` ning o'zi `undefined` ni o'z ichiga
    // olishi mumkin (masalan `DayRow | undefined`), va o'shanda qiymat varianti
    // xato ravishda `void` variant deb qaralardi.
    const wantsValue = rest.length === 1
    const initial: T = rest.length === 1 ? rest[0] : (undefined as T)
    // `void` variant "yozildimi" bayrog'ini beradi — chaqiruvchi bannerni shunga
    // qarab ko'rsatadi; qiymat varianti esa "qiymat yo'q" ni `null` bilan aytadi.
    const missing = wantsValue ? null : false

    const first = await openDb()
    if (first === null) return missing

    try {
      const value = await runTx(first, stores, mode, body, initial)
      return wantsValue ? value : true
    } catch (err) {
      if (!isDeadConnection(err)) throw err

      // Ulanish o'lgan (boshqa tab yangiladi yoki brauzer `close` berdi).
      // Keshni tozalab BIR MARTA qayta ulanamiz.
      closeDb()
      const second = await openDb()
      if (second === null) return missing

      const value = await runTx(second, stores, mode, body, initial)
      return wantsValue ? value : true
    }
  }

  return { openDb, closeDb, deleteDb, withDb: withDb as IdbHandle['withDb'] }
}

/**
 * Bitta tranzaksiyani boshdan oxir olib boradi (faqat YOZUV varianti).
 *
 * ⚠️ (§8.4a) TRANZAKSIYA AVTO-COMMIT. IndexedDB tranzaksiyasi kutilayotgan IDB
 * so'rovisiz hodisalar siklga qaytsa AVTOMATIK yopiladi. Shuning uchun `body`
 * ATAYIN SINXRON (`async` EMAS):
 *
 *   - `body` ni `async` qilish yoki uning ichida `fetch`, `Promise.resolve()`,
 *     hatto `await 1` ni kutish tranzaksiyani O'LDIRADI, va zanjirdagi keyingi
 *     so'rov `TransactionInactiveError` bilan yiqiladi;
 *   - shuning uchun bu yerda `reqToPromise` KABI yordamchi ATAYIN YO'Q — u
 *     aynan shu taqiqlangan naqshni (`await req` zanjiri) qulay qilib qo'yardi.
 *
 * ⚠️ Bu va'da IKKI QATLAM bilan MIXLANGAN, izoh bilan emas:
 *
 *   1. TIP: `body` ning qaytish tipi `void | boolean` — YALANG'OCH `void` EMAS.
 *      Farqi hal qiluvchi: TypeScript'da yalang'och `void` qaytaradigan
 *      funksiya tipi HAR QANDAY qiymat qaytaradigan funksiyani qabul qiladi,
 *      shu jumladan `async` ni. Union bu qulaylikni o'chiradi, ya'ni `async`
 *      body KOMPILYATSIYADA rad etiladi (`eachCursor` dagi bilan bir xil naqsh).
 *      `boolean` ning o'zi bu yerda O'QILMAYDI — u faqat union hosil qiladi.
 *   2. ISH VAQTI: tip qatlamini `any`/kast bilan chetlab o'tish mumkin, shuning
 *      uchun thenable qaytargan `body` pastda TO'XTATILADI — tranzaksiya bekor
 *      qilinadi va promise rad etiladi. Yarim yozilgan holat qolmaydi.
 *
 * O'qi-o'zgartir-yoz zanjiri butunlay IDB hodisalari ICHIDA qoladi: keyingi
 * so'rov oldingisining `onsuccess` idan chiqariladi, natija esa `collect`
 * bilan belgilanib, `tx.oncomplete` da hal qilinadi. Ya'ni promise faqat
 * ma'lumot DISKKA yozilgani ANIQ bo'lgach hal bo'ladi.
 */
export function runTx(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  body: TxBody<void>,
): Promise<void>
/**
 * Qiymat qaytaradigan variant: `initial` MAJBURIY.
 *
 * ⚠️ Nega majburiy: `collect` UMUMAN chaqirilmasligi mumkin (bo'sh ombor,
 * birinchi qatordayoq to'xtagan kursor), va o'shanda `runTx<number>` e'lon
 * qilingan promise `undefined` bilan hal bo'lardi — ya'ni `number` deb
 * ko'rsatilgan qiymat aslida yo'q bo'lardi. Bu tipni yolg'onga aylantirardi va
 * har iste'molchini "boshlang'ich `collect` ni unutma" qoidasini yodda tutishga
 * majburlardi. `initial` bilan shartnoma tip darajasida bajariladi.
 *
 * `collect` CHAQIRILGANDA uning `tx.oncomplete` dan oldin bo'lishi IDB
 * spetsifikatsiyasi bilan kafolatlangan, ya'ni yagona bo'shliq — "umuman
 * chaqirilmadi" — va uni aynan `initial` yopadi.
 */
export function runTx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  body: TxBody<T>,
  initial: T,
): Promise<T>
export function runTx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  body: TxBody<T>,
  ...rest: [initial: T] | []
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // `rest` bo'sh bo'lishi FAQAT yuqoridagi `void` overload'ida mumkin, va u
    // yerda `T` = `void` — ya'ni `undefined` haqiqatan ham `T`. Kast shu ikki
    // overload bilan kafolatlangan, tekshirilmagan taxmin emas.
    let collected: T = rest.length === 1 ? rest[0] : (undefined as T)

    let tx: IDBTransaction
    try {
      tx = db.transaction(stores, mode)
    } catch (err) {
      // Yopilgan ulanish yoki noma'lum do'kon nomi — `InvalidStateError`/`NotFoundError`.
      reject(err)
      return
    }

    // Faqat COMMIT bo'lgandan keyin hal qilinadi.
    tx.oncomplete = () => resolve(collected)
    tx.onerror = () => reject(txError(tx, 'tranzaksiya xatosi'))
    // Abort'da ham rad etiladi va — muhimi — HECH BIR yozuv qo'llanmaydi:
    // atomiklik §8.2 dagi "bitta tranzaksiyada" shartnomasining butun ma'nosi.
    tx.onabort = () => reject(txError(tx, 'tranzaksiya bekor qilindi'))

    let result: unknown
    try {
      result = body(tx, (value) => {
        collected = value
      })
    } catch (err) {
      // `body` sinxron yiqildi: tranzaksiyani ochiq qoldirib ketmaymiz.
      abortQuietly(tx)
      reject(err)
      return
    }

    // (§8.4a) ISH VAQTI QOROVULI — yuqoridagi (2) qatlam. `body` thenable
    // qaytardi, ya'ni u `await` da uzilgan: tranzaksiya allaqachon o'lgan yoki
    // keyingi hodisa siklida o'ladi. Yarim bajarilgan yozuvni COMMIT qilishdan
    // ko'ra ATAYIN bekor qilamiz — chaqiruvchi xatoni ko'rsin.
    if (typeof (result as PromiseLike<unknown> | null | undefined)?.then === 'function') {
      abortQuietly(tx)
      // `body` ning o'z promise'i endi hech kimga kerak emas, lekin u `await`
      // dan keyin `TransactionInactiveError` bilan yiqilishi deyarli aniq. Uni
      // yutmasak, pastdagi ANIQ xabar ustidan "unhandled rejection" chiqib,
      // haqiqiy sababni yashirardi.
      void (result as PromiseLike<unknown>).then(undefined, () => {})
      reject(
        new Error(
          "runTx: `body` SINXRON bo'lishi shart (§8.4a) — `async` body tranzaksiyani o'ldiradi.",
        ),
      )
    }
  })
}

/** Tranzaksiyani bekor qiladi va allaqachon tugagan bo'lsa indamaydi. */
function abortQuietly(tx: IDBTransaction): void {
  try {
    tx.abort()
  } catch {
    // Allaqachon tugagan yoki bekor qilingan — qo'shimcha xato ma'nosiz.
  }
}

/** Tranzaksiya xatosini ma'noli `Error` ga aylantiradi (`tx.error` ko'pincha `null`). */
function txError(tx: IDBTransaction, fallback: string): Error {
  return tx.error ?? new Error(fallback)
}

/**
 * Keshlangan ulanish O'LGANmi.
 *
 * Yopilgan ulanishda `db.transaction()` `InvalidStateError` tashlaydi —
 * `versionchange` yoki `close` dan keyin biz aynan shu holatga tushamiz.
 * `instanceof DOMException` ATAYIN ishlatilmaydi: bu global har muhitda bir xil
 * emas (Node testlari), `name` esa spetsifikatsiya bilan mixlangan.
 */
function isDeadConnection(err: unknown): boolean {
  return (err as { name?: unknown } | null | undefined)?.name === 'InvalidStateError'
}

/**
 * Kursor bo'ylab yuradi. SINXRON chaqiriladi va `runTx` ning `body` si ICHIDA
 * ishlatilishi kutiladi.
 *
 * (§8.4a) Har keyingi qadam oldingisining `onsuccess` idan chiqariladi, ya'ni
 * tranzaksiya butun yurish davomida FAOL qoladi.
 *
 * `onRow` `false` qaytarsa yurish TO'XTAYDI — `by_endedAt` bo'yicha teskari
 * yurib birinchi qatorni olish (§9.4: `previousSession` butun omborni
 * YUKLAMASIN) aynan shu bilan bajariladi.
 */
export function eachCursor<T>(
  source: IDBObjectStore | IDBIndex,
  direction: IDBCursorDirection,
  onRow: (row: T) => boolean | void,
): void {
  const req = source.openCursor(null, direction)
  req.onsuccess = () => {
    const cursor = req.result
    if (cursor === null) return // Yurish tugadi.
    if (onRow(cursor.value as T) === false) return
    cursor.continue()
  }
  // `onerror` ATAYIN yo'q: so'rov xatosi tranzaksiyaga ko'tariladi va uni
  // `runTx` dagi `tx.onerror` bitta joyda ushlaydi.
}

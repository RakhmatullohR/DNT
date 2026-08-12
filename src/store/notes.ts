// Gap izohlari — matn + rasm ustidagi barcha amallar.
//
// Bu modul React'ni BILMAYDI va barcha IndexedDB murojaati shu yerda to'plangan
// (`stats.ts` ↔ ekranlar bilan bir xil qatlamlash). Ekran faqat shu yerdagi
// funksiyalarni chaqiradi va qaytgan natijaga qarab xabar ko'rsatadi.
//
// ⚠️ NEGA XATOLAR JIMGINA YUTILMAYDI (`prefs.ts` dan farqli o'laroq): sozlama
// yo'qolsa foydalanuvchi bitta tugmani qayta bosadi, qo'lda yozilgan izoh
// yo'qolsa esa uni qaytarib bo'lmaydi. Shuning uchun har yozuv ANIQ natija
// qaytaradi va UI "saqlanmadi" deyishi mumkin. O'QISH esa kechirimli: har
// qanday nosozlikda `null` — izohning yo'qligi mashqni to'xtatmasligi kerak.

import { storageEstimate } from './persist.ts'
import { NotesDbBlockedError, withNotesDb } from './notesDb.ts'
import {
  INDEX_NOTES_BY_LESSON,
  INDEX_NOTE_IMAGES_BY_LESSON,
  MAX_IMAGES_PER_NOTE,
  MAX_IMAGE_BYTES,
  STORE_NOTES,
  STORE_NOTE_IMAGES,
  clampNoteText,
  isAcceptedImageType,
  sentenceHead,
  toNoteImageRow,
  toNoteRow,
} from './notesSchema.ts'
import type { NoteImageRow, NoteRow } from './notesSchema.ts'

export type NoteImage = {
  slot: number
  blob: Blob
  type: string
  size: number
  name: string
  addedAt: number
}

export type Note = {
  lessonId: string
  sentenceIndex: number
  text: string
  updatedAt: number
  /** Yozilgan paytdagi gap boshi — hozirgi gap bilan solishtirish uchun. */
  sentenceHead?: string
  images: NoteImage[]
}

/**
 * Yozuv natijasi. Union — `boolean` emas: UI har holat uchun BOSHQA maslahat
 * beradi ("boshqa tabni yoping" ≠ "xotira to'lgan" ≠ "bu brauzerda saqlanmaydi").
 */
export type NoteSaveResult =
  | 'saved'
  | 'no-idb'
  | 'blocked'
  | 'quota'
  | 'limit'
  | 'invalid'
  | 'error'

/** Kvota shu nisbatdan oshgan bo'lsa rasm umuman qo'shilmaydi. */
const QUOTA_CEILING = 0.9

/** Ikkala do'kon — bitta tranzaksiyada o'zgaradigan joylar uchun. */
const BOTH_STORES = [STORE_NOTES, STORE_NOTE_IMAGES]

/**
 * Bitta gapning rasmlari uchun kalit oralig'i.
 *
 * `slot` doim `0..MAX_IMAGES_PER_NOTE-1` oralig'ida (pastdagi `freeSlot` shuni
 * kafolatlaydi), shuning uchun chegara ANIQ son bilan yoziladi — massivli
 * "hamma sondan katta" hiylasi kerak emas.
 */
function imageRange(lessonId: string, sentenceIndex: number): IDBKeyRange {
  return IDBKeyRange.bound(
    [lessonId, sentenceIndex, 0],
    [lessonId, sentenceIndex, MAX_IMAGES_PER_NOTE],
  )
}

/** Xatoni foydalanuvchiga ko'rsatiladigan sababga aylantiradi. */
function classify(err: unknown): NoteSaveResult {
  if (err instanceof NotesDbBlockedError) return 'blocked'
  // `instanceof DOMException` ATAYIN emas: bu global har muhitda bir xil emas.
  if ((err as { name?: unknown } | null | undefined)?.name === 'QuotaExceededError') return 'quota'
  return 'error'
}

/**
 * Izohning YANGILANISH vaqti — matn va rasmlarning eng kechi.
 *
 * ⭐ Nega hisoblanadi, `NoteRow.updatedAt` ning o'zi olinmaydi: rasm qo'shish va
 * o'chirish FAQAT `noteImages` do'koniga tegadi (matn qatorini ochmaydi —
 * bu ataylab: 600 ms lik avtosaqlash blob qatorini qaytadan yozmasin). Ya'ni
 * xom `updatedAt` rasm bilan bog'liq o'zgarishni KO'RSATMAYDI.
 *
 * Bu jimgina ma'lumot yo'qotishga olib kelardi: zaxira olingandan KEYIN
 * qo'shilgan rasm xom `updatedAt` ni oshirmagani uchun, o'sha zaxirani qayta
 * tiklaganda `importLessonNotes` fayldagi yozuvni "bir xil yangi" deb hisoblab,
 * keyin qo'shilgan rasmni o'chirib yuborardi.
 */
function freshness(textUpdatedAt: number, images: readonly NoteImage[]): number {
  let latest = textUpdatedAt
  for (const image of images) {
    if (image.addedAt > latest) latest = image.addedAt
  }
  return latest
}

function toImage(row: NoteImageRow): NoteImage {
  return {
    slot: row.slot,
    blob: row.blob,
    type: row.type,
    size: row.size,
    name: row.name,
    addedAt: row.addedAt,
  }
}

// ---------------------------------------------------------------------------
// O'qish
// ---------------------------------------------------------------------------

/**
 * Bitta gapning izohi (matn + rasmlar), BITTA tranzaksiyada.
 *
 * `null` — izoh yo'q YOKI IDB yo'q. Chaqiruvchi uchun ikkovi bir xil: ko'rsatiladigan
 * narsa yo'q. (Yozuv yo'lida esa farq muhim va u yerda ajratilgan.)
 */
export async function getNote(lessonId: string, sentenceIndex: number): Promise<Note | null> {
  try {
    return await withNotesDb<Note | null>(
      BOTH_STORES,
      'readonly',
      (tx, collect) => {
        const key: [string, number] = [lessonId, sentenceIndex]
        const noteReq = tx.objectStore(STORE_NOTES).get(key)
        noteReq.onsuccess = () => {
          const imagesReq = tx
            .objectStore(STORE_NOTE_IMAGES)
            .getAll(imageRange(lessonId, sentenceIndex))
          imagesReq.onsuccess = () => {
            const images: NoteImage[] = []
            for (const raw of imagesReq.result) {
              const row = toNoteImageRow(raw)
              if (row !== null) images.push(toImage(row))
            }
            images.sort((a, b) => a.slot - b.slot)

            const noteRow = toNoteRow(noteReq.result)
            if (noteRow === null && images.length === 0) {
              collect(null)
              return
            }
            collect({
              lessonId,
              sentenceIndex,
              text: noteRow?.text ?? '',
              updatedAt: freshness(noteRow?.updatedAt ?? 0, images),
              ...(noteRow?.s === undefined ? {} : { sentenceHead: noteRow.s }),
              images,
            })
          }
        }
      },
      null,
    )
  } catch {
    // Bloklangan tab yoki kutilmagan xato — o'qish yo'lida jimgina bo'sh.
    return null
  }
}

/**
 * Darsning izohlari. `sentenceIndexes` berilsa faqat o'sha gaplar qaytadi
 * (Natijalar ekrani seansdagi gaplarni so'raydi).
 *
 * Rasmlar ham qaytadi — chaqiruvchi ularni ko'rsatadi yoki zaxiraga yozadi.
 */
export async function listNotes(
  lessonId: string,
  sentenceIndexes?: readonly number[],
): Promise<Note[]> {
  const wanted = sentenceIndexes === undefined ? null : new Set(sentenceIndexes)

  try {
    const rows = await withNotesDb<Note[]>(
      BOTH_STORES,
      'readonly',
      (tx, collect) => {
        const notesReq = tx.objectStore(STORE_NOTES).index(INDEX_NOTES_BY_LESSON).getAll(lessonId)
        notesReq.onsuccess = () => {
          const imagesReq = tx
            .objectStore(STORE_NOTE_IMAGES)
            .index(INDEX_NOTE_IMAGES_BY_LESSON)
            .getAll(lessonId)
          imagesReq.onsuccess = () => {
            const byIndex = new Map<number, Note>()

            for (const raw of notesReq.result) {
              const row = toNoteRow(raw)
              if (row === null) continue
              if (wanted !== null && !wanted.has(row.sentenceIndex)) continue
              byIndex.set(row.sentenceIndex, {
                lessonId: row.lessonId,
                sentenceIndex: row.sentenceIndex,
                text: row.text,
                updatedAt: row.updatedAt,
                ...(row.s === undefined ? {} : { sentenceHead: row.s }),
                images: [],
              })
            }

            for (const raw of imagesReq.result) {
              const row = toNoteImageRow(raw)
              if (row === null) continue
              if (wanted !== null && !wanted.has(row.sentenceIndex)) continue
              let note = byIndex.get(row.sentenceIndex)
              if (note === undefined) {
                // Matnsiz, faqat rasmli izoh.
                note = {
                  lessonId,
                  sentenceIndex: row.sentenceIndex,
                  text: '',
                  updatedAt: row.addedAt,
                  images: [],
                }
                byIndex.set(row.sentenceIndex, note)
              }
              note.images.push(toImage(row))
            }

            const result = [...byIndex.values()]
            for (const note of result) {
              note.images.sort((a, b) => a.slot - b.slot)
              // `getNote` bilan bir xil hisob: rasm qo'shilishi ham izohni
              // "yangilangan" qiladi (`freshness` izohiga qarang).
              note.updatedAt = freshness(note.updatedAt, note.images)
            }
            result.sort((a, b) => a.sentenceIndex - b.sentenceIndex)
            collect(result)
          }
        }
      },
      [],
    )
    return rows ?? []
  } catch {
    return []
  }
}

/** Izohi bor gaplar indekslari — mashq ekranidagi "bu gapda izoh bor" belgisi uchun. */
export async function noteSentenceIndexes(lessonId: string): Promise<number[]> {
  try {
    const rows = await withNotesDb<number[]>(
      BOTH_STORES,
      'readonly',
      (tx, collect) => {
        const found = new Set<number>()
        const notesReq = tx
          .objectStore(STORE_NOTES)
          .index(INDEX_NOTES_BY_LESSON)
          .getAllKeys(lessonId)
        notesReq.onsuccess = () => {
          for (const key of notesReq.result) {
            const index = keyPart(key, 1)
            if (index !== null) found.add(index)
          }
          const imagesReq = tx
            .objectStore(STORE_NOTE_IMAGES)
            .index(INDEX_NOTE_IMAGES_BY_LESSON)
            .getAllKeys(lessonId)
          imagesReq.onsuccess = () => {
            for (const key of imagesReq.result) {
              const index = keyPart(key, 1)
              if (index !== null) found.add(index)
            }
            collect([...found].sort((a, b) => a - b))
          }
        }
      },
      [],
    )
    return rows ?? []
  } catch {
    return []
  }
}

/** Tarkibiy kalitning bir bo'lagi (`[lessonId, sentenceIndex, slot?]`). */
function keyPart(key: IDBValidKey, at: number): number | null {
  if (!Array.isArray(key)) return null
  const value: unknown = key[at]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// ---------------------------------------------------------------------------
// Yozish
// ---------------------------------------------------------------------------

/**
 * Izoh matnini saqlaydi.
 *
 * Bo'sh matn qatorni O'CHIRADI — bo'sh yozuv omborda o'rin egallamasin. Rasm
 * qatorlariga TEGILMAYDI: ular alohida do'konda va o'z hayotini yashaydi
 * (matnsiz, faqat rasmli izoh — haqiqiy holat).
 */
export async function writeNoteText(
  lessonId: string,
  sentenceIndex: number,
  text: string,
  sentence?: string,
): Promise<NoteSaveResult> {
  const clean = clampNoteText(text)
  const head = sentence === undefined || sentence === '' ? undefined : sentenceHead(sentence)

  try {
    const ok = await withNotesDb([STORE_NOTES], 'readwrite', (tx) => {
      const store = tx.objectStore(STORE_NOTES)
      const key: [string, number] = [lessonId, sentenceIndex]
      if (clean === '') {
        store.delete(key)
        return
      }
      const row: NoteRow = {
        lessonId,
        sentenceIndex,
        text: clean,
        updatedAt: Date.now(),
        ...(head === undefined ? {} : { s: head }),
      }
      store.put(row)
    })
    return ok ? 'saved' : 'no-idb'
  } catch (err) {
    return classify(err)
  }
}

/**
 * Rasm qo'shadi (siqilgan blob `core/imageResize.ts` dan keladi).
 *
 * Kvota OLDINDAN tekshiriladi: `QuotaExceededError` ni ushlash yetarli emas,
 * chunki brauzer chegaraga yaqinlashganda ba'zan xatoni kech beradi yoki
 * boshqa yozuvlarni chiqarib tashlaydi. Oldindan tekshiruv — faqat
 * optimallashtirish, yagona qorovul emas: `catch` baribir joyida.
 */
export async function addNoteImage(
  lessonId: string,
  sentenceIndex: number,
  blob: Blob,
  name: string,
): Promise<NoteSaveResult> {
  if (blob.size <= 0 || blob.size > MAX_IMAGE_BYTES) return 'invalid'
  if (!isAcceptedImageType(blob.type)) return 'invalid'

  const estimate = await storageEstimate()
  if (estimate !== null && estimate.quota > 0) {
    if ((estimate.usage + blob.size) / estimate.quota > QUOTA_CEILING) return 'quota'
  }

  try {
    const result = await withNotesDb<NoteSaveResult>(
      [STORE_NOTE_IMAGES],
      'readwrite',
      (tx, collect) => {
        const store = tx.objectStore(STORE_NOTE_IMAGES)
        const keysReq = store.getAllKeys(imageRange(lessonId, sentenceIndex))
        keysReq.onsuccess = () => {
          const used = new Set<number>()
          for (const key of keysReq.result) {
            const slot = keyPart(key, 2)
            if (slot !== null) used.add(slot)
          }
          if (used.size >= MAX_IMAGES_PER_NOTE) {
            collect('limit')
            return
          }
          // Eng kichik BO'SH slot: o'rtadagi rasm o'chirilgach uning o'rni
          // qayta ishlatiladi va `slot` hech qachon chegaradan oshmaydi.
          let slot = 0
          while (used.has(slot)) slot += 1

          const row: NoteImageRow = {
            lessonId,
            sentenceIndex,
            slot,
            blob,
            type: blob.type,
            size: blob.size,
            name,
            addedAt: Date.now(),
          }
          store.put(row)
          collect('saved')
        }
      },
      // Boshlang'ich qiymat ATAYIN `'error'`: `collect` chaqirilmay qolgan
      // yagona yo'l — so'rov yiqilishi, va u "saqlandi" deb ko'rinmasligi kerak.
      'error',
    )
    return result ?? 'no-idb'
  } catch (err) {
    return classify(err)
  }
}

export async function deleteNoteImage(
  lessonId: string,
  sentenceIndex: number,
  slot: number,
): Promise<NoteSaveResult> {
  try {
    const ok = await withNotesDb([STORE_NOTE_IMAGES], 'readwrite', (tx) => {
      tx.objectStore(STORE_NOTE_IMAGES).delete([lessonId, sentenceIndex, slot])
    })
    return ok ? 'saved' : 'no-idb'
  } catch (err) {
    return classify(err)
  }
}

/** Bitta gapning izohi ham, rasmlari ham — bitta tranzaksiyada. */
export async function deleteNote(
  lessonId: string,
  sentenceIndex: number,
): Promise<NoteSaveResult> {
  try {
    const ok = await withNotesDb(BOTH_STORES, 'readwrite', (tx) => {
      tx.objectStore(STORE_NOTES).delete([lessonId, sentenceIndex])
      tx.objectStore(STORE_NOTE_IMAGES).delete(imageRange(lessonId, sentenceIndex))
    })
    return ok ? 'saved' : 'no-idb'
  } catch (err) {
    return classify(err)
  }
}

/**
 * Darsning HAMMA izohi. Dars o'chirilganda chaqiriladi — aks holda rasm
 * bloblari kvotani abadiy egallab qolardi.
 *
 * ⚠️ Kursor bilan QIYMAT o'qilmaydi: `cursor.value` har bir blobni xotiraga
 * ochardi, holbuki bizga faqat kalit kerak. `getAllKeys` bitta so'rovda
 * birlamchi kalitlarni beradi.
 */
export async function deleteLessonNotes(lessonId: string): Promise<number> {
  try {
    const removed = await withNotesDb<number>(
      BOTH_STORES,
      'readwrite',
      (tx, collect) => {
        let count = 0
        let done = 0

        const finish = (): void => {
          done += 1
          if (done === 2) collect(count)
        }

        for (const [storeName, indexName] of [
          [STORE_NOTES, INDEX_NOTES_BY_LESSON],
          [STORE_NOTE_IMAGES, INDEX_NOTE_IMAGES_BY_LESSON],
        ] as const) {
          const store = tx.objectStore(storeName)
          const req = store.index(indexName).getAllKeys(lessonId)
          req.onsuccess = () => {
            for (const key of req.result) {
              store.delete(key)
              count += 1
            }
            finish()
          }
        }
      },
      0,
    )
    return removed ?? 0
  } catch {
    return 0
  }
}

/**
 * Ombordan darslarga bog'lanmagan qatorlarni supuradi.
 *
 * "O'chirishda chaqirilgan `deleteLessonNotes` yetarli" degan taxmin xato:
 * dars boshqa tabda o'chirilishi, buzuq payload yo'li bilan yo'qolishi yoki
 * o'chirish paytida IDB yozmagan bo'lishi mumkin. Bu supurgi shu bo'shliqni
 * yopadi va narxi ikkita `getAllKeys()` — blob ochilmaydi.
 *
 * ⚠️ BO'SH RO'YXAT HECH NARSANI O'CHIRMAYDI, va bu eng muhim qorovul.
 * `listLessons()` darslar omborini o'qib bo'lmaganda ham (private rejim,
 * cookie'lar o'chirilgan, payload buzuq bo'lib zaxiraga ko'chgan) BO'SH ro'yxat
 * qaytaradi. O'shanda supurgi hamma izohni "yetim" deb o'chirib yuborardi —
 * holbuki darslar tiklanishi mumkin edi. Haqiqatan dars qolmagan bo'lsa yetim
 * qatorlar keyingi safar, birinchi dars paydo bo'lgach supuriladi.
 */
export async function pruneOrphanNotes(knownLessonIds: readonly string[]): Promise<number> {
  if (knownLessonIds.length === 0) return 0
  const known = new Set(knownLessonIds)

  try {
    const removed = await withNotesDb<number>(
      BOTH_STORES,
      'readwrite',
      (tx, collect) => {
        let count = 0
        let done = 0

        const finish = (): void => {
          done += 1
          if (done === 2) collect(count)
        }

        for (const storeName of BOTH_STORES) {
          const store = tx.objectStore(storeName)
          const req = store.getAllKeys()
          req.onsuccess = () => {
            for (const key of req.result) {
              const owner = Array.isArray(key) ? key[0] : null
              if (typeof owner !== 'string' || known.has(owner)) continue
              store.delete(key)
              count += 1
            }
            finish()
          }
        }
      },
      0,
    )
    return removed ?? 0
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Tiklash (zaxira faylidan)
// ---------------------------------------------------------------------------

/** Zaxiradan kelgan bitta izoh (rasmlar allaqachon `Blob` ga aylantirilgan). */
export type NoteImport = {
  lessonId: string
  sentenceIndex: number
  text: string
  updatedAt: number
  sentenceHead?: string
  images: { blob: Blob; name: string }[]
  /**
   * ⭐ `false` — quyidagi `images` ro'yxati TO'LIQ EMAS: zaxira olinayotganda
   * yoki o'qilayotganda kamida bitta rasm tushib qolgan.
   *
   * Nega kerak: ro'yxatning O'ZIGA qarab buni bilib bo'lmaydi. Buzuq base64,
   * ruxsat etilmagan tur yoki eksport paytidagi o'qish xatosi ro'yxatni
   * QISQARTIRADI, bo'shatmaydi — ya'ni "bo'sh emas, demak to'liq" degan xulosa
   * xato. Bunday ro'yxatni ombordagi rasmlar ustiga yozish sog'lom rasmni
   * jimgina yo'q qilardi.
   */
  imagesComplete?: boolean
}

/**
 * Tiklash natijasi.
 *
 * ⚠️ Yalang'och `number` YETARLI EMAS edi: `0` bir vaqtning o'zida "faylda izoh
 * yo'q edi", "hammasi eskirgan" va "yozib bo'lmadi" degan MA'NOLARNI berardi, va
 * uchinchisi foydalanuvchiga muvaffaqiyat bo'lib ko'rinardi — 40 ta izohli
 * zaxira jimgina tushib qolgani holda "3 ta dars qo'shildi" deb yozilardi.
 * Bu esa shu modulning boshidagi qoidaga zid (yozuv natijasi ANIQ aytiladi).
 */
export type NoteImportResult = {
  /** Haqiqatan yozilgan izohlar soni. */
  written: number
  /** `null` — yozuv o'tdi (yoki yozadigan narsa yo'q edi). */
  failed: NoteSaveResult | null
}

/**
 * Zaxiradan kelgan izohlarni yozadi.
 *
 * Qoida: MAVJUD izoh yangiroq bo'lsa (`updatedAt` kattaroq) — tegilmaydi.
 * Tiklash ishlayotgan nusxani orqaga sudrab ketmasligi kerak. Solishtiriladigan
 * `updatedAt` — `listNotes` HISOBLAB bergan qiymat, ya'ni rasm qo'shilishi ham
 * unga kiradi (`freshness` izohiga qarang).
 *
 * O'qish va yozish IKKI tranzaksiyada: yozuvdan oldin qaror JS'da to'liq
 * hisoblanadi (`statsMigrate.ts` dagi `buildMigration` bilan bir xil qaror) —
 * tranzaksiya ichida `await` qilib bo'lmaydi.
 */
export async function importLessonNotes(
  rows: readonly NoteImport[],
): Promise<NoteImportResult> {
  if (rows.length === 0) return { written: 0, failed: null }

  const existing = new Map<string, number>()
  for (const lessonId of new Set(rows.map((row) => row.lessonId))) {
    for (const note of await listNotes(lessonId)) {
      existing.set(`${note.lessonId}:${note.sentenceIndex}`, note.updatedAt)
    }
  }

  /**
   * Yoziladigan qatorlar + har biri uchun "rasmlarni almashtirsak bo'ladimi".
   *
   * Almashtirish FAQAT ikki holatda xavfsiz:
   *   - ombordagi izoh YO'Q (`isNew`) — yo'qotadigan narsa yo'q, hatto to'liq
   *     bo'lmagan ro'yxat ham bo'shdan yaxshiroq;
   *   - fayldagi ro'yxat TO'LIQ (`imagesComplete !== false`) — u haqiqatan
   *     "shu gapning hamma rasmi" degan da'vo qila oladi.
   * Qolgan hollarda ombordagi rasmlarga UMUMAN tegilmaydi.
   */
  const fresh: { row: NoteImport; replaceImages: boolean }[] = []
  for (const row of rows) {
    const previous = existing.get(`${row.lessonId}:${row.sentenceIndex}`)
    const isNew = previous === undefined
    if (!isNew && row.updatedAt < previous) continue

    fresh.push({
      row,
      replaceImages: row.images.length > 0 && (isNew || row.imagesComplete !== false),
    })
  }
  if (fresh.length === 0) return { written: 0, failed: null }

  try {
    const written = await withNotesDb<number>(
      BOTH_STORES,
      'readwrite',
      (tx, collect) => {
        const notes = tx.objectStore(STORE_NOTES)
        const images = tx.objectStore(STORE_NOTE_IMAGES)
        let count = 0

        for (const { row, replaceImages } of fresh) {
          const text = clampNoteText(row.text)
          if (text === '') notes.delete([row.lessonId, row.sentenceIndex])
          else {
            notes.put({
              lessonId: row.lessonId,
              sentenceIndex: row.sentenceIndex,
              text,
              updatedAt: row.updatedAt,
              ...(row.sentenceHead === undefined ? {} : { s: row.sentenceHead }),
            } satisfies NoteRow)
          }

          // ⚠️ Rasmlar FAQAT ishonchli to'plam kelganda almashtiriladi
          // (`replaceImages` hisobiga qarang). Aks holda ombordagi rasmlarga
          // tegilmaydi: qisqargan ro'yxatni ustiga yozish sog'lom rasmni
          // jimgina yo'q qilardi.
          //
          // Ishonchli to'plam esa BUTUNLAY almashtiriladi: yarim-eski,
          // yarim-yangi aralashma hech kimga tushunarli bo'lmasdi.
          if (replaceImages) {
            images.delete(imageRange(row.lessonId, row.sentenceIndex))
            row.images.slice(0, MAX_IMAGES_PER_NOTE).forEach((image, slot) => {
              images.put({
                lessonId: row.lessonId,
                sentenceIndex: row.sentenceIndex,
                slot,
                blob: image.blob,
                type: image.blob.type,
                size: image.blob.size,
                name: image.name,
                addedAt: row.updatedAt,
              } satisfies NoteImageRow)
            })
          }

          // ⚠️ HECH NARSA o'zgarmagan qator SANALMAYDI. Aks holda "hamma rasmi
          // tushib qolgan, matni ham bo'sh" yozuv ham hisobga qo'shilib,
          // foydalanuvchiga "1 ta izoh tiklandi" degan YOLG'ON muvaffaqiyat
          // ko'rsatilardi — aynan `NoteImportResult` bartaraf qilishi kerak
          // bo'lgan holat.
          if (text !== '' || replaceImages) count += 1
        }

        collect(count)
      },
      0,
    )
    // `null` — IDB umuman yo'q. Bu "izoh yo'q edi" bilan bir xil emas va
    // chaqiruvchi buni foydalanuvchiga aytishi kerak.
    return written === null ? { written: 0, failed: 'no-idb' } : { written, failed: null }
  } catch (err) {
    return { written: 0, failed: classify(err) }
  }
}

// `dnt-notes` IndexedDB ulanishi — `idb.ts` fabrikasining ikkinchi nusxasi.
//
// Bu fayl izoh mantiqini BILMAYDI: u faqat bazani ochadi va sxemani yaratadi.
// Qator tiplari va limitlar qo'shni `notesSchema.ts` da, izohlar ustidagi
// amallar esa `notes.ts` da.
//
// Ochish/kesh/bloklanish/o'lgan ulanish mantiqi `idb.ts` da — bu yerda
// nusxalanmaydi. Farqi faqat uchta: baza nomi, sxema va bloklanish tipi.

import { createIdbHandle } from './idb.ts'
import {
  DB_NAME,
  DB_VERSION,
  INDEX_NOTES_BY_LESSON,
  INDEX_NOTE_IMAGES_BY_LESSON,
  STORE_NOTES,
  STORE_NOTE_IMAGES,
} from './notesSchema.ts'

/**
 * Boshqa tab eski versiyani ushlab turgani uchun ish bajarilmadi.
 *
 * `StatsDbBlockedError` dan ALOHIDA tip: bannerdagi matn ham, foydalanuvchiga
 * beriladigan maslahat ham boshqa ekranda va boshqa kontekstda chiqadi.
 * Bitta tip qilinsa "statistika bloklandi" xabari izoh yozayotgan odamga
 * ko'rsatilardi.
 */
export class NotesDbBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotesDbBlockedError'
  }
}

/**
 * Sxema FAQAT shu yerda — `onupgradeneeded` ichida — yaratiladi.
 *
 * Ikkala do'kon ham TARKIBIY (compound) kalit ishlatadi: gapning identifikatori
 * `(lessonId, sentenceIndex)` juftligi, rasmniki esa unga `slot` qo'shilgani.
 * Shu tufayli rasm qatori doim o'z izohining kaliti bilan boshlanadi va
 * `IDBKeyRange.bound` bitta gapning hamma rasmini bitta so'rovda beradi.
 */
function createSchemaV1(db: IDBDatabase): void {
  const notes = db.createObjectStore(STORE_NOTES, {
    keyPath: ['lessonId', 'sentenceIndex'],
  })
  notes.createIndex(INDEX_NOTES_BY_LESSON, 'lessonId')

  const images = db.createObjectStore(STORE_NOTE_IMAGES, {
    keyPath: ['lessonId', 'sentenceIndex', 'slot'],
  })
  images.createIndex(INDEX_NOTE_IMAGES_BY_LESSON, 'lessonId')
}

const handle = createIdbHandle({
  name: DB_NAME,
  version: DB_VERSION,
  upgrade: (db, oldVersion) => {
    if (oldVersion < 1) createSchemaV1(db)
  },
  blockedError: (message) => new NotesDbBlockedError(message),
})

export const openNotesDb = handle.openDb
export const closeNotesDb = handle.closeDb
export const deleteNotesDb = handle.deleteDb

/**
 * Izoh iste'molchilari uchun YAGONA yuqori darajali yuza.
 *
 * ⚠️ Tranzaksiya tanasi SINXRON bo'lishi shart — `idb.ts` dagi `runTx` izohiga
 * qarang. `await` ni tana ichiga olib kirish tranzaksiyani o'ldiradi.
 */
export const withNotesDb = handle.withDb

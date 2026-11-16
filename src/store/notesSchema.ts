// `dnt-notes` IndexedDB sxemasi: do'kon nomlari, qator tiplari, limitlar va SOF
// yordamchilar.
//
// Bu fayl IndexedDB API'siga UMUMAN tegmaydi — u faqat "diskda nima yotadi"ni
// tasvirlaydi. Shu sababdan bu yerdagi har bir funksiya hech qanday mock'siz
// sinaladi; IDB'ning o'zi qo'shni `notesDb.ts` da (`statsSchema.ts` ↔
// `statsDb.ts` bilan bir xil bo'linish).
//
// ⭐ NEGA ALOHIDA BAZA, `dnt-stats` ga do'kon qo'shish emas:
// izoh va rasm — O'LCHOV EMAS. Ular foydalanuvchi yozgan kontent va ularning
// umri DARSGA bog'langan. Statistika bazasiga qo'shilsa:
//   - `dnt-stats` hajmi rasmlar hisobiga o'nlab marta shishardi, holbuki u
//     yengil va tez o'qiladigan o'lchov ombori bo'lib qolishi kerak;
//   - mavjud foydalanuvchilarda `DB_VERSION` 1 → 2 yangilanishi kerak bo'lardi,
//     ya'ni ko'p tabli "bloklangan" holati va migratsiya xatari — bularning
//     hammasi izoh yozish uchun.
// Alohida baza bu ikkovini ham olib tashlaydi va zaxira hikoyasini ham
// soddalashtiradi: izohlar DARS `.json` fayli bilan ko'chadi (`lessons.ts`),
// statistika zaxirasi bilan emas.
//
// ⚠️ Izohlar `statsCompact.ts` dagi 180 kunlik so'nishga TUSHMAYDI. Sabab: seans
// yozuvi — o'lchov, uning ma'lumoti `words`/`days`/`meta.lifetime` da qoladi,
// ya'ni tashlash hech narsani kambag'allashtirmaydi. Izoh esa boshqa hech
// qayerda nusxasi bo'lmagan qo'l mehnati — uni taymer bilan o'chirish siqish
// emas, ma'lumot yo'qotish bo'lardi.

import { isRecord, toFiniteNumber, toText } from './statsSchema.ts'

/** Ma'lumotlar bazasi nomi. Bitta baza — ikkita do'kon. */
export const DB_NAME = 'dnt-notes'

/**
 * Sxema versiyasi. Har qanday do'kon yoki indeks o'zgarishi bu sonni oshirishni
 * TALAB qiladi: `createObjectStore` faqat `onupgradeneeded` ichida ishlaydi.
 */
export const DB_VERSION = 1

export const STORE_NOTES = 'notes'
export const STORE_NOTE_IMAGES = 'noteImages'

/**
 * Ikkala do'konda ham `lessonId` bo'yicha indeks — dars o'chirilganda uning
 * hamma izohini bitta so'rov bilan topish uchun.
 */
export const INDEX_NOTES_BY_LESSON = 'by_lesson'
export const INDEX_NOTE_IMAGES_BY_LESSON = 'by_lesson'

/** Izoh matnining chegarasi. Undan uzun matn — bu izoh emas, hujjat. */
export const MAX_NOTE_CHARS = 4000

/**
 * Bitta gapga biriktiriladigan rasm soni.
 *
 * Bittadan ko'p, chunki buferdan ketma-ket rasm qo'yish tabiiy ish; cheksiz
 * emas, chunki hammasi dars `.json` fayliga base64 bo'lib kiradi.
 */
export const MAX_IMAGES_PER_NOTE = 3

/**
 * Tanlangan faylning chegarasi — SIQISHDAN OLDIN (`core/imageResize.ts`).
 *
 * Siqilgan natija odatda ~200-400 KB bo'ladi, ya'ni bu chegara "brauzer bunga
 * urinib ham ko'rmasin" degan qo'pol filtr: 12 MB dan katta rasm deyarli doim
 * xato tanlangan fayl (RAW foto, skanerlangan hujjat) bo'ladi.
 */
export const MAX_INPUT_IMAGE_BYTES = 12 * 1024 * 1024

/**
 * Siqishdan KEYIN saqlanadigan blobning chegarasi.
 *
 * Siqish ishlamagan muhitda (eski brauzer, `OffscreenCanvas` yo'q) asl fayl
 * saqlanadi — o'shanda ham 4 MB dan katta narsa bazaga tushmasligi kerak.
 */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024

/**
 * Qabul qilinadigan turlar.
 *
 * `image/svg+xml` ATAYIN yo'q: u skrinshot formati emas va hujjat daraxti olib
 * yuradigan yagona rasm turi. Qolganlari — telefon va kompyuter skrinshotlari
 * hamda foto uchun yetarli.
 */
export const ACCEPTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
] as const

/** Gap boshining saqlanadigan uzunligi (`NoteRow.s`). */
export const SENTENCE_HEAD_CHARS = 80

// ---------------------------------------------------------------------------
// Qator tiplari
// ---------------------------------------------------------------------------

/**
 * Izoh matni. Kalit — `['lessonId','sentenceIndex']`.
 *
 * Gapning O'ZIDA identifikator yo'q (`Lesson.sentences` — oddiy `string[]`),
 * shuning uchun bu juftlik ilovadagi gap kimligining YAGONA ta'rifi:
 * `SentenceRecord.sentenceIndex`, `Lesson.progress` va `Lesson.skipped` ham
 * xuddi shunga tayanadi.
 */
export type NoteRow = {
  lessonId: string
  sentenceIndex: number
  text: string
  updatedAt: number
  /**
   * Yozilgan paytdagi gapning boshi (≤`SENTENCE_HEAD_CHARS`).
   *
   * KALIT EMAS va hech qachon kalit bo'lmaydi. Vazifasi bitta: zaxira fayli
   * mavjud dars ustiga tiklanganda gaplar boshqacha bo'lingan bo'lishi mumkin
   * (`mergeLesson` `sentences` ni butunlay almashtiradi) va o'shanda izoh
   * jimgina boshqa gapga tegib qolardi. Mos kelmasa UI ogohlantiradi.
   */
  s?: string
}

/**
 * Izohga biriktirilgan rasm. Kalit — `['lessonId','sentenceIndex','slot']`.
 *
 * ⭐ NEGA MATNDAN ALOHIDA DO'KON: matn har ~600 ms da avtosaqlanadi, IndexedDB
 * da esa qisman yangilash YO'Q — bitta qatorda tursa har saqlashda bir necha
 * MB blob qaytadan serializatsiya qilinardi. Ajratilgach matn yozuvi ~200 bayt
 * bo'lib qoladi, rasm esa faqat qo'shilganda/o'chirilganda yoziladi.
 */
export type NoteImageRow = {
  lessonId: string
  sentenceIndex: number
  /** 0,1,2… — qo'yilish tartibi. Kalitning uchinchi bo'lagi. */
  slot: number
  blob: Blob
  type: string
  /** `blob.size` nusxasi: tekshiruv blobni ochishga majbur bo'lmasin. */
  size: number
  /** Asl fayl nomi — faqat ko'rsatish va `alt` uchun. */
  name: string
  addedAt: number
}

// ---------------------------------------------------------------------------
// Sof yordamchilar
// ---------------------------------------------------------------------------

/** Matnni chegaraga keltiradi. Zaxira fayli ham, boshqa qurilma ham har qanday satr berishi mumkin. */
export function clampNoteText(raw: string): string {
  return raw.length <= MAX_NOTE_CHARS ? raw : raw.slice(0, MAX_NOTE_CHARS)
}

/** `NoteRow.s` uchun gap boshini kesadi. */
export function sentenceHead(sentence: string): string {
  return sentence.length <= SENTENCE_HEAD_CHARS
    ? sentence
    : sentence.slice(0, SENTENCE_HEAD_CHARS)
}

export type ImageCheck = 'ok' | 'type' | 'size' | 'empty'

/**
 * Tanlangan faylni SIQISHDAN OLDIN tekshiradi.
 *
 * Sehrli baytlar TEKSHIRILMAYDI va bu ataylab: bu bir foydalanuvchili lokal
 * ilova, faylni foydalanuvchining o'zi tanlaydi, `file.type` esa brauzerning
 * o'z xulosasi. Bayt tekshiruvi qo'shimcha `arrayBuffer()` qadami evaziga
 * hech qanday haqiqiy xatarni kamaytirmasdi.
 */
export function checkImage(file: { type: string; size: number }): ImageCheck {
  if (file.size <= 0) return 'empty'
  if (!isAcceptedImageType(file.type)) return 'type'
  if (file.size > MAX_INPUT_IMAGE_BYTES) return 'size'
  return 'ok'
}

export function isAcceptedImageType(type: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)
}

/** Butun, manfiy bo'lmagan indeks; boshqa hamma narsa `null`. */
function toIndex(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < 0 || !Number.isInteger(value)) return null
  return value
}

/**
 * Buzuq qator butun ro'yxatni yo'q qilmaydi: tanib bo'lmaydigan yozuv `null`
 * qaytaradi va chaqiruvchi uni jimgina tashlab yuboradi (`lessons.ts` dagi
 * `toLesson` bilan bir xil qaror).
 */
export function toNoteRow(raw: unknown): NoteRow | null {
  if (!isRecord(raw)) return null

  const lessonId = raw['lessonId']
  if (typeof lessonId !== 'string' || lessonId === '') return null

  const sentenceIndex = toIndex(raw['sentenceIndex'])
  if (sentenceIndex === null) return null

  const head = raw['s']
  return {
    lessonId,
    sentenceIndex,
    text: clampNoteText(toText(raw['text'], '')),
    updatedAt: toFiniteNumber(raw['updatedAt'], 0),
    ...(typeof head === 'string' && head !== '' ? { s: sentenceHead(head) } : {}),
  }
}

export function toNoteImageRow(raw: unknown): NoteImageRow | null {
  if (!isRecord(raw)) return null

  const lessonId = raw['lessonId']
  if (typeof lessonId !== 'string' || lessonId === '') return null

  const sentenceIndex = toIndex(raw['sentenceIndex'])
  if (sentenceIndex === null) return null

  const slot = toIndex(raw['slot'])
  if (slot === null) return null

  // Blob bo'lmagan qiymat — bu rasm emas. Tiklab bo'lmaydi, shuning uchun qator
  // butunlay rad etiladi (matn qatoriga tegilmaydi).
  const blob: unknown = raw['blob']
  if (!(blob instanceof Blob)) return null

  return {
    lessonId,
    sentenceIndex,
    slot,
    blob,
    // Turni blobning O'ZIDAN olamiz: qatordagi `type` maydoni buzuq bo'lsa ham
    // brauzer blobni to'g'ri turi bilan qaytaradi.
    type: toText(raw['type'], blob.type),
    size: toFiniteNumber(raw['size'], blob.size),
    name: toText(raw['name'], 'rasm'),
    addedAt: toFiniteNumber(raw['addedAt'], 0),
  }
}

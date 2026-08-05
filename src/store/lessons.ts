// Darslar ombori (PLAN §7): bitta import qilingan matn = bitta dars.
// Yagona saqlash joyi — `localStorage`, kalit `dnt.lessons.v1`.
//
// MA'LUM CHEKLOV (PLAN §10): saqlash brauzerning yagona nusxasi.
// Ikkita ochiq tab bir vaqtda yozsa, OXIRGI yozgani g'olib bo'ladi — bu yerda
// har bir yozuv butun ro'yxatni qayta yozadi, ya'ni ikkinchi tabning eski
// nusxasi birinchisining o'zgarishini bosib ketishi mumkin. Bu ongli qaror:
// qulflash yoki `storage` hodisasi bilan birlashtirish v1 doirasidan tashqarida.

const LESSONS_KEY = 'dnt.lessons.v1'

/**
 * O'qib bo'lmagan payload shu kalitga ko'chiriladi (PLAN §10). Bir nechta
 * buzilishdan qaysi biri saqlanishini `backupCorrupt` hal qiladi.
 *
 * Buzuq satrni shunchaki "o'chirmay qoldirish" yetarli emas edi: har qanday
 * yozuv butun ro'yxatni qayta yozgani uchun tiklash oynasi bitta saqlashgacha
 * davom etardi. Nusxa alohida kalitda tursa, darslarni saqlash yo'li
 * (`writeAll`) uni bosib keta olmaydi.
 */
const LESSONS_CORRUPT_KEY = 'dnt.lessons.v1.corrupt'

export type Lesson = {
  id: string
  title: string
  createdAt: number
  /** Foydalanuvchi paste qilgan asl matn (normalizatsiya diffini ko'rsatish uchun saqlanadi). */
  originalText: string
  /** Mashq uchun target: normallashtirilgan ASCII matn. */
  normalizedText: string
  sentences: string[]
  /** Gap darajasida davom ettirish (PLAN §7): keyingi boshlanadigan gap indeksi. */
  progress: number
  voice: string
  rate: number
}

/**
 * `localStorage` ga xavfsiz murojaat.
 * Uch xil muhitda yo'q yoki taqiqlangan bo'lishi mumkin: Node (test/SSR),
 * cookie'lari o'chirilgan brauzer va `file://` sahifasi — ularning ikkitasida
 * shunchaki `undefined` emas, murojaatning O'ZI `SecurityError` tashlaydi,
 * shuning uchun tekshiruv ham `try` ichida.
 */
function getStore(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toText(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * Buzuq yozuvni butun ro'yxatni yo'q qilishga qo'ymaydi: tanib bo'lmaydigan
 * dars `null` qaytaradi va ro'yxatga umuman kirmaydi, qolganlari saqlanadi.
 *
 * Bunday yozuv `readStored` da ALOHIDA to'planadi va keyingi saqlashda diskka
 * qaytariladi (`writeAll`) — aks holda birinchi `saveLesson` uni o'chirib
 * yuborardi. Chaqiruvchi kodga esa hech qachon yetib bormaydi.
 */
function toLesson(raw: unknown): Lesson | null {
  if (!isRecord(raw)) return null

  const id = raw['id']
  if (typeof id !== 'string' || id === '') return null

  const rawSentences = raw['sentences']
  if (!Array.isArray(rawSentences)) return null
  const sentences: string[] = []
  for (const item of rawSentences) {
    if (typeof item !== 'string') return null
    sentences.push(item)
  }

  const normalizedText = toText(raw['normalizedText'], '')

  return {
    id,
    title: toText(raw['title'], 'Nomsiz dars'),
    createdAt: toFiniteNumber(raw['createdAt'], 0),
    originalText: toText(raw['originalText'], normalizedText),
    normalizedText,
    sentences,
    progress: clampProgress(toFiniteNumber(raw['progress'], 0), sentences.length),
    voice: toText(raw['voice'], ''),
    rate: toFiniteNumber(raw['rate'], 0),
  }
}

/**
 * Progress — keyingi boshlanadigan gap indeksi, shuning uchun `sentences.length`
 * ham HAQIQIY qiymat: u "dars tugadi" degani. Undan kattasi va manfiysi kesiladi,
 * aks holda Practice ekrani mavjud bo'lmagan gapdan boshlashga urinardi.
 */
function clampProgress(value: number, total: number): number {
  const index = Math.floor(value)
  if (!Number.isFinite(index) || index < 0) return 0
  return index > total ? total : index
}

/** O'qish natijasi: tanilgan darslar va parser tanimagan xom yozuvlar. */
type StoredLessons = { lessons: Lesson[]; unknown: unknown[] }

/** HAR SAFAR yangi massivlar: chaqiruvchilar (`saveLesson`) natijani joyida o'zgartiradi. */
function emptyRead(): StoredLessons {
  return { lessons: [], unknown: [] }
}

/**
 * O'qib bo'lmagan xom satrni zaxira kalitiga ko'chiradi.
 *
 * QOIDA: zaxirada ENG UZUN buzuq satr qoladi. Har safar buzilish topilganda
 * yangi satr mavjud nusxa bilan uzunligi bo'yicha solishtiriladi; qisqasi
 * tashlanadi, teng bo'lsa mavjudi o'z o'rnida qoladi.
 *
 * Uzunlik — qo'lda tiklab olish mumkin bo'lgan matn hajmining o'rnini bosuvchi
 * o'lchov. Bu ombor butun ro'yxatni bitta satrga yozadi, ya'ni o'nlab darsni
 * ushlab turgan kesilgan ro'yxat bitta darsli satrdan uzun bo'ladi. Shuning
 * uchun uzunini saqlash qo'lda ko'proq matn topish imkonini beradi.
 */
function backupCorrupt(store: Storage, raw: string): void {
  try {
    const existing = store.getItem(LESSONS_CORRUPT_KEY)
    if (existing !== null && existing.length >= raw.length) return
    store.setItem(LESSONS_CORRUPT_KEY, raw)
  } catch {
    // Kvota to'lgan yoki yozish taqiqlangan — zaxirasiz davom etamiz:
    // saqlashning o'zi to'xtab qolgandan yaxshiroq.
  }
}

/**
 * Xom satr sifatida saqlanib qolgan buzuq payload (bo'lmasa `null`).
 * UI shu orqali "eski darslar zaxirada" xabarini ko'rsatishi mumkin —
 * bu modul ekran chizmaydi.
 */
export function corruptLessonsBackup(): string | null {
  const store = getStore()
  if (store === null) return null
  try {
    return store.getItem(LESSONS_CORRUPT_KEY)
  } catch {
    return null
  }
}

/**
 * Zaxira nusxani o'chiradi. Foydalanuvchi uni saqlab olgandan keyin kerak:
 * aks holda buzuq satr kvotani abadiy band qilib turardi.
 */
export function discardCorruptLessonsBackup(): void {
  const store = getStore()
  if (store === null) return
  try {
    store.removeItem(LESSONS_CORRUPT_KEY)
  } catch {
    // O'chirib bo'lmadi — yiqilmaymiz.
  }
}

function readStored(): StoredLessons {
  const store = getStore()
  if (store === null) return emptyRead()

  let raw: string | null = null
  try {
    raw = store.getItem(LESSONS_KEY)
  } catch {
    return emptyRead()
  }
  if (raw === null || raw === '') return emptyRead()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Buzuq JSON — bo'sh ro'yxat bilan davom etamiz. Ma'lumotni O'CHIRMAYMIZ
    // va, undan muhimi, uni zaxiraga taklif qilamiz: aks holda keyingi
    // `saveLesson` uni ustidan yozib yuborardi.
    backupCorrupt(store, raw)
    return emptyRead()
  }
  if (!Array.isArray(parsed)) {
    // JSON o'qildi, lekin ildiz massiv emas — oqibati bir xil, shuning uchun
    // zaxira shu yerda ham taklif etiladi.
    backupCorrupt(store, raw)
    return emptyRead()
  }

  const lessons: Lesson[] = []
  const unknown: unknown[] = []
  for (const item of parsed) {
    const lesson = toLesson(item)
    if (lesson === null) unknown.push(item)
    else lessons.push(lesson)
  }
  return { lessons, unknown }
}

/**
 * Faqat tanilgan darslar.
 *
 * DIQQAT: bu sof o'qish emas. O'qib bo'lmaydigan payload topilsa, u
 * `dnt.lessons.v1.corrupt` kalitiga YOZILISHI mumkin — `backupCorrupt` uni
 * o'sha kalitdagi nusxadan uzun bo'lsagina saqlaydi.
 */
function readAll(): Lesson[] {
  return readStored().lessons
}

function writeAll(lessons: Lesson[], unknown: unknown[]): void {
  const store = getStore()
  if (store === null) return

  // Parser tanimagan yozuvlar oxiriga qo'shiladi: ular ro'yxatga chiqmaydi,
  // lekin keyingi saqlash ularni o'chirib yubormaydi.
  const payload: unknown[] = unknown.length === 0 ? lessons : [...lessons, ...unknown]
  try {
    store.setItem(LESSONS_KEY, JSON.stringify(payload))
  } catch {
    // Kvota to'lgan yoki yozish taqiqlangan. Yiqilmaymiz — mashqni davom
    // ettirish saqlashdan muhimroq; foydalanuvchi faqat progressni yo'qotadi.
  }
}

/** Darslar ro'yxati: yangi -> eski (`createdAt` bo'yicha kamayish tartibida). */
export function listLessons(): Lesson[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt)
}

export function getLesson(id: string): Lesson | null {
  for (const lesson of readAll()) {
    if (lesson.id === id) return lesson
  }
  return null
}

/** Mavjud `id` ni ustiga yozadi, bo'lmasa yangisini qo'shadi. */
export function saveLesson(lesson: Lesson): void {
  const safe: Lesson = {
    ...lesson,
    progress: clampProgress(lesson.progress, lesson.sentences.length),
  }
  const stored = readStored()
  const lessons = stored.lessons
  const index = lessons.findIndex((item) => item.id === safe.id)
  if (index >= 0) {
    lessons[index] = safe
  } else {
    lessons.push(safe)
  }
  writeAll(lessons, stored.unknown)
}

export function deleteLesson(id: string): void {
  const stored = readStored()
  writeAll(
    stored.lessons.filter((lesson) => lesson.id !== id),
    stored.unknown,
  )
}

/**
 * Parser tanimagan xom yozuvlar soni. UI shu son orqali tozalash taklifini
 * ko'rsatadi — yozuvlarning O'ZI chaqiruvchiga baribir berilmaydi.
 */
export function unknownLessonCount(): number {
  return readStored().unknown.length
}

/**
 * Tanib bo'lmaydigan xom yozuvlarni ombordan chiqaradi; tanilgan darslar
 * tegilmaydi.
 *
 * Bunday yozuvlarni saqlab qolish ATAYIN qilingan (bitta buzuq yozuv qolgan
 * darslarni yo'q qilmasin), lekin shu yo'lsiz ular hech qachon o'chmasdi:
 * `saveLesson` ham, `deleteLesson` ham har safar ularni diskka qaytaradi.
 * Ya'ni foydalanuvchi joy egallab turgan axlatdan qutula olmasdi.
 */
export function discardUnknownLessons(): void {
  const stored = readStored()
  if (stored.unknown.length === 0) return
  writeAll(stored.lessons, [])
}

/**
 * Gap darajasidagi davom ettirish nuqtasini yangilaydi (PLAN §7).
 * Dars topilmasa jimgina qaytadi — o'chirilgan darsning tugagan seansi
 * yangi bo'sh yozuv yaratib qo'ymasligi kerak.
 */
export function setProgress(id: string, sentenceIndex: number): void {
  const stored = readStored()
  const lessons = stored.lessons
  const index = lessons.findIndex((lesson) => lesson.id === id)
  const current = index >= 0 ? lessons[index] : undefined
  if (current === undefined) return

  lessons[index] = {
    ...current,
    progress: clampProgress(sentenceIndex, current.sentences.length),
  }
  writeAll(lessons, stored.unknown)
}

/**
 * `crypto.randomUUID()` faqat xavfsiz kontekstda mavjud: `https://` va
 * `localhost` da ishlaydi, lekin telefondan `http://192.168.x.x:5173` ga
 * kirilganda `undefined` bo'ladi. Shuning uchun zaxira generator SHART —
 * usiz dars saqlash o'sha muhitda `TypeError` bilan yiqilardi.
 */
export function newLessonId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Pastdagi zaxiraga o'tamiz.
  }
  const time = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `l-${time}-${random}`
}

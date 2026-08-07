// Darslar ombori (PLAN §7): bitta import qilingan matn = bitta dars.
// Yagona saqlash joyi — `localStorage`, kalit `dnt.lessons.v1`.
//
// MA'LUM CHEKLOV (PLAN §10): saqlash brauzerning yagona nusxasi.
// Ikkita ochiq tab bir vaqtda yozsa, OXIRGI yozgani g'olib bo'ladi — bu yerda
// har bir yozuv butun ro'yxatni qayta yozadi, ya'ni ikkinchi tabning eski
// nusxasi birinchisining o'zgarishini bosib ketishi mumkin. Bu ongli qaror:
// qulflash yoki `storage` hodisasi bilan birlashtirish v1 doirasidan tashqarida.

import type { EmphasisRange } from '../core/emphasis.ts'
import { parseEmphasis } from '../core/emphasis.ts'

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
  /**
   * `Escape` bilan tashlangan gaplar indekslari — dars oxirida shular qaytadi
   * (`core/session.ts` dagi `nextSentenceIndex`).
   *
   * IXTIYORIY: bu maydon keyin qo'shilgan va eski saqlangan darslarda umuman
   * yo'q. O'qishda (`toLesson`) doim massivga normallashtiriladi, ya'ni
   * chaqiruvchi kod uchun u amalda majburiy.
   */
  skipped?: number[]
  /**
   * Har gap uchun QALIN chiziladigan oraliqlar: `emphasis[i]` — `sentences[i]` uchun,
   * indekslar o'sha gap matnida. Import paytida `` `...` `` belgilaridan hosil bo'ladi;
   * belgilarning o'zi `sentences` ga TUSHMAYDI (`core/emphasis.ts`).
   *
   * IXTIYORIY, `skipped` bilan bir xil sababdan: keyin qo'shilgan va eski darslarda
   * umuman yo'q — bunda qalinlik ham bo'lmaydi. Bundan tashqari birorta gapda oraliq
   * bo'lmasa maydon SAQLANMAYDI: 500 gapli darsda `[[],[],...]` bekorga joy egallardi.
   */
  emphasis?: EmphasisRange[][]
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
  const marks = readMarks(sentences, raw['emphasis'])

  return {
    id,
    title: toText(raw['title'], 'Nomsiz dars'),
    createdAt: toFiniteNumber(raw['createdAt'], 0),
    originalText: toText(raw['originalText'], normalizedText),
    normalizedText,
    sentences: marks.sentences,
    progress: clampProgress(toFiniteNumber(raw['progress'], 0), marks.sentences.length),
    skipped: toSkipped(raw['skipped'], marks.sentences.length),
    emphasis: marks.emphasis,
    voice: toText(raw['voice'], ''),
    rate: toFiniteNumber(raw['rate'], 0),
  }
}

/**
 * Tashlangan gaplar ro'yxatini normallashtiradi: butun son bo'lmagan, chegaradan
 * chiqqan va takrorlangan indekslar tashlanadi, natija o'sish tartibida qaytadi.
 *
 * Buzuq yozuv butun darsni yo'q qilmaydi (`toLesson` dan farqli o'laroq bu yerda
 * `null` yo'q): ro'yxat qulaylik uchun, dars matni undan muhimroq. Maydonning
 * o'zi yo'q bo'lsa ham (eski darslar) bo'sh massiv qaytadi.
 *
 * Tartib SHART: `nextSentenceIndex` eng kichigini oladi va tartibli ro'yxat
 * omborda ham o'qishga qulay bo'ladi.
 */
function toSkipped(raw: unknown, total: number): number[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  for (const item of raw) {
    if (typeof item !== 'number' || !Number.isFinite(item)) continue
    const index = Math.floor(item)
    if (index < 0 || index >= total) continue
    seen.add(index)
  }
  return [...seen].sort((a, b) => a - b)
}

/**
 * ⭐ Gap matni + ta'kidlash oraliqlari — ombordan o'qishning YAGONA nuqtasi.
 *
 * Ikki manba bo'lishi mumkin:
 *
 * 1. `emphasis` maydoni BOR — dars ta'kidlash qo'shilgandan keyin saqlangan.
 *    Gaplar allaqachon toza (belgilar import paytida ajratilgan), oraliqlar esa
 *    faqat tekshiriladi.
 *
 * 2. `emphasis` maydoni YO'Q — dars undan OLDIN saqlangan. Bunday darsda `` `...` ``
 *    hali gap matnining ICHIDA turadi: o'sha paytda u oddiy belgi edi va TARGETGA
 *    tushardi, ya'ni foydalanuvchi teskari tirnoqni qo'lda terishga majbur bo'lardi.
 *    Shuning uchun belgilar shu yerda, O'QISHDA ajratiladi.
 *
 * Ko'chirish xavfsiz va idempotent: belgisi yo'q gap uchun `parseEmphasis` matnni
 * aynan o'zini qaytaradi, ya'ni ta'kidlashsiz darslarga umuman tegilmaydi. Yangi kod
 * saqlagan darsda esa juftlangan belgilar allaqachon olib tashlangan — qolgan yolg'iz
 * tirnoq ATAYIN qoldirilgan va `parseEmphasis` uni ham qaytadan tegmasdan o'tkazadi.
 *
 * Gaplar SONI o'zgarmaydi, shuning uchun `progress`, `skipped` va statistikadagi
 * `sentenceIndex` yozuvlari o'z ma'nosini saqlaydi.
 */
function readMarks(
  sentences: string[],
  rawEmphasis: unknown,
): { sentences: string[]; emphasis: EmphasisRange[][] | undefined } {
  const stored = toEmphasis(rawEmphasis, sentences)
  if (stored !== undefined) return { sentences, emphasis: stored }

  const text: string[] = []
  const ranges: EmphasisRange[][] = []
  let changed = false
  for (const sentence of sentences) {
    const parsed = parseEmphasis(sentence)
    if (parsed.text !== sentence) changed = true
    text.push(parsed.text)
    ranges.push(parsed.ranges)
  }
  // Hech narsa o'zgarmasa ESKI massiv qaytadi: keraksiz nusxa ham, `emphasis: []`
  // kabi bo'sh maydon ham yasalmaydi.
  if (!changed) return { sentences, emphasis: undefined }

  return { sentences: text, emphasis: ranges.some((list) => list.length > 0) ? ranges : undefined }
}

/**
 * Ta'kidlash oraliqlarini normallashtiradi: ro'yxat uzunligi `sentences` ga
 * tenglashtiriladi, yaroqsiz oraliqlar tashlanadi, natija o'sish tartibida va
 * KESISHMASDAN qaytadi (chizuvchi aynan shunga tayanadi).
 *
 * `toSkipped` bilan bir xil qaror: buzuq yozuv butun darsni yo'q qilmaydi —
 * ta'kidlash bezak, dars matni undan muhimroq.
 *
 * Chegara `sentences[i].length` bo'yicha tekshiriladi: gap qisqargan (yoki ombor
 * qo'lda tahrirlangan) bo'lsa, chegaradan chiqqan oraliq chizuvchiga yetib borsa
 * hech qanday belgiga mos kelmasdi va jimgina yo'qolardi.
 *
 * Hech bir gapda oraliq qolmasa `undefined` qaytadi — maydon saqlanmaydi.
 */
function toEmphasis(raw: unknown, sentences: readonly string[]): EmphasisRange[][] | undefined {
  if (!Array.isArray(raw)) return undefined

  let found = false
  const result: EmphasisRange[][] = []
  for (let i = 0; i < sentences.length; i += 1) {
    const list = toRangeList(raw[i], (sentences[i] ?? '').length)
    if (list.length > 0) found = true
    result.push(list)
  }
  return found ? result : undefined
}

/** Bitta gapning oraliqlari: tartiblangan, kesishmagan, chegara ichida. */
function toRangeList(raw: unknown, limit: number): EmphasisRange[] {
  if (!Array.isArray(raw)) return []

  const ranges: EmphasisRange[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const start = Math.floor(toFiniteNumber(item['start'], -1))
    const end = Math.floor(toFiniteNumber(item['end'], -1))
    if (start < 0 || end <= start || end > limit) continue
    ranges.push({ start, end })
  }
  ranges.sort((a, b) => a.start - b.start)

  const clean: EmphasisRange[] = []
  let last = 0
  for (const range of ranges) {
    // Kesishgan oraliq butunlay tashlanadi, kesilmaydi: birlashtirish yoki qirqish
    // buzuq yozuvdan "mazmunli" natija to'qib chiqarardi.
    if (range.start < last) continue
    clean.push(range)
    last = range.end
  }
  return clean
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

/**
 * Natija — YOZILDIMI degan javob. Mashq yo'llari (`setProgress`,
 * `completeSentence`) uni ATAYIN e'tiborsiz qoldiradi: ular uchun yiqilmaslik
 * muhimroq. Import esa aksincha — javobsiz u kvota to'lganda ham
 * "tiklandi" deb xabar berardi (`importLessonsJson`).
 */
function writeAll(lessons: Lesson[], unknown: unknown[]): boolean {
  const store = getStore()
  if (store === null) return false

  // Parser tanimagan yozuvlar oxiriga qo'shiladi: ular ro'yxatga chiqmaydi,
  // lekin keyingi saqlash ularni o'chirib yubormaydi.
  const payload: unknown[] = unknown.length === 0 ? lessons : [...lessons, ...unknown]
  try {
    store.setItem(LESSONS_KEY, JSON.stringify(payload))
    return true
  } catch {
    // Kvota to'lgan yoki yozish taqiqlangan. Yiqilmaymiz — mashqni davom
    // ettirish saqlashdan muhimroq; foydalanuvchi faqat progressni yo'qotadi.
    return false
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
    skipped: toSkipped(lesson.skipped, lesson.sentences.length),
    emphasis: toEmphasis(lesson.emphasis, lesson.sentences),
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
 * Bitta gap yakunlangandan keyin darsni yangilaydi: davom ettirish nuqtasi VA
 * tashlangan gaplar ro'yxati.
 *
 * Ikkovi BIRGA yoziladi, chunki ular bitta qarorning ikki tomoni: `Escape`
 * bosilganda gap ro'yxatga tushadi, lekin progress baribir oldinga suriladi
 * (`nextSentenceIndex` dagi izohga qarang). Alohida ikki chaqiruv omborni ikki
 * marta o'qib-yozardi va oraliqda dars nomuvofiq holatda qolardi.
 *
 * PROGRESS ORQAGA SURILMAYDI. Dars oxirida qaytgan tashlangan gap yozib
 * tugatilganda `sentenceIndex + 1` saqlangan qiymatdan kichik bo'ladi va oddiy
 * yozuv foydalanuvchini allaqachon yozib bo'lgan gaplariga qaytarib tashlardi.
 * Boshidan boshlash `setProgress(id, 0)` orqali ATAYLAB alohida yo'l.
 *
 * Dars topilmasa jimgina qaytadi (`setProgress` bilan bir xil qaror):
 * o'chirilgan darsning tugagan seansi yangi bo'sh yozuv yaratmasligi kerak.
 */
export function completeSentence(id: string, sentenceIndex: number, skipped: boolean): void {
  const stored = readStored()
  const lessons = stored.lessons
  const index = lessons.findIndex((lesson) => lesson.id === id)
  const current = index >= 0 ? lessons[index] : undefined
  if (current === undefined) return

  const total = current.sentences.length
  const done = Math.floor(sentenceIndex)
  if (!Number.isFinite(done) || done < 0 || done >= total) return

  const list = new Set(current.skipped ?? [])
  if (skipped) list.add(done)
  else list.delete(done)

  lessons[index] = {
    ...current,
    progress: Math.max(current.progress, clampProgress(done + 1, total)),
    skipped: [...list].sort((a, b) => a - b),
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

// ---------------------------------------------------------------------------
// Eksport / import — statistika zaxirasining (PLAN §6) darslar uchun juftligi
// ---------------------------------------------------------------------------

/**
 * Zaxira faylining shakli.
 *
 * `version` — SHU FAYLNIKI, ombornikidan alohida: diskda darslar sarlavhasiz
 * massiv bo'lib yotadi (`LESSONS_KEY`). Fayl esa o'zini tanitishi kerak, aks
 * holda u statistika zaxirasi bilan bir xil ko'rinardi va ikkovi bitta "zaxira"
 * bo'limidan tanlanadi — noto'g'ri fayl jimgina rad etilishi emas, SABABI bilan
 * rad etilishi kerak.
 *
 * `kind` esa `version` yolg'iz hal qila olmaydigan narsani hal qiladi: ikkala
 * faylda ham `version: 1` turadi, ya'ni farqni faqat maydonlar nomi ko'rsatadi.
 */
type LessonsFile = { version: 1; kind: 'lessons'; lessons: Lesson[] }

/** Zaxira uchun o'qish mumkin bo'lgan JSON (2 probel chekinish, `stats.exportJson` bilan bir xil). */
export function exportLessonsJson(): string {
  const file: LessonsFile = { version: 1, kind: 'lessons', lessons: listLessons() }
  return JSON.stringify(file, null, 2)
}

/**
 * Fayl ildizidan dars yozuvlari massivini ajratadi.
 *
 * Sarlavhasiz MASSIV ham qabul qilinadi va bu ataylab: ombor formatining O'ZI
 * shunday, ya'ni buzuq nusxa sifatida yuklab olingan `.txt`
 * (`corruptLessonsBackup`) aynan shu ko'rinishda bo'ladi. Uni qo'lda tuzatib
 * qaytadan yuklash — tiklashning eng ehtimolli yo'li, shuning uchun uni envelope
 * yozishga majburlash tiklashni qiyinlashtirardi.
 */
function readFileRows(parsed: unknown): { ok: true; rows: unknown[] } | { ok: false; error: string } {
  if (Array.isArray(parsed)) return { ok: true, rows: parsed }
  if (!isRecord(parsed)) {
    return { ok: false, error: 'Fayl formati noto\'g\'ri: JSON obyekti yoki massivi kutilgan edi.' }
  }
  if (parsed['version'] !== 1) {
    return { ok: false, error: 'Qo\'llab-quvvatlanmaydigan versiya: `version: 1` kutilgan edi.' }
  }
  const rows = parsed['lessons']
  if (!Array.isArray(rows)) {
    return {
      ok: false,
      error: '`lessons` maydoni massiv bo\'lishi shart — bu statistika zaxirasi emasmi?',
    }
  }
  return { ok: true, rows }
}

/**
 * Bir xil `id` uchrasa nima qilinadi.
 *
 * MAZMUN fayldagidan olinadi — bu tiklash, fayl shu dars uchun manba.
 *
 * PROGRESS esa ORQAGA SURILMAYDI: `completeSentence` dagi bilan bir xil qoida.
 * Dushanba kuni eksport qilib, hafta davomida mashq qilib, juma kuni o'sha eski
 * faylni adashib import qilish — real ssenariy, va oddiy almashtirish bir
 * haftalik progressni jimgina yo'q qilardi. Toza omborga tiklashda esa bu qoida
 * hech narsani o'zgartirmaydi: solishtiradigan saqlangan yozuv yo'q.
 *
 * `skipped` progress bilan BIRGA yuradi: tashlangan gaplar ro'yxati aynan o'sha
 * progressni hosil qilgan o'tish yo'lining bir qismi. Ilgarilagan yozuvning
 * progressini olib, orqadagi yozuvning tashlanganlarini olish ikkovini ham
 * yolg'on holatga qo'yardi.
 *
 * Chegara fayldagi gaplar soni bo'yicha qaytadan tekshiriladi: saqlangan dars
 * uzunroq bo'lsa, uning progressi yangi matnga sig'masligi mumkin.
 */
function mergeLesson(stored: Lesson, incoming: Lesson): Lesson {
  const total = incoming.sentences.length
  const kept = clampProgress(stored.progress, total)
  if (kept <= incoming.progress) return incoming
  return { ...incoming, progress: kept, skipped: toSkipped(stored.skipped, total) }
}

export type LessonsImportResult =
  | { ok: true; added: number; updated: number }
  | { ok: false; error: string }

/**
 * Zaxiradan tiklaydi. Statistikadan FARQLI o'laroq bu BIRLASHTIRISH, almashtirish
 * emas — va farqning sababi ikkala omborning tabiatida:
 *
 * - Statistika yig'indilardan iborat, shuning uchun birlashtirish ikki marta
 *   import qilinganda ularni ikkilantirardi (`stats.importJson`).
 * - Darslar esa turg'un `id` ga ega YAKKA obyektlar. Bir xil faylni ikki marta
 *   import qilish aynan bir xil natija beradi, ya'ni birlashtirish idempotent.
 *   Almashtirish esa aksincha ZARARLI bo'lardi: boshqa brauzerdan bitta darsni
 *   olib kelish shu yerda yaratilgan hamma darsni o'chirib yuborardi.
 *
 * Fayldagi tanib bo'lmaydigan YAKKA yozuv tashlanadi (`toLesson` qoidasi), lekin
 * hech biri o'qilmasa — xato: hech narsa qo'shmagan importni "tiklandi" deb
 * xabar qilish tiklashning ma'nosini buzardi.
 *
 * Xato qaytganda ombor O'ZGARMAYDI: yozish faqat oxirida, bir marta bajariladi.
 */
export function importLessonsJson(raw: string): LessonsImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Faylni JSON sifatida o\'qib bo\'lmadi.' }
  }

  const file = readFileRows(parsed)
  if (!file.ok) return { ok: false, error: file.error }

  // Import ham buzuq payloadni bosib ketadigan birinchi yozuv bo'lishi mumkin —
  // `readStored` o'sha satrni zaxiraga ko'chirib ulguradi (`backupCorrupt`).
  const stored = readStored()
  const lessons = stored.lessons

  let added = 0
  let updated = 0
  for (const row of file.rows) {
    const incoming = toLesson(row)
    if (incoming === null) continue

    const index = lessons.findIndex((item) => item.id === incoming.id)
    const current = index >= 0 ? lessons[index] : undefined
    if (current === undefined) {
      lessons.push(incoming)
      added += 1
    } else {
      lessons[index] = mergeLesson(current, incoming)
      updated += 1
    }
  }

  if (added === 0 && updated === 0) {
    return { ok: false, error: 'Faylda o\'qib bo\'ladigan dars topilmadi.' }
  }

  if (!writeAll(lessons, stored.unknown)) {
    return { ok: false, error: 'Yozib bo\'lmadi: brauzer xotirasi to\'lgan bo\'lishi mumkin.' }
  }
  return { ok: true, added, updated }
}

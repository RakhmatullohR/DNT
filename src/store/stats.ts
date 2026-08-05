// Statistika ombori (PLAN §6): seans yozuvlari, so'z bo'yicha xatolar va kunlik yig'indi.
// Yagona saqlash joyi — `localStorage`, kalit `dnt.stats.v1`.
//
// MA'LUM CHEKLOV (PLAN §10): saqlash brauzerning yagona nusxasi.
// Ikkita ochiq tab bir vaqtda yozsa, OXIRGI yozgani g'olib bo'ladi — bu yerda
// har bir `recordSession` butun hujjatni o'qib, yangilab, qayta yozadi, ya'ni
// ikkinchi tabda bir vaqtda tugagan seans yo'qolishi mumkin. Yumshatish yo'li —
// `exportJson()` bilan muntazam zaxira.

const STATS_KEY = 'dnt.stats.v1'

/**
 * O'qib bo'lmagan payload shu kalitga ko'chiriladi (PLAN §10). Bir nechta
 * buzilishdan qaysi biri saqlanishini `backupCorrupt` hal qiladi.
 *
 * Buzuq satrni shunchaki "o'chirmay qoldirish" yetarli emas edi: har qanday
 * yozuv butun hujjatni qayta yozgani uchun tiklash oynasi bitta tugagan
 * gapgacha davom etardi. Nusxa alohida kalitda tursa, `recordSession` va
 * `importJson` uni bosib keta olmaydi.
 */
const STATS_CORRUPT_KEY = 'dnt.stats.v1.corrupt'

/**
 * Kunlik seriya (streak) chegarasi (PLAN §6): kuniga shuncha to'g'ri bosish.
 * EKSPORT qilinadi, chunki bu son UI da ham ko'rinadi (`Stats.tsx`). Nusxa
 * ko'chirilsa, chegara o'zgarganda ekran eski sonni jimgina ko'rsatib turardi.
 */
export const STREAK_MIN_CORRECT = 100

/** `hardestWords` uchun standart minimal ta'sirlanish soni (PLAN §6). */
const DEFAULT_MIN_EXPOSURES = 5

/** `hardestWords` standart ro'yxat uzunligi. */
const DEFAULT_LIMIT = 20

/**
 * Saqlanadigan seanslar chegarasi. `localStorage` ~5 MB, bitta seans esa
 * gap yozuvlari bilan birga bir necha KB bo'ladi — chegarasiz omborga
 * bir yillik mashq sig'may qoladi va yozuv jimgina uzila boshlaydi.
 * Chegaradan oshganda ENG ESKI seanslar tashlanadi, kunlik va so'z
 * yig'indilari esa TO'LIQ saqlanib qoladi (grafiklar va reyting shulardan).
 */
const MAX_SESSIONS = 500

/** Standart WPM ta'rifi: bitta "so'z" = 5 belgi (PLAN §6, `core/metrics.ts` bilan bir xil). */
const CHARS_PER_WORD = 5
const MS_PER_MINUTE = 60_000

export type SentenceRecord = {
  lessonId: string
  sentenceIndex: number
  at: number
  activeMs: number
  keystrokes: number
  correctKeystrokes: number
  netWpm: number
  rawWpm: number
  accuracy: number
  /** `Tab` bilan qayta boshlashlar soni. Qayta boshlangan urinishning O'ZI statistikaga kirmaydi. */
  restarts: number
  /** `Escape` bilan tashlangan gap — seans yig'indisidan chiqarib tashlanadi. */
  skipped: boolean
  /**
   * Gap yozilayotganda audio yoqiq edimi (PLAN §8 dagi ⭐ M2/M3 gate).
   *
   * ATAYIN IXTIYORIY. Bu maydon qo'shilishidan oldin yozilgan gaplarda ovoz
   * holati NOMA'LUM — ularni `false` deb hisoblash "ovozsiz" ustunini eski
   * tarix bilan ifloslantirardi va gate'ning butun ma'nosini yo'q qilardi.
   * `undefined` qolgan yozuvlar taqqoslashdan chiqarib tashlanadi.
   */
  audioEnabled?: boolean
}

export type SessionRecord = {
  id: string
  lessonId: string
  lessonTitle: string
  startedAt: number
  endedAt: number
  sentences: SentenceRecord[]
  activeMs: number
  keystrokes: number
  correctKeystrokes: number
  netWpm: number
  rawWpm: number
  accuracy: number
}

export type WordStat = { exposures: number; errors: number }

export type DayStat = { correctKeystrokes: number; activeMs: number; sentences: number }

export type StatsData = {
  version: 1
  sessions: SessionRecord[]
  words: Record<string, WordStat>
  /** Kalit — 'YYYY-MM-DD', LOKAL vaqt bo'yicha (UTC emas, aks holda kechqurungi mashq ertangi kunga tushardi). */
  days: Record<string, DayStat>
}

type ParseResult =
  | { ok: true; data: StatsData; unknownSessions: unknown[] }
  | { ok: false; error: string }

/**
 * Diskdagi ko'rinish. `sessions` ATAYIN `unknown[]`: parser tanimagan seans
 * yozuvlari ham shu massivda saqlanib qoladi (`writeStats`), lekin ular
 * hech qachon `StatsData` ga — ya'ni ekranlarga — chiqmaydi.
 */
type StoredStats = {
  version: 1
  sessions: unknown[]
  words: Record<string, WordStat>
  days: Record<string, DayStat>
}

/** O'qish natijasi: tozalangan hujjat va parser tanimagan xom seans yozuvlari. */
type ReadResult = { data: StatsData; unknownSessions: unknown[] }

// ---------------------------------------------------------------------------
// localStorage bilan xavfsiz ishlash
// ---------------------------------------------------------------------------

/**
 * `localStorage` ga xavfsiz murojaat.
 * Node (test/SSR), cookie'lari o'chirilgan brauzer va `file://` sahifasida
 * u yo'q yoki murojaatning O'ZI `SecurityError` tashlaydi — shuning uchun
 * tekshiruv ham `try` ichida.
 */
function getStore(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function emptyStats(): StatsData {
  return { version: 1, sessions: [], words: {}, days: {} }
}

function emptyRead(): ReadResult {
  return { data: emptyStats(), unknownSessions: [] }
}

/**
 * O'qib bo'lmagan xom satrni zaxira kalitiga ko'chiradi.
 *
 * QOIDA: zaxirada ENG UZUN buzuq satr qoladi. Har safar buzilish topilganda
 * yangi satr mavjud nusxa bilan uzunligi bo'yicha solishtiriladi; qisqasi
 * tashlanadi, teng bo'lsa mavjudi o'z o'rnida qoladi.
 *
 * Uzunlik — qo'lda tiklab olish mumkin bo'lgan matn hajmining o'rnini bosuvchi
 * o'lchov. Bu ombor butun hujjatni bitta satrga yozadi, ya'ni yuzlab seansni
 * ushlab turgan kesilgan hujjat bir nechta seansli satrdan uzun bo'ladi.
 * Shuning uchun uzunini saqlash qo'lda ko'proq ma'lumot topish imkonini beradi.
 */
function backupCorrupt(store: Storage, raw: string): void {
  try {
    const existing = store.getItem(STATS_CORRUPT_KEY)
    if (existing !== null && existing.length >= raw.length) return
    store.setItem(STATS_CORRUPT_KEY, raw)
  } catch {
    // Kvota to'lgan yoki yozish taqiqlangan. Yiqilmaymiz va saqlashni ham
    // to'xtatmaymiz: zaxirasiz davom etish mashqni to'xtatishdan yaxshiroq.
  }
}

/**
 * Xom satr sifatida saqlanib qolgan buzuq payload (bo'lmasa `null`).
 * UI shu orqali "eski ma'lumot zaxirada, uni yuklab oling" xabarini
 * ko'rsatishi mumkin — bu modul ekran chizmaydi.
 */
export function corruptStatsBackup(): string | null {
  const store = getStore()
  if (store === null) return null
  try {
    return store.getItem(STATS_CORRUPT_KEY)
  } catch {
    return null
  }
}

/**
 * Zaxira nusxani o'chiradi. Foydalanuvchi uni saqlab olgandan keyin kerak:
 * aks holda buzuq satr kvotani abadiy band qilib turardi.
 */
export function discardCorruptStatsBackup(): void {
  const store = getStore()
  if (store === null) return
  try {
    store.removeItem(STATS_CORRUPT_KEY)
  } catch {
    // O'chirib bo'lmadi — yiqilmaymiz.
  }
}

function writeStats(data: StatsData, unknownSessions: unknown[]): void {
  const store = getStore()
  if (store === null) return

  // Parser tanimagan yozuvlar massiv BOSHIGA qo'yiladi. `data.sessions` eskidan
  // yangiga tartiblangan, pastdagi qisqartirish esa boshdan kesadi — demak
  // tanib bo'lmaydigan axlat birinchi bo'lib qurbon bo'ladi, eng yangi mashq
  // tarixi esa oxirigacha saqlanadi.
  const sessions: unknown[] =
    unknownSessions.length === 0 ? data.sessions : [...unknownSessions, ...data.sessions]
  const payload: StoredStats = { ...data, sessions }

  try {
    store.setItem(STATS_KEY, JSON.stringify(payload))
    return
  } catch {
    // Ehtimol kvota to'ldi — quyida eski seanslarni tashlab bir marta urinib ko'ramiz.
  }

  // Ikkinchi urinish: massiv boshidan `half` ta yozuv kesiladi, ya'ni eng yangi
  // yarmi qoladi (toq sonda — kattaroq yarmi). Kunlik va so'z yig'indilari
  // tegilmaydi — ular kichik, lekin butun tarixni ushlab turadi.
  const half = Math.floor(sessions.length / 2)
  const trimmed: StoredStats = { ...payload, sessions: sessions.slice(half) }
  try {
    store.setItem(STATS_KEY, JSON.stringify(trimmed))
  } catch {
    // Yozib bo'lmadi. Yiqilmaymiz: mashqni davom ettirish saqlashdan muhimroq.
  }
}

// ---------------------------------------------------------------------------
// O'qish va validatsiya
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Manfiy va `NaN` qiymatlar 0 ga keltiriladi — UI da hech qachon "NaN wpm" ko'rinmasin. */
function toNonNegative(value: unknown): number {
  const n = toFiniteNumber(value, 0)
  return n > 0 ? n : 0
}

function toText(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function toSentenceRecord(raw: unknown): SentenceRecord | null {
  if (!isRecord(raw)) return null
  return {
    lessonId: toText(raw['lessonId'], ''),
    sentenceIndex: Math.floor(toNonNegative(raw['sentenceIndex'])),
    at: toNonNegative(raw['at']),
    activeMs: toNonNegative(raw['activeMs']),
    keystrokes: toNonNegative(raw['keystrokes']),
    correctKeystrokes: toNonNegative(raw['correctKeystrokes']),
    netWpm: toNonNegative(raw['netWpm']),
    rawWpm: toNonNegative(raw['rawWpm']),
    accuracy: clamp01(toNonNegative(raw['accuracy'])),
    restarts: Math.floor(toNonNegative(raw['restarts'])),
    skipped: raw['skipped'] === true,
    // `=== true` EMAS: yo'q maydon `false` ga aylanmasligi kerak (yuqoridagi izoh).
    ...(typeof raw['audioEnabled'] === 'boolean' ? { audioEnabled: raw['audioEnabled'] } : {}),
  }
}

function clamp01(value: number): number {
  return value > 1 ? 1 : value
}

function toSessionRecord(raw: unknown): SessionRecord | null {
  if (!isRecord(raw)) return null

  const id = raw['id']
  if (typeof id !== 'string' || id === '') return null

  const rawSentences = raw['sentences']
  const sentences: SentenceRecord[] = []
  if (Array.isArray(rawSentences)) {
    for (const item of rawSentences) {
      const record = toSentenceRecord(item)
      if (record !== null) sentences.push(record)
    }
  }

  return {
    id,
    lessonId: toText(raw['lessonId'], ''),
    lessonTitle: toText(raw['lessonTitle'], ''),
    startedAt: toNonNegative(raw['startedAt']),
    endedAt: toNonNegative(raw['endedAt']),
    sentences,
    activeMs: toNonNegative(raw['activeMs']),
    keystrokes: toNonNegative(raw['keystrokes']),
    correctKeystrokes: toNonNegative(raw['correctKeystrokes']),
    netWpm: toNonNegative(raw['netWpm']),
    rawWpm: toNonNegative(raw['rawWpm']),
    accuracy: clamp01(toNonNegative(raw['accuracy'])),
  }
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Butun hujjatni tekshiradi va tozalaydi.
 *
 * Yuqori darajadagi shakl (version, sessions, words, days) noto'g'ri bo'lsa —
 * XATO qaytaradi va hech narsa yozilmaydi. Ichkaridagi tanib bo'lmaydigan
 * YAKKA yozuv esa hujjatga kirmaydi: bitta buzuq seans yozuvi butun yillik
 * tarixni yo'q qilmasligi kerak.
 *
 * Bunday seans yozuvlari `unknownSessions` da ALOHIDA qaytariladi va keyingi
 * `writeStats` ularni diskka qaytaradi — aks holda birinchi tugagan gap ularni
 * butunlay o'chirib yuborardi. Ular hech qachon `data.sessions` ga tushmaydi,
 * ya'ni parserning kafolati kuchsizlanmaydi.
 *
 * `words` va `days` dagi yaroqsiz kalitlar esa ATAYIN tiklanmaydi: nomi bo'sh
 * so'z, `exposures: 0` yoki 'YYYY-MM-DD' bo'lmagan kun kaliti hech qanday
 * ma'no tashimaydi — ularni saqlash tiklash emas, axlat yig'ish bo'lardi.
 */
function parseStats(raw: unknown): ParseResult {
  if (!isRecord(raw)) {
    return { ok: false, error: 'Fayl formati noto\'g\'ri: JSON obyekti kutilgan edi.' }
  }
  if (raw['version'] !== 1) {
    return { ok: false, error: 'Qo\'llab-quvvatlanmaydigan versiya: `version: 1` kutilgan edi.' }
  }

  const rawSessions = raw['sessions']
  if (!Array.isArray(rawSessions)) {
    return { ok: false, error: '`sessions` maydoni massiv bo\'lishi shart.' }
  }

  const rawWords = raw['words']
  if (!isRecord(rawWords)) {
    return { ok: false, error: '`words` maydoni obyekt bo\'lishi shart.' }
  }

  const rawDays = raw['days']
  if (!isRecord(rawDays)) {
    return { ok: false, error: '`days` maydoni obyekt bo\'lishi shart.' }
  }

  const sessions: SessionRecord[] = []
  const unknownSessions: unknown[] = []
  for (const item of rawSessions) {
    const session = toSessionRecord(item)
    if (session === null) unknownSessions.push(item)
    else sessions.push(session)
  }

  const words: Record<string, WordStat> = {}
  for (const [word, value] of Object.entries(rawWords)) {
    if (word === '' || !isRecord(value)) continue
    const exposures = Math.floor(toNonNegative(value['exposures']))
    const errors = Math.floor(toNonNegative(value['errors']))
    if (exposures === 0) continue
    words[word] = { exposures, errors: errors > exposures ? exposures : errors }
  }

  const days: Record<string, DayStat> = {}
  for (const [day, value] of Object.entries(rawDays)) {
    if (!DAY_KEY_RE.test(day) || !isRecord(value)) continue
    days[day] = {
      correctKeystrokes: Math.floor(toNonNegative(value['correctKeystrokes'])),
      activeMs: toNonNegative(value['activeMs']),
      sentences: Math.floor(toNonNegative(value['sentences'])),
    }
  }

  return { ok: true, data: { version: 1, sessions, words, days }, unknownSessions }
}

function readStats(): ReadResult {
  const store = getStore()
  if (store === null) return emptyRead()

  let raw: string | null = null
  try {
    raw = store.getItem(STATS_KEY)
  } catch {
    return emptyRead()
  }
  if (raw === null || raw === '') return emptyRead()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Buzuq JSON — bo'sh statistika bilan davom etamiz. Saqlangan satrni
    // O'CHIRMAYMIZ va, undan muhimi, uni zaxiraga taklif qilamiz: aks holda
    // keyingi `recordSession` uni ustidan yozib yuborardi.
    backupCorrupt(store, raw)
    return emptyRead()
  }

  const result = parseStats(parsed)
  if (!result.ok) {
    // JSON o'qildi, lekin hujjat shakli yaroqsiz. Oqibati bir xil — keyingi
    // yozuv uni yo'q qiladi — shuning uchun zaxira shu yerda ham taklif etiladi.
    backupCorrupt(store, raw)
    return emptyRead()
  }
  return { data: result.data, unknownSessions: result.unknownSessions }
}

/**
 * Saqlangan statistika.
 *
 * DIQQAT: bu sof o'qish emas. O'qib bo'lmaydigan payload topilsa, u
 * `dnt.stats.v1.corrupt` kalitiga YOZILISHI mumkin — `backupCorrupt` uni
 * o'sha kalitdagi nusxadan uzun bo'lsagina saqlaydi. Tiklash va'dasi shu
 * nusxaga tayanadi.
 */
export function loadStats(): StatsData {
  return readStats().data
}

export function getSession(id: string): SessionRecord | null {
  for (const session of loadStats().sessions) {
    if (session.id === id) return session
  }
  return null
}

// ---------------------------------------------------------------------------
// Kun kalitlari (LOKAL vaqt)
// ---------------------------------------------------------------------------

/**
 * 'YYYY-MM-DD' — LOKAL vaqt bo'yicha. `toISOString()` ATAYIN ishlatilmaydi:
 * u UTC beradi va Toshkentda (UTC+5) soat 05:00 gacha qilingan mashq
 * kechagi kunga tushib, seriyani noto'g'ri uzardi.
 */
function dayKeyOf(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayKeyFromMs(ms: number): string {
  return dayKeyOf(new Date(ms))
}

/**
 * Lokal yarim tundagi `Date`. Kunlarni `setDate()` bilan surish DST ga chidamli:
 * 86_400_000 ms qo'shish soat o'zgargan kunda bir kunni tashlab ketardi.
 */
function startOfLocalDay(ms: number): Date {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date
}

// ---------------------------------------------------------------------------
// Yozish
// ---------------------------------------------------------------------------

/**
 * Zaxira seans id'si — faqat `id` si buzilgan seansni tiklash uchun.
 * `crypto.randomUUID()` xavfsiz bo'lmagan kontekstda (telefondan
 * `http://192.168.x.x:5173`) mavjud emas, bu id esa faqat shu ombor ichida
 * noyob bo'lishi kifoya, shuning uchun vaqt + tasodif yetarli.
 */
function newSessionId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function wpmOf(chars: number, activeMs: number): number {
  if (activeMs <= 0) return 0
  return (chars * MS_PER_MINUTE) / (CHARS_PER_WORD * activeMs)
}

/**
 * Seans yig'indilarini gap yozuvlaridan QAYTA hisoblaydi va `skipped` gaplarni
 * chiqarib tashlaydi (PLAN §6 — bu qoida tasodifga qoldirilmaydi).
 *
 * WPM larni `activeMs` bo'yicha OG'IRLIKLI o'rtacha bilan yig'amiz. Bu oddiy
 * o'rtachadan farqli o'laroq matematik jihatdan aynan to'g'ri: netWpm_i =
 * belgilar_i / (5 * daqiqa_i) bo'lgani uchun sum(netWpm_i * ms_i) / sum(ms_i)
 * = jami belgilar / (5 * jami daqiqa). Oddiy o'rtacha esa qisqa gaplarni
 * uzunlari bilan teng og'irlikda sanab, tezlikni bo'rttirardi.
 *
 * `id` bo'sh yoki satr bo'lmasa YANGISI qo'yiladi. Aks holda seans diskka
 * yozilar, keyingi o'qishda esa parser uni tashlab ketardi: kunlik va so'z
 * yig'indilari joyida qolib, seansning o'zi yo'qolardi — `totals().sessions`
 * kunlik jadval bilan abadiy kelishmay qolardi.
 *
 * Qiymat umuman obyekt bo'lmasa `null` qaytadi va chaqiruv butunlay rad
 * etiladi: yarim yozilgan statistikadan ko'ra hech narsa yozmagan yaxshiroq.
 */
function normalizeSession(session: SessionRecord): SessionRecord | null {
  if (!isRecord(session)) return null

  const source =
    typeof session.id === 'string' && session.id !== ''
      ? session
      : { ...session, id: newSessionId() }

  const sanitized = toSessionRecord(source)
  if (sanitized === null) return null
  if (sanitized.sentences.length === 0) return sanitized

  let activeMs = 0
  let keystrokes = 0
  let correctKeystrokes = 0
  let netWeighted = 0
  let rawWeighted = 0

  for (const record of sanitized.sentences) {
    if (record.skipped) continue
    activeMs += record.activeMs
    keystrokes += record.keystrokes
    correctKeystrokes += record.correctKeystrokes
    netWeighted += record.netWpm * record.activeMs
    rawWeighted += record.rawWpm * record.activeMs
  }

  return {
    ...sanitized,
    activeMs,
    keystrokes,
    correctKeystrokes,
    netWpm: activeMs > 0 ? netWeighted / activeMs : 0,
    rawWpm: activeMs > 0 ? rawWeighted / activeMs : 0,
    accuracy: keystrokes > 0 ? clamp01(correctKeystrokes / keystrokes) : 1,
  }
}

/**
 * Tugagan seansni omborga yozadi.
 *
 * `wordDelta` — shu seansda ko'rilgan so'zlar: `{ so'z: { exposures, errors } }`.
 * Kalitlar KICHIK HARFGA keltiriladi, ya'ni `The` va `the` bitta yozuvga
 * qo'shiladi — reyting so'zning o'zi haqida, uning gap boshida turgani haqida emas.
 *
 * Kunlik yig'indi gap yozuvlarining `at` vaqtidan olinadi (yarim tunda ketayotgan
 * seans ikki kunga to'g'ri taqsimlanadi) va `skipped` gaplar hisobga OLINMAYDI.
 *
 * Seans yozib bo'lmaydigan darajada buzuq bo'lsa, HECH NARSA yozilmaydi —
 * na kunlik jadval, na so'z yig'indisi. Yarim yozuv (kunlik son o'sib, seansning
 * o'zi keyingi o'qishda yo'qolishi) jimgina va abadiy nomuvofiqlik bo'lardi.
 */
export function recordSession(session: SessionRecord, wordDelta: Record<string, WordStat>): void {
  const normalized = normalizeSession(session)
  if (normalized === null) return

  const stored = readStats()
  const data = stored.data

  data.sessions.push(normalized)
  if (data.sessions.length > MAX_SESSIONS) {
    data.sessions = data.sessions.slice(data.sessions.length - MAX_SESSIONS)
  }

  for (const [rawWord, delta] of Object.entries(wordDelta)) {
    const word = rawWord.trim().toLowerCase()
    if (word === '') continue
    const exposures = Math.floor(toNonNegative(delta.exposures))
    const errors = Math.floor(toNonNegative(delta.errors))
    if (exposures === 0 && errors === 0) continue

    const current = data.words[word] ?? { exposures: 0, errors: 0 }
    const nextExposures = current.exposures + exposures
    const nextErrors = current.errors + errors
    data.words[word] = {
      exposures: nextExposures,
      // Xatolar ta'sirlanishdan ko'p bo'lib qolmasin: aks holda `rate > 1`
      // chiqib, reyting ustunlari 100% dan oshib ketardi.
      errors: nextErrors > nextExposures ? nextExposures : nextErrors,
    }
  }

  let countedSentences = 0
  for (const record of normalized.sentences) {
    if (record.skipped) continue
    countedSentences++
    const key = dayKeyFromMs(record.at > 0 ? record.at : normalized.endedAt)
    const current = data.days[key] ?? { correctKeystrokes: 0, activeMs: 0, sentences: 0 }
    data.days[key] = {
      correctKeystrokes: current.correctKeystrokes + record.correctKeystrokes,
      activeMs: current.activeMs + record.activeMs,
      sentences: current.sentences + 1,
    }
  }

  // Gap yozuvlari umuman bo'lmasa (masalan, faqat yig'indi bilan tiklangan seans)
  // kunlik jadval baribir to'ldiriladi — aks holda seriya bo'shab qolardi.
  if (countedSentences === 0 && (normalized.activeMs > 0 || normalized.correctKeystrokes > 0)) {
    const key = dayKeyFromMs(normalized.endedAt > 0 ? normalized.endedAt : Date.now())
    const current = data.days[key] ?? { correctKeystrokes: 0, activeMs: 0, sentences: 0 }
    data.days[key] = {
      correctKeystrokes: current.correctKeystrokes + normalized.correctKeystrokes,
      activeMs: current.activeMs + normalized.activeMs,
      sentences: current.sentences,
    }
  }

  writeStats(data, stored.unknownSessions)
}

// ---------------------------------------------------------------------------
// Hisobotlar
// ---------------------------------------------------------------------------

/**
 * Eng qiyin so'zlar (PLAN §6).
 *
 * Tartiblash `errors / exposures` NISBATI bo'yicha va faqat
 * `exposures >= minExposures` bo'lgan so'zlar orasida. Xom xato soni bo'yicha
 * tartiblansa ro'yxat boshini doim `the` egallardi — u 200 marta uchraydi,
 * qiyin bo'lgani uchun emas. Bir xil nisbatda ko'proq uchragani yuqoriga
 * chiqadi (u haqida ma'lumot ishonchliroq), so'ng alifbo tartibi — natija
 * har chaqiruvda bir xil bo'lishi uchun.
 */
export function hardestWords(
  minExposures: number = DEFAULT_MIN_EXPOSURES,
  limit: number = DEFAULT_LIMIT,
): Array<{ word: string; exposures: number; errors: number; rate: number }> {
  const threshold = Math.max(1, Math.floor(toFiniteNumber(minExposures, DEFAULT_MIN_EXPOSURES)))
  const max = Math.max(0, Math.floor(toFiniteNumber(limit, DEFAULT_LIMIT)))
  if (max === 0) return []

  const rows: Array<{ word: string; exposures: number; errors: number; rate: number }> = []
  for (const [word, stat] of Object.entries(loadStats().words)) {
    if (stat.exposures < threshold) continue
    rows.push({
      word,
      exposures: stat.exposures,
      errors: stat.errors,
      rate: stat.errors / stat.exposures,
    })
  }

  rows.sort((a, b) => {
    if (b.rate !== a.rate) return b.rate - a.rate
    if (b.exposures !== a.exposures) return b.exposures - a.exposures
    return a.word < b.word ? -1 : a.word > b.word ? 1 : 0
  })

  return rows.slice(0, max)
}

/** ⭐ M2/M3 gate uchun bitta ustun: ovoz yoqiq YOKI o'chiq holatdagi yig'indi. */
export type AudioBucket = {
  sentences: number
  activeMs: number
  keystrokes: number
  correctKeystrokes: number
  netWpm: number
  rawWpm: number
  accuracy: number
}

export type AudioComparison = {
  on: AudioBucket
  off: AudioBucket
  /** Ovoz holati yozilmagan (eski) gaplar. Taqqoslashga KIRMAYDI. */
  unknown: number
}

function emptyBucket(): AudioBucket {
  return {
    sentences: 0,
    activeMs: 0,
    keystrokes: 0,
    correctKeystrokes: 0,
    netWpm: 0,
    rawWpm: 0,
    accuracy: 0,
  }
}

/**
 * ⭐ PLAN §8 dagi M2/M3 gate'ning O'LCHOV ASBOBI.
 *
 * Reja shuni talab qiladi: bir hafta kunma-kun ovoz yoqiq/o'chiq almashtirib
 * bir xil hajmda matn teriladi va WPM bilan aniqlik TAQQOSLANADI. Farq
 * bo'lmasa — audio qayta ishlanmayapti va mexanikani qayta ko'rish kerak.
 *
 * Almashtirgichning o'zi (`Practice.tsx`) boshidan bor edi, lekin ovoz holati
 * hech qayerda YOZILMAGANI uchun tajribaning natijasini o'qib bo'lmasdi —
 * ya'ni loyihaning butun pedagogik farazini tekshiradigan yagona sinov
 * o'tkazib bo'lmaydigan holatda qolgan edi.
 *
 * WPM `activeMs` bo'yicha OG'IRLANADI: qisqa gap uzun gap bilan teng vaznga
 * ega bo'lsa, bitta uch so'zlik gap butun kunlik o'rtachani tortib ketardi.
 *
 * `skipped` (Escape) gaplar chiqarib tashlanadi — ular seans yig'indisiga ham
 * kirmaydi (PLAN §6).
 */
export function audioComparison(): AudioComparison {
  const on = emptyBucket()
  const off = emptyBucket()
  let unknown = 0

  let netOn = 0
  let rawOn = 0
  let netOff = 0
  let rawOff = 0

  for (const session of loadStats().sessions) {
    for (const record of session.sentences) {
      if (record.skipped) continue
      if (record.audioEnabled === undefined) {
        unknown += 1
        continue
      }

      const bucket = record.audioEnabled ? on : off
      bucket.sentences += 1
      bucket.activeMs += record.activeMs
      bucket.keystrokes += record.keystrokes
      bucket.correctKeystrokes += record.correctKeystrokes

      if (record.audioEnabled) {
        netOn += record.netWpm * record.activeMs
        rawOn += record.rawWpm * record.activeMs
      } else {
        netOff += record.netWpm * record.activeMs
        rawOff += record.rawWpm * record.activeMs
      }
    }
  }

  on.netWpm = on.activeMs > 0 ? netOn / on.activeMs : 0
  on.rawWpm = on.activeMs > 0 ? rawOn / on.activeMs : 0
  on.accuracy = on.keystrokes > 0 ? on.correctKeystrokes / on.keystrokes : 0
  off.netWpm = off.activeMs > 0 ? netOff / off.activeMs : 0
  off.rawWpm = off.activeMs > 0 ? rawOff / off.activeMs : 0
  off.accuracy = off.keystrokes > 0 ? off.correctKeystrokes / off.keystrokes : 0

  return { on, off, unknown }
}

function qualifiesForStreak(stat: DayStat | undefined): boolean {
  return stat !== undefined && stat.correctKeystrokes >= STREAK_MIN_CORRECT
}

/**
 * Uzluksiz seriya: kuniga kamida `STREAK_MIN_CORRECT` (100) to'g'ri bosish
 * bo'lgan kunlarning ketma-ketligi, bugundan orqaga sanaladi.
 *
 * Bugun chegaraga yetmagan bo'lsa sanash KECHADAN boshlanadi — kun hali
 * tugamagan, shuning uchun tugallanmagan bugun seriyani uzmaydi. Bugun
 * chegaraga yetgan bo'lsa u ham seriyaga qo'shiladi.
 */
export function streakDays(): number {
  const days = loadStats().days
  const cursor = startOfLocalDay(Date.now())

  if (!qualifiesForStreak(days[dayKeyOf(cursor)])) {
    cursor.setDate(cursor.getDate() - 1)
  }

  let streak = 0
  while (qualifiesForStreak(days[dayKeyOf(cursor)])) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/**
 * Umumiy yig'indi. `netWpm` — barcha seanslar bo'yicha `activeMs` ga
 * og'irliklangan o'rtacha (qarang: `normalizeSession`).
 * Hech qanday bosish bo'lmasa `accuracy` 0 qaytadi: bo'sh statistika ekranida
 * "100% aniqlik" ko'rsatish chalg'ituvchi bo'lardi.
 */
export function totals(): { sessions: number; activeMs: number; netWpm: number; accuracy: number } {
  const sessions = loadStats().sessions

  let activeMs = 0
  let keystrokes = 0
  let correctKeystrokes = 0
  let netWeighted = 0

  for (const session of sessions) {
    activeMs += session.activeMs
    keystrokes += session.keystrokes
    correctKeystrokes += session.correctKeystrokes
    netWeighted += session.netWpm * session.activeMs
  }

  return {
    sessions: sessions.length,
    activeMs,
    netWpm: activeMs > 0 ? netWeighted / activeMs : 0,
    accuracy: keystrokes > 0 ? clamp01(correctKeystrokes / keystrokes) : 0,
  }
}

/** Grafik uchun eng ko'p qamrab olinadigan oraliq (~10 yil) — cheksiz sikldan himoya. */
const MAX_SERIES_DAYS = 3_660

/**
 * Oxirgi `days` kun, ESKIDAN YANGIGA tartibda; bugun doim oxirgi element.
 * Ma'lumot bo'lmagan kunlar nol bilan to'ldiriladi — grafikda bo'shliq emas,
 * tushib ketgan chiziq ko'rinishi kerak.
 *
 * Kunlik `netWpm` `DayStat` dan hisoblanadi: `correctKeystrokes / 5 / daqiqa`.
 * Bu gap bo'yicha netWpm dan biroz farq qilishi mumkin — backspace'dan keyin
 * qayta yozilgan harf to'g'ri bosish sifatida ikki marta sanaladi.
 */
export function dailySeries(days: number): Array<{ day: string; netWpm: number; correctKeystrokes: number }> {
  const requested = Math.floor(toFiniteNumber(days, 0))
  if (requested <= 0) return []
  const count = requested > MAX_SERIES_DAYS ? MAX_SERIES_DAYS : requested

  const stats = loadStats().days
  const cursor = startOfLocalDay(Date.now())
  cursor.setDate(cursor.getDate() - (count - 1))

  const series: Array<{ day: string; netWpm: number; correctKeystrokes: number }> = []
  for (let i = 0; i < count; i++) {
    const key = dayKeyOf(cursor)
    const stat = stats[key]
    series.push({
      day: key,
      netWpm: stat === undefined ? 0 : wpmOf(stat.correctKeystrokes, stat.activeMs),
      correctKeystrokes: stat === undefined ? 0 : stat.correctKeystrokes,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return series
}

// ---------------------------------------------------------------------------
// Eksport / import (PLAN §6: "~30 qator kod", M4)
// ---------------------------------------------------------------------------

/** Zaxira uchun o'qish mumkin bo'lgan JSON (2 probel chekinish). */
export function exportJson(): string {
  return JSON.stringify(loadStats(), null, 2)
}

/**
 * Zaxiradan tiklaydi: mavjud ma'lumot fayldagisi bilan TO'LIQ ALMASHTIRILADI
 * (birlashtirilmaydi — aks holda ikki marta import qilish yig'indilarni ikkilantirardi).
 *
 * Fayl noto'g'ri bo'lsa ombor umuman O'ZGARMAYDI va sabab qaytariladi:
 * yarim import qilingan statistika hech qanday statistikadan yomonroq.
 *
 * Import — ATAYIN to'liq almashtirish, shuning uchun fayldagi tanib
 * bo'lmaydigan seans yozuvlari (`unknownSessions`) saqlanmaydi: tekshiruvdan
 * o'tmagan narsani "tiklandi" deb yozib qo'yish tiklashning ma'nosini buzardi.
 */
export function importJson(raw: string): { ok: true } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Faylni JSON sifatida o\'qib bo\'lmadi.' }
  }

  const result = parseStats(parsed)
  if (!result.ok) return { ok: false, error: result.error }

  const store = getStore()
  if (store === null) {
    return { ok: false, error: 'Brauzer xotirasi mavjud emas — import qilib bo\'lmadi.' }
  }

  // Import ham buzuq payloadni yo'q qiladigan birinchi yozuv bo'lishi mumkin.
  // `loadStats` shu satrni zaxiraga taklif qiladi (qarang: `readStats`),
  // shuning uchun natijasi kerak bo'lmasa ham chaqiriladi.
  loadStats()

  try {
    store.setItem(STATS_KEY, JSON.stringify(result.data))
  } catch {
    return { ok: false, error: 'Yozib bo\'lmadi: brauzer xotirasi to\'lgan bo\'lishi mumkin.' }
  }
  return { ok: true }
}

/**
 * Butun statistikani o'chiradi. Darslar (`dnt.lessons.v1`) tegilmaydi.
 *
 * Buzuq payload zaxirasi ham o'chadi: "hammasini o'chir" degan buyruqdan keyin
 * o'sha ma'lumotning yashirin nusxasi qolib ketishi va'daga zid bo'lardi.
 */
export function clearStats(): void {
  const store = getStore()
  if (store === null) return
  try {
    store.removeItem(STATS_KEY)
  } catch {
    // O'chirib bo'lmadi — yiqilmaymiz.
  }
  discardCorruptStatsBackup()
}

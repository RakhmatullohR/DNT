// ESKI (v1) `localStorage` ombori — FAQAT O'QISH uchun (docs/stats-longterm.md §9).
//
// M3 dan boshlab ilova IndexedDB'ga yozadi (`stats.ts`). Bu fayl esa v1
// parserini SAQLAB QOLADI — §9.2 buni ochiq talab qiladi va ikkita ishlatuvchisi
// bor:
//
//   1. `statsMigrate.ts` — bir martalik `dnt.stats.v1` -> IDB ko'chirishi;
//   2. `stats.ts` dagi `importJson` — foydalanuvchining ESKI zaxira fayllari
//      (`version: 1`) hamon tiklanishi kerak.
//
// ⚠️ NEGA ALOHIDA FAYL. Parserni yangi async API bilan bitta faylda qoldirish
// ~1000 qatorli modulni IKKI XIL ombor modeli bilan to'ldirardi: sinxron
// `localStorage` hujjati va asinxron IDB tranzaksiyalari. Ular orasidagi
// chegara izohga emas, FAYL chegarasiga qo'yildi — shunda "bu funksiya qaysi
// omborga tegadi?" degan savol import satridan ko'rinadi.
//
// ⚠️ §9.2 BO'YICHA O'CHIRILGANLAR (almashuv, yaxshilanish EMAS):
//
//   - `backupCorrupt` / `corruptStatsBackup` / `discardCorruptStatsBackup` va
//     `dnt.stats.v1.corrupt` kaliti. IndexedDB'da "buzuq satr" tushunchasi YO'Q:
//     strukturaviy nusxa yo muvaffaqiyatli o'qiladi, yo baza umuman ochilmaydi —
//     ya'ni zaxiraga ko'chiriladigan xom payload mavjud emas. O'rnini
//     `persist()` + muntazam eksport bosadi. Statistika uchun tiklash UI si ham
//     o'chdi; DARSLAR uchun u JOYIDA QOLADI (`lessons.ts` boshqa qoida bilan
//     ishlaydi va uni chalkashtirmaslik kerak).
//   - `unknownSessions` mexanizmi, va u bilan birga OLDINGA MOSLIK himoyasi:
//     bugungi parser tanimagan seans yozuvini saqlab, diskka qaytarardi, ya'ni
//     yangi versiyada yozilgan yozuvni eski build O'CHIRIB YUBORMASDI.
//     IndexedDB'da bunday himoya yo'q. Yumshatish `stats.ts` da: v2 o'qish yo'li
//     qatorni BUTUNLAY saqlab qayta yozadi (`{ ...row, <ma'lum maydonlar> }`),
//     ya'ni notanish maydon yo'qolmaydi.
//
// ⚠️ v1 kaliti bu yerda O'CHIRILMAYDI (§9.3): orqaga qaytish oynasi ataylab
// ochiq. `clearV1()` faqat `clearStats()` chaqirganda ishlaydi — "hammasini
// o'chir" va'dasidan keyin yashirin nusxa qolib ketmasligi uchun.

import { SHRINKAGE_M } from '../core/wordScore.ts'
import {
  isRecord,
  toNonNegative,
  toOptionalCount,
  toOptionalDay,
  toSessionRecord,
} from './statsSchema.ts'
import type { SessionRecord } from './statsSchema.ts'

/** v1 hujjati saqlanadigan `localStorage` kaliti. */
export const STATS_V1_KEY = 'dnt.stats.v1'

/**
 * v1 dagi bitta so'zning yig'indisi.
 *
 * `exposures`/`errors` — UMRBOD hisoblagichlar. `f`/`l`/`de`/`dx` ATAYIN
 * IXTIYORIY: bu maydonlar M0+M1 da qo'shilgan, ulardan oldin yozilgan
 * qatorlarda birinchi va oxirgi kun HAQIQATAN noma'lum. Yo'q maydonni
 * migratsiya sanasi bilan to'ldirish "oxirgi marta qachon" savolini butunlay
 * yo'q qilardi (§9.1).
 */
export type WordStatV1 = {
  exposures: number
  errors: number
  /** Birinchi kun (kun raqami, LOKAL). NOMA'LUM bo'lishi mumkin — §9.1. */
  f?: number
  /** Oxirgi kun. MONOTON edi: saqlangan qiymat hech qachon kamaymagan. */
  l?: number
  /** So'nuvchi ta'sirlanish (`l` sanasidagi holat, bugungi emas — §5). */
  de?: number
  /** So'nuvchi xato (`l` sanasidagi holat). */
  dx?: number
}

export type DayStatV1 = { correctKeystrokes: number; activeMs: number; sentences: number }

export type StatsDataV1 = {
  version: 1
  sessions: SessionRecord[]
  words: Record<string, WordStatV1>
  /** Kalit — 'YYYY-MM-DD', LOKAL vaqt bo'yicha. */
  days: Record<string, DayStatV1>
  /**
   * ⭐ SO'NISH LANGARI — urug'lantirish qaysi kunda sodir bo'lganini bildiruvchi
   * HUJJAT darajasidagi kun raqami (`PLAN.md` §11.3, 4-invariant).
   *
   * ⚠️ KO'RSATILADIGAN sana va SO'NISH langari — ALOHIDA narsa. §9.1
   * `l = migratsiya sanasi` ni faqat KO'RSATISH uchun rad etgan, SO'NISH uchun
   * emas. Langarsiz `l` si yo'q qator ABADIY MUZLARDI va §1.1 dagi fossil
   * bo'lib qolaverardi. Migratsiya bu qiymatni v2 `meta[decayAnchorDay]` ga
   * ko'chiradi va u yerda AFZAL hisoblanadi (u erta qo'yilgan, ya'ni haqiqiyroq).
   */
  seedAnchorDay?: number
}

export type ParseV1Result =
  | { ok: true; data: StatsDataV1 }
  | { ok: false; error: string }

/**
 * `localStorage` ga xavfsiz murojaat.
 *
 * Node (test/SSR), cookie'lari o'chirilgan brauzer va `file://` sahifasida u
 * yo'q yoki murojaatning O'ZI `SecurityError` tashlaydi — shuning uchun
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

export function emptyStatsV1(): StatsDataV1 {
  return { version: 1, sessions: [], words: {}, days: {} }
}

/**
 * §6.5 cold-start urug'lantirish: `de`/`dx` siz kelgan qatorga umrbod
 * hisoblagichlardan boshlang'ich so'nuvchi qiymat beradi.
 *
 * `de = dx = 0` bilan boshlansa hamma so'z aynan `g` ga teng ball olardi va
 * reyting O'LIK bo'lardi. `de = min(e, m)` esa priorga teng "ishonch
 * og'irligi" beradi, `dx = x·de/e` umrbod nisbatni saqlaydi, keyingi oylarda
 * esa so'nish ularni haqiqiy ma'lumotga almashtiradi.
 *
 * `e > 0` KAFOLATLANGAN: `parseStatsV1` `exposures === 0` qatorlarini tashlaydi.
 */
export function seedDecayed(exposures: number, errors: number): { de: number; dx: number } {
  const de = exposures < SHRINKAGE_M ? exposures : SHRINKAGE_M
  return { de, dx: (errors * de) / exposures }
}

/**
 * Saqlangan `de`/`dx` juftligini hal qiladi: bittasi ham yo'q bo'lsa §6.5
 * bo'yicha URUG'LANTIRADI, ikkalasi ham bo'lsa `dx <= de` ga qisadi.
 *
 * ⚠️ YARMI yo'q qator ISHONCHSIZ deb qaraladi: `dx` `de` siz hech qanday ma'no
 * tashimaydi, ya'ni "bittasini olib, ikkinchisini urug'lantirish" ikki xil
 * davrdan kelgan sonlarni bitta juftlikka qo'shardi.
 *
 * ⭐ IKKI CHAQIRUVCHI: `parseStatsV1` (v1 hujjati) va `stats.ts` dagi
 * `toWordRow` (v2 zaxira fayli). Ilgari ayni mantiq ikkala joyda QO'LDA
 * takrorlangan edi va `toWordRow` dagi izoh buni ochiq tan olardi ("naqsh
 * `parseStatsV1` bilan AYNI"). Ikkita nusxa ikkita HAR XIL "ishonchli juftlik"
 * tushunchasi bo'lib ajralib ketishi mumkin edi, farqi esa faqat begona fayl
 * import qilinganda, bir marta, jimgina chiqardi.
 *
 * `seeded` — HUJJAT darajasidagi bayroq uchun: urug'lantirish sodir bo'lgan
 * bo'lsa so'nish langari (`decayAnchorDay`) yozilishi SHART, aks holda
 * urug'lantirilgan qatorlar hech qachon so'nmaydi (§1.1 fossili).
 */
export function resolveDecayPair(
  exposures: number,
  errors: number,
  storedDe: number | undefined,
  storedDx: number | undefined,
): { de: number; dx: number; seeded: boolean } {
  if (storedDe === undefined || storedDx === undefined) {
    return { ...seedDecayed(exposures, errors), seeded: true }
  }
  return { de: storedDe, dx: storedDx > storedDe ? storedDe : storedDx, seeded: false }
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * v1 hujjatini tekshiradi va tozalaydi.
 *
 * Yuqori darajadagi shakl (version, sessions, words, days) noto'g'ri bo'lsa —
 * XATO qaytariladi. Ichkaridagi tanib bo'lmaydigan YAKKA yozuv esa hujjatga
 * kirmaydi: bitta buzuq seans yozuvi butun yillik tarixni yo'q qilmasligi kerak.
 *
 * ⚠️ M2 gacha bunday yozuvlar `unknownSessions` da qaytarilib, keyingi yozuvda
 * diskka QAYTARILARDI. M3 da bu mexanizm o'chdi (§9.2): v1 ombori endi faqat
 * O'QILADI, ya'ni "keyingi yozuv ularni o'chirib yuboradi" degan xatarning o'zi
 * yo'q — saqlab qo'yishning ma'nosi ham qolmadi.
 *
 * `today` ARGUMENT sifatida kiradi (`wordScore.ts` bilan bir xil qoida): u
 * faqat SO'NISH LANGARINI birinchi marta qo'yish uchun kerak.
 */
export function parseStatsV1(raw: unknown, today: number): ParseV1Result {
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
  for (const item of rawSessions) {
    const session = toSessionRecord(item)
    if (session !== null) sessions.push(session)
  }

  // Diskda langar bormi. Bor bo'lsa u DOIM g'olib: u erta qo'yilgan, ya'ni
  // haqiqiyroq, va uni bugungi kun bilan almashtirish so'nishni har o'qishda
  // noldan boshlab, qatorni yana muzlatib qo'yardi.
  const storedAnchor = toOptionalDay(raw['seedAnchorDay'])
  let seeded = false

  const words: Record<string, WordStatV1> = {}
  for (const [word, value] of Object.entries(rawWords)) {
    if (word === '' || !isRecord(value)) continue
    const exposures = Math.floor(toNonNegative(value['exposures']))
    const rawErrors = Math.floor(toNonNegative(value['errors']))
    if (exposures === 0) continue
    // INVARIANT QOROVULI (`PLAN.md` §11.3, 9-invariant): manbada xato
    // TA'SIRLANISH darajasida sanaladi, ya'ni bu qisqich hech qachon
    // ishlamasligi kerak. Saqlanadi, chunki fayl BEGONA bo'lishi mumkin va
    // `rate > 1` reyting ustunlarini 100% dan oshirib yuborardi.
    const errors = rawErrors > exposures ? exposures : rawErrors

    const first = toOptionalDay(value['f'])
    const last = toOptionalDay(value['l'])
    const decay = resolveDecayPair(
      exposures,
      errors,
      toOptionalCount(value['de']),
      toOptionalCount(value['dx']),
    )
    // Bayroq QATOR bo'yicha emas, HUJJAT bo'yicha: langar bitta.
    if (decay.seeded) seeded = true

    words[word] = {
      exposures,
      errors,
      // `l`/`f` urug'lantirilMAYDI: ular noma'lum bo'lib qolishi SHART (§9.1).
      ...(first === undefined ? {} : { f: first }),
      ...(last === undefined ? {} : { l: last }),
      de: decay.de,
      dx: decay.dx,
    }
  }

  const days: Record<string, DayStatV1> = {}
  for (const [day, value] of Object.entries(rawDays)) {
    if (!DAY_KEY_RE.test(day) || !isRecord(value)) continue
    days[day] = {
      correctKeystrokes: Math.floor(toNonNegative(value['correctKeystrokes'])),
      activeMs: toNonNegative(value['activeMs']),
      sentences: Math.floor(toNonNegative(value['sentences'])),
    }
  }

  const anchor = storedAnchor ?? (seeded ? today : undefined)

  return {
    ok: true,
    data: {
      version: 1,
      sessions,
      words,
      days,
      // Langar yo'qligi ham MA'LUMOT: hech narsa urug'lantirilmagan bo'lsa
      // so'nish uchun `l` dan boshqa asos yo'q, va uni to'qib chiqarmaymiz.
      ...(anchor === undefined ? {} : { seedAnchorDay: anchor }),
    },
  }
}

/**
 * Saqlangan v1 hujjati. O'qib bo'lmasa BO'SH hujjat qaytadi va diskdagi satr
 * TEGILMAYDI — v1 ombori M3 dan keyin faqat o'qish uchun, ya'ni buzuq satrni
 * bosib ketadigan yozuv umuman yo'q.
 */
export function loadStatsV1(today: number): StatsDataV1 {
  const store = getStore()
  if (store === null) return emptyStatsV1()

  let raw: string | null = null
  try {
    raw = store.getItem(STATS_V1_KEY)
  } catch {
    return emptyStatsV1()
  }
  if (raw === null || raw === '') return emptyStatsV1()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyStatsV1()
  }

  const result = parseStatsV1(parsed, today)
  return result.ok ? result.data : emptyStatsV1()
}

/**
 * v1 kalitini o'chiradi — §9.3 va'dasi.
 *
 * `clearStats()` IDB do'konlarini bo'shatgach v1 nusxasi qolib ketsa,
 * "hammasini o'chir" buyrug'idan keyin o'sha ma'lumotning YASHIRIN nusxasi
 * saqlanib qolardi. Ustiga u keyingi boot'da qayta ko'chirilib, o'chirilgan
 * tarix TIRILARDI.
 */
export function clearV1(): void {
  const store = getStore()
  if (store === null) return
  try {
    store.removeItem(STATS_V1_KEY)
  } catch {
    // O'chirib bo'lmadi — yiqilmaymiz.
  }
}

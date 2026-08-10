// Statistika ombori — v2, IndexedDB (docs/stats-longterm.md §4, §8, §9; PLAN §6).
//
// M3: butun API ASINXRON. Sabab hajm EMAS (§2.4 buni ochiq rad etadi) —
// `localStorage` ~1.5 MB da barqaror qolardi. IndexedDB uchta boshqa narsa
// uchun olindi (§3.2):
//
//   (a) `localStorage` SINXRON va asosiy oqimni bloklaydi — har seans oxirida
//       ~2 MB JSON qayta seriyalanardi va interfeys o'sha paytda QOTARDI;
//   (b) TRANZAKSIYA — ikkita ochiq tab bir vaqtda yozganda ma'lumot yo'qolmaydi
//       (§1.2 dagi hujjatlashtirilgan nuqson);
//   (c) QISMAN YOZUV — butun hujjat emas, faqat o'zgargan qatorlar yoziladi.
//       Aynan shu HAR GAP TUGAGANDA yozishni mumkin qiladi (§8), ya'ni
//       `pagehide` da yo'qotish radiusi butun seansdan BITTA GAPGA tushadi.
//
// ⚠️ (§8.4a) BU FAYLDAGI HECH BIR `runTx` BODY SI `async` EMAS. IndexedDB
// tranzaksiyasi kutilayotgan IDB so'rovisiz hodisalar siklga qaytsa AVTOMATIK
// yopiladi: tranzaksiya ichidagi bitta `await` (hatto `await 1`) uni o'ldiradi
// va keyingi so'rov `TransactionInactiveError` bilan yiqiladi. Shuning uchun
// naqsh hamma joyda bir xil: BUTUN hisob-kitob tranzaksiyadan OLDIN sof
// funksiyalarda bajariladi, tranzaksiya ichida esa faqat `get`/`put` zanjiri
// qoladi va keyingi so'rov oldingisining `onsuccess` idan chiqariladi.
//
// ⚠️ (§9.2) OLDINGA MOSLIK HIMOYASI YO'QOLDI. v1 parseri tanimagan seans
// yozuvini saqlab, diskka qaytarardi (`unknownSessions`) — ya'ni yangi
// versiyada yozilgan yozuvni ESKI build o'chirib yubormasdi. IndexedDB'da
// bunday mexanizm yo'q. Yumshatish shu faylda va SISTEMATIK: har bir o'qi-
// o'zgartir-yoz zanjiri qatorni BUTUNLAY saqlab qayta yozadi
// (`{ ...current, <ma'lum maydonlar> }`), ya'ni notanish maydon yo'qolmaydi.
//
// v1 hujjatining PARSERI bu faylda EMAS — u `statsV1.ts` da (§9.2 uni saqlashni
// talab qiladi: migratsiya + eski zaxira fayllari). Bo'linish fayl chegarasida,
// izohda emas: shunda "bu funksiya qaysi omborga tegadi?" import satridan
// ko'rinadi.

import type { WordDelta } from '../core/session.ts'
import {
  DEFAULT_G,
  dayNumber,
  dayNumberToKey,
  decayed,
  estimateBeta,
  orderFlipG,
  shrunkScore,
  SHRINKAGE_M,
} from '../core/wordScore.ts'
import { compactSessions } from './statsCompact.ts'
import { StatsDbBlockedError, eachCursor, openDb, withStatsDb } from './statsDb.ts'
import {
  META_KEY_V1_MIGRATED_AT,
  buildMigration,
  collectLessons,
  mergeWordRows,
  migrateV1ToV2,
} from './statsMigrate.ts'
import {
  INDEX_SESSIONS_BY_ENDED_AT,
  META_KEY_DECAY_ANCHOR_DAY,
  META_KEY_LIFETIME,
  STORE_DAYS,
  STORE_META,
  STORE_SESSIONS,
  STORE_WORDS,
  WPM_SCALE,
  ACCURACY_SCALE,
  accumToBucket,
  addAccum,
  addLifetime,
  clamp01,
  dayKeyOf,
  emptyAccum,
  emptyLifetime,
  isRecord,
  netCharsOf,
  roundSentence,
  roundTo,
  sumAccum,
  toFiniteNumber,
  toNonNegative,
  toOptionalCount,
  toOptionalDay,
  toSessionRecord,
} from './statsSchema.ts'
import type {
  AudioAccum,
  AudioBucket,
  AudioComparison,
  DayRow,
  LifetimeDelta,
  LifetimeMeta,
  SentenceRecord,
  SessionEnvelope,
  SessionRecord,
  WordRow,
} from './statsSchema.ts'
import { clearV1, parseStatsV1, seedDecayed } from './statsV1.ts'

export type { AudioBucket, AudioComparison, SentenceRecord, SessionEnvelope, SessionRecord }

/**
 * Kunlik seriya (streak) chegarasi (PLAN §6): kuniga shuncha to'g'ri bosish.
 * EKSPORT qilinadi, chunki bu son UI da ham ko'rinadi (`Stats.tsx`). Nusxa
 * ko'chirilsa, chegara o'zgarganda ekran eski sonni jimgina ko'rsatib turardi.
 */
export const STREAK_MIN_CORRECT = 100

/** `hardestWords` uchun standart minimal ta'sirlanish soni (PLAN §6, §11.4). */
const DEFAULT_MIN_EXPOSURES = 5

/** `hardestWords` standart ro'yxat uzunligi. */
const DEFAULT_LIMIT = 20

/** Standart WPM ta'rifi: bitta "so'z" = 5 belgi (PLAN §6, `core/metrics.ts` bilan bir xil). */
const CHARS_PER_WORD = 5
const MS_PER_MINUTE = 60_000

/** Grafik uchun eng ko'p qamrab olinadigan oraliq (~10 yil) — cheksiz sikldan himoya. */
const MAX_SERIES_DAYS = 3_660

/**
 * Seriya sanashining QATTIQ chegarasi.
 *
 * v1 da bu kerak emas edi: `while` sikli xotiradagi obyektni o'qirdi va
 * ma'lumot tugashi bilan to'xtardi. Bu yerda esa har kun ALOHIDA IDB so'rovi
 * va ular bir-birining `onsuccess` idan chiqariladi — ya'ni to'ldirilgan
 * `days` do'koni tranzaksiyani cheksizga yaqin uzaytirishi mumkin. 10 yil
 * uzluksiz seriya real ufqdan tashqarida, lekin chegara zanjirni CHEKLI qiladi.
 */
const MAX_STREAK_DAYS = 3_660

/**
 * `1/1` va `10/50` tartibi ag'dariladigan `g` chegarasi (§6.2, `m = 20` uchun ≈0.1429).
 *
 * EKSPORT qilinadi, chunki bu son o'z-o'zini tekshirish uchun kerak: `measureG()`
 * shundan yuqori chiqsa, shrinkage formulasi bitta kuzatuvli so'zni ishonchli
 * so'zdan yuqori qo'ya boshlaydi va HECH QANDAY `m` yordam bermaydi
 * (`m → ∞` da chegara 9/49 ≈ 0.184 ga to'yinadi). Bunday holatda yagona
 * himoya — `hardestWords` dagi minimal ta'sirlanish to'sig'i.
 */
export const G_ORDER_FLIP = orderFlipG(SHRINKAGE_M)

// ---------------------------------------------------------------------------
// Ombor holati (§8.4d) — jim ishlamaslik EMAS
// ---------------------------------------------------------------------------

/**
 * Statistika ombori umuman ishlayaptimi.
 *
 * ⚠️ Uchala holat UI da HAR XIL ko'rinishi SHART (§8.4d) va shuning uchun ular
 * bitta `boolean` ga yig'ilmagan:
 *
 *   - `ready` — normal ish;
 *   - `unavailable` — brauzer IndexedDB'ni bermayapti (Firefox private rejimi,
 *     `file://`, o'chirilgan ombor). Maslahat: "bu brauzerda statistika
 *     saqlanmaydi" — foydalanuvchi qila oladigan hech narsa yo'q;
 *   - `blocked` — boshqa TAB eski sxema versiyasini ushlab turibdi (§8.4b).
 *     Maslahat butunlay boshqa: "boshqa tabni yoping". Bu VAQTINCHALIK holat.
 *
 * Ikkalasini bitta bannerga qo'shish foydalanuvchiga bajarib bo'lmaydigan yoki
 * umuman noto'g'ri maslahat berardi.
 */
export type StatsAvailability = 'ready' | 'unavailable' | 'blocked'

/**
 * Faqat ULANISHNI tekshiradi — migratsiya ham, qisqartirish ham qilmaydi.
 *
 * ⚠️ ATAYIN EKSPORT QILINMAGAN. Ekranlar shuni chaqirishga juda o'xshaydi
 * (ularga faqat banner uchun holat kerak), lekin bu POYGA yasardi: banner
 * chiqadi-yu, ekran migratsiya TUGAMASDAN o'qishni boshlardi va bo'sh
 * statistikani ko'rsatib qo'yardi. Yagona ommaviy kirish nuqtasi —
 * `initStats()`.
 */
async function statsAvailability(): Promise<StatsAvailability> {
  try {
    const db = await openDb()
    return db === null ? 'unavailable' : 'ready'
  } catch (err) {
    // (§8.4b) Bloklanish YAGONA "tuzatiladigan" nosozlik, shuning uchun u
    // "IDB yo'q" bilan ARALASHTIRILMAYDI.
    if (err instanceof StatsDbBlockedError) return 'blocked'
    return 'unavailable'
  }
}

/**
 * BOOT chaqiruvi: ulanish -> v1 migratsiyasi (§9) -> retention qisqartirishi
 * (§4.4). Tartib MUHIM: qisqartirish migratsiya ko'chirgan eski seanslarni ham
 * darrov tozalaydi, teskarisida esa 180 kundan eski yozuvlar keyingi
 * boot'gacha yotib qolardi.
 *
 * ⭐ HAR EKRAN uni yuklanishida CHAQIRADI, faqat `main.tsx` emas — va bu
 * ataylab. Ikki sabab:
 *
 *   1. POYGA. `main.tsx` migratsiyani kutmasdan render qiladi (bloklamaslik
 *      uchun). Ekran o'z ma'lumotini mustaqil o'qisa, migratsiya tugamasdan
 *      turib bo'sh omborni o'qib qolishi mumkin — foydalanuvchi butun tarixi
 *      yo'qolgandek ko'rardi. `await initStats()` bu tartibni MAJBURLAYDI.
 *   2. BANNER (§8.4d) uchun holat baribir shu yerdan keladi.
 *
 * ⚠️ Takroriy chaqiruv ARZON va XAVFSIZ: `openDb()` ulanishni keshlaydi,
 * migratsiya IDEMPOTENT (`v1MigratedAt` markeri, atomik "tekshir-va-yoz"),
 * qisqartirish esa chegaraga yetmagan birinchi qatorda TO'XTAYDI. Ya'ni
 * ko'chirilgan omborda bu ikkita mayda tranzaksiya. Memoizatsiya ATAYIN
 * qo'shilmagan: u modul darajasida holat yaratardi va uni testlar orasida
 * tozalash uchun faqat testga xizmat qiladigan API kerak bo'lardi.
 *
 * ⚠️ Migratsiya/qisqartirish XATOSI `ready` ni buzmaydi. Bu qasddan: qaytadigan
 * qiymat "ombor ISHLAYAPTIMI" degan savolga javob beradi (banner shuning uchun
 * bor), "hamma boot ishi muvaffaqiyatli tugadimi" degan savolga emas. Baza
 * ochilgan bo'lsa o'qish ham, yozuv ham ishlaydi; migratsiya esa keyingi
 * chaqiruvda qayta uriniladi.
 */
export async function initStats(now: number = Date.now()): Promise<StatsAvailability> {
  const availability = await statsAvailability()
  if (availability !== 'ready') return availability

  try {
    await migrateV1ToV2()
    await compactSessions(now)
  } catch (err) {
    if (err instanceof StatsDbBlockedError) return 'blocked'
    // Boshqa xato — yuqoridagi izoh: ombor OCHIQ, ya'ni banner kerak emas.
  }

  return 'ready'
}

// ---------------------------------------------------------------------------
// So'nish — YOZUV va O'QISH uchun BITTA manba
// ---------------------------------------------------------------------------

/**
 * Qatorning so'nuvchi hisoblagichlarini `today` kuniga keltiradi.
 *
 * ⚠️ ESKIRISH INVARIANTI (§5, `PLAN.md` §11.3, 1–2-invariant): saqlangan
 * `de`/`dx` — LANGAR sanasidagi holat, bugungi emas. Har o'qishda,
 * tartiblashdan OLDIN va har yozuvda, qo'shishdan OLDIN shu funksiya
 * qo'llanishi SHART. Qoida buzilsa reyting yiqilmaydi va xato bermaydi — u
 * JIMGINA noto'g'ri tartibda chiqadi.
 *
 * ⭐ LANGAR: `row.l ?? anchor`. `l` — qatorning O'Z oxirgi kuni; `anchor` —
 * `meta[decayAnchorDay]`, ya'ni urug'lantirish qaysi kunda bo'lgani.
 * Langarni UNUTISH `l` si yo'q qatorlarni IndexedDB'da ham ABADIY muzlatardi:
 * migratsiya `de`/`dx` ni §6.5 bo'yicha urug'lantiradi, `l` esa §9.1 bo'yicha
 * NOMA'LUM qoladi — ya'ni so'nish hech qachon boshlanmasdi va natija §1.1 dagi
 * fossilning aynan o'zi bo'lardi (M1 dagi BLOKER 1).
 *
 * Ikkalasi ham yo'q bo'lgandagina so'ndirilmaydi: o'shanda hisoblagichlar
 * qachonligi noma'lum holat bo'lib, `dt` ni taxmin qilish ma'lumot to'qish
 * bo'lardi.
 */
function decayRow(
  row: Pick<WordRow, 'de' | 'dx' | 'l'>,
  today: number,
  anchor: number | undefined,
): { de: number; dx: number } {
  const l = row.l ?? anchor
  if (l === undefined) return { de: row.de, dx: row.dx }
  return decayed({ de: row.de, dx: row.dx, l }, today)
}

/** `meta[decayAnchorDay]` xom qiymatidan kun raqami (yo'q/buzuq bo'lsa `undefined`). */
function toAnchor(raw: unknown): number | undefined {
  return toOptionalDay(raw)
}

// ---------------------------------------------------------------------------
// `meta.lifetime` — o'qish va ta'mirlash
// ---------------------------------------------------------------------------

const LIFETIME_SINCE_KEYS = ['netCharsSince', 'sessionsSince', 'keystrokesSince'] as const

/**
 * Diskdagi umrbod konvertni tozalaydi. `null` — konvert YO'Q yoki obyekt emas.
 *
 * ⚠️ F4: "meta YO'Q" ≠ "bo'sh meta". Yo'q konvert uchun `emptyLifetime()`
 * qaytarish QISMAN sonni YALANG'OCH umrbod raqam deb ko'rsatardi — §4.3 aynan
 * shu xatoning oldini olish uchun yaratilgan. Shuning uchun farq TIPDA:
 * `null` yuqoriga ko'tariladi va `totals()` ham `null` qaytaradi, UI esa
 * "noma'lum" chizadi, nol emas.
 *
 * `...raw` BIRINCHI — notanish maydonlar saqlanadi (§9.2). `*Since` lari esa
 * ALOHIDA tozalanadi: yaroqsiz qiymat spread'dan o'tib ketsa, "falon sanadan
 * beri" belgisi mavjud bo'lgan-u, o'qib bo'lmaydigan holatda qolardi.
 */
function toLifetime(raw: unknown): LifetimeMeta | null {
  if (!isRecord(raw)) return null

  const merged: Record<string, unknown> = { ...raw }
  merged['activeMs'] = toNonNegative(raw['activeMs'])
  merged['correctKeystrokes'] = toNonNegative(raw['correctKeystrokes'])
  merged['netChars'] = toNonNegative(raw['netChars'])
  merged['sessions'] = toNonNegative(raw['sessions'])
  merged['keystrokes'] = toNonNegative(raw['keystrokes'])

  for (const key of LIFETIME_SINCE_KEYS) {
    const day = toOptionalDay(raw[key])
    // Yo'q maydon ≠ nol: yaroqsizi butunlay OLIB TASHLANADI, 0 ga aylanmaydi.
    if (day === undefined) delete merged[key]
    else merged[key] = day
  }

  return merged as unknown as LifetimeMeta
}

/**
 * YOZUV yo'lidagi ta'mirlash: konvert yo'q bo'lsa nimadan boshlanadi.
 *
 * Normal ishda bu shoxga KELINMAYDI — `migrateV1ToV2()` konvertni HAR DOIM
 * yozadi (bo'sh ombor uchun ham), `clearStats()` esa uni bo'sh holatda QAYTA
 * yaratadi. Ya'ni bu yerga tushish "boot migratsiyasi umuman ishlamadi"
 * degani.
 *
 * ⚠️ Shunday holatda `*Since` uchtasi BUGUNGI kunga qo'yiladi. Sababi §4.3:
 * konvertsiz boshlangan hisob eski mashqni O'Z ICHIGA OLMAYDI, ya'ni u umrbod
 * emas, "shu kundan beri". Belgisiz qoldirish qisman sonni to'liq deb
 * ko'rsatardi — aynan §4.3 oldini olmoqchi bo'lgan xato.
 */
function lifetimeForWrite(raw: unknown, today: number): LifetimeMeta {
  const existing = toLifetime(raw)
  if (existing !== null) return existing
  return {
    ...emptyLifetime(),
    netCharsSince: today,
    sessionsSince: today,
    keystrokesSince: today,
  }
}

// ---------------------------------------------------------------------------
// §8.2 — GAP DARAJASIDAGI YOZUV SHARTNOMASI
// ---------------------------------------------------------------------------

/**
 * `writeSentences` ga uzatiladigan bitta gap: diskka tushadigan yozuv + o'sha
 * gapning SO'Z DELTASI.
 *
 * ⚠️ Delta AYNAN shu gapdan keladi (`core/session.ts` dagi `wordDeltaOf`),
 * seans davomida yig'ilgan KUMULYATIV xaritadan emas. §8.1 buni "eng jiddiy
 * amalga oshirish xatari" deb belgilaydi: kumulyativ xaritani har gapda quysa,
 * ikkinchi gapdan keyin birinchi gapning hissasi IKKINCHI marta yozilardi.
 *
 * `skipped` gapda xarita BO'SH bo'ladi — gap seans yozuviga kiradi, lekin
 * so'z/kun/umrbod hisoblagichlariga hissa QO'SHMAYDI.
 */
export type SentenceWrite = SentenceRecord & {
  words: ReadonlyMap<string, WordDelta>
}

/** Bitta kunga qo'shiladigan yig'indi — tranzaksiyadan OLDIN hisoblanadi. */
type DayDelta = {
  correctKeystrokes: number
  activeMs: number
  sentences: number
  k: number
  nc: number
  on?: AudioAccum
  off?: AudioAccum
  unknown: number
}

function emptyDayDelta(): DayDelta {
  return { correctKeystrokes: 0, activeMs: 0, sentences: 0, k: 0, nc: 0, unknown: 0 }
}

/**
 * Yoziladigan gaplardan BUTUN hisob-kitobni tranzaksiyadan OLDIN chiqaradi
 * (§8.4a). SOF.
 *
 * ⚠️ `skipped` gaplar SEANS QATORIGA kiradi (ular seans hajmini yegan va
 * Natijalar ekranida "tashlangan" sifatida sanaladi), lekin kun/so'z/umrbod
 * hisoblagichlariga UMUMAN tegmaydi — PLAN §6a qoidasi.
 *
 * `wordDay` — so'z qatorlariga qo'llanadigan kun raqami. Amalda bitta
 * chaqiruvda AYNAN BITTA yozilgan gap bo'ladi (`planSentenceWrite` faqat
 * birinchi yozilgan gap bilan buferni quyadi, undan keyin har gap yakka
 * ketadi), shuning uchun bu son bir gapning `at` idan chiqadi. Ko'p yozilgan
 * gap kelib qolsa ENG KECHGISI olinadi: `l` monoton bo'lishi shart, va
 * eskirog'ini tanlash keyingi o'qishda `dt < 0` ni yasardi.
 */
function planWrite(records: readonly SentenceWrite[]): {
  stored: SentenceRecord[]
  words: Map<string, WordDelta>
  days: Map<string, DayDelta>
  lifetime: LifetimeDelta
  wordDay: number | undefined
} {
  const stored: SentenceRecord[] = []
  const words = new Map<string, WordDelta>()
  const days = new Map<string, DayDelta>()
  let activeMs = 0
  let correctKeystrokes = 0
  let keystrokes = 0
  let netChars = 0
  let wordDay: number | undefined

  for (const item of records) {
    // `words` diskka TUSHMAYDI: u yozuv shartnomasining argumenti, saqlanadigan
    // maydon emas. Yaxlitlash ham shu yerda (§2.3) — diskdagi WPM aynan shu
    // sonlardan iborat bo'lsin.
    const { words: delta, ...record } = item
    stored.push(roundSentence(record))

    if (record.skipped) continue

    const day = dayNumber(record.at)
    wordDay = wordDay === undefined || day > wordDay ? day : wordDay

    for (const [word, contribution] of delta) {
      const key = word.trim().toLowerCase()
      if (key === '') continue
      const current = words.get(key)
      words.set(
        key,
        current === undefined
          ? { exposures: contribution.exposures, errors: contribution.errors }
          : {
              exposures: current.exposures + contribution.exposures,
              errors: current.errors + contribution.errors,
            },
      )
    }

    const dayKey = dayKeyOf(record.at)
    const bucket = days.get(dayKey) ?? emptyDayDelta()
    bucket.correctKeystrokes += record.correctKeystrokes
    bucket.activeMs += record.activeMs
    bucket.sentences += 1
    bucket.k += record.keystrokes
    bucket.nc += netCharsOf(record.netWpm, record.activeMs)
    if (record.audioEnabled === undefined) {
      // Ovoz holati NOMA'LUM. `off` ga qo'shish M2/M3 gate'ini ifloslantirardi.
      bucket.unknown += 1
    } else if (record.audioEnabled) {
      bucket.on = addAccum(bucket.on ?? emptyAccum(), record)
    } else {
      bucket.off = addAccum(bucket.off ?? emptyAccum(), record)
    }
    days.set(dayKey, bucket)

    activeMs += record.activeMs
    correctKeystrokes += record.correctKeystrokes
    keystrokes += record.keystrokes
    netChars += netCharsOf(record.netWpm, record.activeMs)
  }

  // ⭐ ZOMBI QATOR QOROVULI. `nextWordRow` xatoni ta'sirlanish soniga KESADI
  // (`min(errors, exposures)`), ya'ni sanitizatsiyadan keyingi `exposures === 0`
  // hissa AYNAN nol: `e`/`x`/`de`/`dx` va seriya o'zgarmaydi. Qolgan yagona
  // ta'siri — diskda `{e: 0}` li qator YARATISH va uning `f`/`l` ini BUGUNGA
  // qo'yish, ya'ni hech qachon terilmagan so'zni "bugun mashq qilingan" deb
  // belgilash. v1 da bunday delta diskka umuman tushmasdi; qator zararsiz
  // bo'lsa-da, u `loadOverview().wordCount` ni shishirib, eksport fayliga
  // tushardi. Sanitizatsiya `nextWordRow` dagi bilan AYNI — predikat
  // "`nextWordRow` nol delta qo'llaydi" degan ma'noni ANIQ beradi.
  for (const [key, delta] of words) {
    if (Math.floor(toNonNegative(delta.exposures)) === 0) words.delete(key)
  }

  return {
    stored,
    words,
    days,
    lifetime: { activeMs, correctKeystrokes, keystrokes, netChars },
    wordDay,
  }
}

/**
 * So'z qatorini deltaga ko'ra yangilaydi. SOF.
 *
 * ⚠️ TARTIB (§5, `PLAN.md` §11.3, 2-invariant): avval SO'NDIRISH, keyin
 * QO'SHISH. Teskarisida bugungi ta'sirlanish ham o'tmish bilan birga so'nib,
 * yangi ma'lumot to'liq og'irligini yo'qotardi.
 *
 * `f` faqat KAMAYADI, `l` faqat O'SADI (`PLAN.md` §11.3, 3-invariant): tizim
 * soati orqaga surilsa yoki mintaqa o'zgarsa yozuv buzilmasin.
 *
 * SERIYA (`s`/`b`): delta ICHIDAGI tartib saqlanmagan — `wordDeltaOf` bitta
 * gapdagi ikki ta'sirlanishni bitta juftlikka yig'adi. Shuning uchun xatolilar
 * OLDIN kelgan deb qaraladi: bu eng KONSERVATIV taxmin (seriya erta uziladi),
 * ya'ni "eng yaxshi seriya" bo'rttirilmaydi. Amalda farq faqat bir so'z bitta
 * gapda ikki marta uchraganda va faqat bir marta xato bo'lganda seziladi.
 *
 * `...base` BIRINCHI — notanish maydonlar saqlanadi (§9.2).
 */
function nextWordRow(
  current: WordRow | undefined,
  word: string,
  delta: WordDelta,
  today: number,
  anchor: number | undefined,
): WordRow {
  const base: WordRow = current ?? { w: word, e: 0, x: 0, de: 0, dx: 0, s: 0, b: 0 }

  const exposures = Math.floor(toNonNegative(delta.exposures))
  const rawErrors = Math.floor(toNonNegative(delta.errors))
  // INVARIANT QOROVULI (`PLAN.md` §11.3, 9-invariant): manbada xato
  // TA'SIRLANISH darajasida sanaladi (`wordDeltaOf` dagi `min(…, 1)`), ya'ni
  // qisqich hech qachon ishlamasligi kerak. Qisqich DELTA darajasida turadi,
  // yig'indida emas — yig'indi qisqichi TARTIBGA BOG'LIQ bo'lib qolardi.
  const errors = rawErrors > exposures ? exposures : rawErrors

  const decayedBase = decayRow(base, today, anchor)

  const e = base.e + exposures
  const x = base.x + errors
  const de = decayedBase.de + exposures
  const dx = decayedBase.dx + errors

  const clean = exposures - errors
  const s = errors > 0 ? clean : base.s + clean
  const b = base.b > s ? base.b : s

  return {
    ...base,
    w: word,
    e,
    x: x > e ? e : x,
    de,
    dx: dx > de ? de : dx,
    s,
    b,
    f: base.f === undefined ? today : Math.min(base.f, today),
    l: base.l === undefined ? today : Math.max(base.l, today),
  }
}

/**
 * Kun qatorini deltaga ko'ra yangilaydi. SOF.
 *
 * ⚠️ `k`, `nc`, `on`/`off` va `unknown` YO'Q bo'lsa NOL bilan to'ldirilmaydi
 * (`PLAN.md` §11.3, 4-invariant): migratsiyada tiklanmagan kunlar "o'lchanmagan"
 * bo'lib qolishi SHART. Shuning uchun `unknown` faqat ROSTDAN o'lchanmagan gap
 * kelganda qo'shiladi — `+ 0` ham maydonni yo'qdan bor qilardi.
 *
 * `k`/`nc` esa oldinga qarab HAR DOIM yoziladi: bugundan boshlab har gapda
 * ular bor, ya'ni "o'lchandi" degan ma'no to'g'ri.
 */
function nextDayRow(current: DayRow | undefined, key: string, delta: DayDelta): DayRow {
  const base: DayRow = current ?? { d: key, correctKeystrokes: 0, activeMs: 0, sentences: 0 }
  return {
    ...base,
    d: key,
    correctKeystrokes: base.correctKeystrokes + delta.correctKeystrokes,
    activeMs: base.activeMs + delta.activeMs,
    sentences: base.sentences + delta.sentences,
    k: (base.k ?? 0) + delta.k,
    nc: (base.nc ?? 0) + delta.nc,
    ...(delta.on === undefined ? {} : { on: sumAccum(base.on ?? emptyAccum(), delta.on) }),
    ...(delta.off === undefined ? {} : { off: sumAccum(base.off ?? emptyAccum(), delta.off) }),
    ...(delta.unknown === 0 ? {} : { unknown: (base.unknown ?? 0) + delta.unknown }),
  }
}

/**
 * ⭐ §8.2 SHARTNOMASI — gap tugaganda BITTA tranzaksiyada:
 * seans qatori + so'z DELTALARI + kun DELTALARI + `meta.lifetime` DELTALARI.
 *
 * §8.2.1 — to'rttasi ham AYNAN bir tranzaksiyada: yarim yozuv (kunlik son
 * o'sib, seansning o'zi yo'qolishi) jimgina va abadiy nomuvofiqlik bo'lardi.
 *
 * §8.2.2 — `meta.lifetime` HAR GAPDA yoziladi, seans yopilishida EMAS. Aks
 * holda §4.3 dagi bosh to'g'rilik tuzatishi aynan `pagehide` stsenariysining
 * yagona qurboni bo'lardi. `sessions` esa BIRINCHI quyilgan gapda bir marta
 * oshiriladi — "birinchi" ni ombor O'ZI aniqlaydi (seans qatori hali yo'q
 * edimi), chaqiruvchi emas: bayroq chaqiruvchida tursa, u `pagehide` bilan
 * yo'qolib, keyingi yozuv seansni IKKINCHI marta sanardi.
 *
 * §8.2.5 — buferlangan `skipped` gaplar shu yerga birinchi yozilgan gap bilan
 * BIRGA keladi (`planSentenceWrite`), ya'ni "hammasi Escape bilan tashlangan
 * seans hech narsa yozmaydi" darvozasi (PLAN §7) buzilmaydi.
 *
 * `false` — IDB yo'q (§8.4d). Chaqiruvchi buni xato deb ko'tarmaydi: banner
 * allaqachon `initStats()` natijasidan chiqadi.
 */
export async function writeSentences(
  sessionId: string,
  envelope: SessionEnvelope,
  records: readonly SentenceWrite[],
): Promise<boolean> {
  if (sessionId === '' || records.length === 0) return false

  // (§8.4a) BUTUN hisob tranzaksiyadan OLDIN.
  const plan = planWrite(records)
  const rounded = roundEnvelope(envelope)
  const today = plan.wordDay ?? dayNumber(Date.now())

  return withStatsDb(
    [STORE_WORDS, STORE_DAYS, STORE_SESSIONS, STORE_META],
    'readwrite',
    (tx) => {
      const meta = tx.objectStore(STORE_META)

      // --- Zanjir A: seans qatori -> `meta.lifetime` -------------------------
      const sessions = tx.objectStore(STORE_SESSIONS)
      const sessionReq = sessions.get(sessionId)
      sessionReq.onsuccess = () => {
        const current = sessionReq.result as SessionRecord | undefined
        const previous = Array.isArray(current?.sentences) ? current.sentences : []
        sessions.put({
          ...(current ?? {}),
          ...rounded,
          id: sessionId,
          sentences: [...previous, ...plan.stored],
        })

        // ⭐ "Birinchi gap" AYNAN shu yerdan bilinadi (yuqoridagi izoh).
        const delta: LifetimeDelta = {
          ...plan.lifetime,
          sessions: current === undefined ? 1 : 0,
        }
        const lifetimeReq = meta.get(META_KEY_LIFETIME)
        lifetimeReq.onsuccess = () => {
          meta.put(
            addLifetime(lifetimeForWrite(lifetimeReq.result, today), delta),
            META_KEY_LIFETIME,
          )
        }
      }

      // --- Zanjir B: so'nish langari -> so'z qatorlari ------------------------
      if (plan.words.size > 0) {
        const anchorReq = meta.get(META_KEY_DECAY_ANCHOR_DAY)
        anchorReq.onsuccess = () => {
          const anchor = toAnchor(anchorReq.result)
          const words = tx.objectStore(STORE_WORDS)
          for (const [word, delta] of plan.words) {
            const req = words.get(word)
            req.onsuccess = () => {
              words.put(nextWordRow(req.result as WordRow | undefined, word, delta, today, anchor))
            }
          }
        }
      }

      // --- Zanjir C: kun qatorlari -------------------------------------------
      if (plan.days.size > 0) {
        const days = tx.objectStore(STORE_DAYS)
        for (const [key, delta] of plan.days) {
          const req = days.get(key)
          req.onsuccess = () => {
            days.put(nextDayRow(req.result as DayRow | undefined, key, delta))
          }
        }
      }
    },
  )
}

/**
 * Seans konvertining suzuvchi sonlarini yaxlitlaydi (§2.3).
 *
 * Chaqiruvchi og'irlikli o'rtachani ALLAQACHON yaxlitlangan gap qiymatlaridan
 * hisoblaydi (`roundSentence` ikkala tomonda ham bir xil funksiya), shuning
 * uchun bu yerda faqat natijaning O'ZI keltiriladi: diskdagi seans WPM i
 * diskdagi gaplardan qayta hisoblanadigan bo'lib qoladi.
 */
function roundEnvelope(envelope: SessionEnvelope): SessionEnvelope {
  return {
    ...envelope,
    netWpm: roundTo(envelope.netWpm, WPM_SCALE),
    rawWpm: roundTo(envelope.rawWpm, WPM_SCALE),
    accuracy: roundTo(clamp01(envelope.accuracy), ACCURACY_SCALE),
  }
}

/**
 * §8.2.3 — seans YOPILGANDA faqat KONVERT yangilanadi: yakuniy `endedAt` va
 * `activeMs` ga og'irlangan yig'indilar.
 *
 * ⚠️ So'z, kun va umrbod hisoblagichlarga UMUMAN TEGMAYDI. Ular har gapda
 * allaqachon yozilgan; bu yerda qayta qo'shish §8.1 dagi ikki marta sanashning
 * to'g'ridan-to'g'ri o'zi bo'lardi.
 *
 * Seans qatori YO'Q bo'lsa hech narsa yozilmaydi va `false` qaytadi: qator
 * yo'qligi "bitta ham gap quyilmadi" degani, ya'ni bo'sh seans yozuvini
 * yaratish bo'sh seans darvozasini (PLAN §7) chetlab o'tardi.
 */
export async function writeSessionEnvelope(
  sessionId: string,
  envelope: SessionEnvelope,
): Promise<boolean> {
  if (sessionId === '') return false
  const rounded = roundEnvelope(envelope)

  const written = await withStatsDb<boolean>(
    [STORE_SESSIONS],
    'readwrite',
    (tx, collect) => {
      const sessions = tx.objectStore(STORE_SESSIONS)
      const req = sessions.get(sessionId)
      req.onsuccess = () => {
        const current = req.result as SessionRecord | undefined
        if (current === undefined) return
        sessions.put({ ...current, ...rounded, id: sessionId })
        collect(true)
      }
    },
    false,
  )

  return written === true
}

// ---------------------------------------------------------------------------
// O'qish — umumiy ko'rinish
// ---------------------------------------------------------------------------

/**
 * Ekranga "tarix bormi" degan savolga javob beradigan ARZON so'rov.
 *
 * ⚠️ v1 da bu javob `loadStats()` dan chiqardi, ya'ni ~2 MB hujjat butunlay
 * o'qilib, parse qilinib, keyin faqat uchta `length` uchun ishlatilardi.
 * IndexedDB'da `count()` indeks metama'lumotidan chiqadi — qatorlar umuman
 * o'qilmaydi.
 */
export type StatsOverview = {
  hasHistory: boolean
  wordCount: number
  dayCount: number
  sessionCount: number
}

export async function loadOverview(): Promise<StatsOverview> {
  const counts = await withStatsDb<[number, number, number]>(
    [STORE_WORDS, STORE_DAYS, STORE_SESSIONS],
    'readonly',
    (tx, collect) => {
      const totals: [number, number, number] = [0, 0, 0]
      let left = 3
      const take = (index: 0 | 1 | 2, req: IDBRequest<number>): void => {
        req.onsuccess = () => {
          totals[index] = req.result
          left -= 1
          // `collect` OXIRIDA: uchala so'rov ham tugaganini bilish uchun sanoq
          // kerak — IDB so'rovlarining tugash TARTIBI kafolatlanmagan.
          if (left === 0) collect(totals)
        }
      }
      take(0, tx.objectStore(STORE_WORDS).count())
      take(1, tx.objectStore(STORE_DAYS).count())
      take(2, tx.objectStore(STORE_SESSIONS).count())
    },
    [0, 0, 0],
  )

  const [wordCount, dayCount, sessionCount] = counts ?? [0, 0, 0]
  return {
    hasHistory: wordCount > 0 || dayCount > 0 || sessionCount > 0,
    wordCount,
    dayCount,
    sessionCount,
  }
}

/**
 * Umumiy yig'indi: XOM hisoblagichlar `meta.lifetime` DAN (§4.3), NISBATLAR esa
 * `days` do'konining IZCHIL OYNASIDAN (pastdagi ⭐ ga qarang).
 *
 * ⚠️ v1 da bu son `sessions` massividan chiqardi va 180 kunlik retention
 * joriy qilinishi bilan UMRBOD SEANS SANOG'I ORQAGA YURA boshlardi.
 * (`activeMs` esa bugun ham noto'g'ri edi — `MAX_SESSIONS` qisqartirishida u
 * kamayardi.)
 *
 * ⚠️ `null` — konvert YO'Q. Bu "hammasi nol" DEGANI EMAS (F4): yarim
 * migratsiya yoki yozuv xatosidan keyin nolni ko'rsatish qisman holatni
 * "umrbod hech narsa qilmagansiz" deb ko'rsatardi. UI bu ikkisini ajratadi.
 *
 * ⚠️ `*Since` maydonlari MAYDONMA-MAYDON (§4.3): `activeMs` va
 * `correctKeystrokes` `days` dan ANIQ bilinadi, `netChars`/`sessions`/
 * `keystrokes` esa faqat omon qolgan seanslardan. Ular chiqarib beriladi,
 * chunki UI o'sha maydonlarni `≥ N (sanadan)` deb chizishi SHART — aks holda
 * qisman son yalang'och umrbod raqam bo'lib ko'rinardi.
 *
 * ⭐ NISBATLAR (`netWpm`, `accuracy`) KONVERTDAN HISOBLANMAYDI — IZCHIL OYNADAN.
 *
 * ⚠️ Konvertdan hisoblash BUZUQ nisbat berardi va bu "qisqa oyna" muammosi
 * EMAS edi, balki SURAT bilan MAXRAJ har xil davrni qamrab olishi:
 *
 *     netWpm   = netChars (QISMAN) / activeMs (TO'LIQ)          -> DOIM past
 *     accuracy = correctKeystrokes (TO'LIQ) / keystrokes (QISMAN) -> DOIM yuqori
 *
 * §4.3 jadvali bo'yicha `activeMs`/`correctKeystrokes` `days` dan TO'LIQ
 * keladi, `netChars`/`keystrokes` esa faqat omon qolgan seanslardan. Uch yillik
 * omborda o'lchangan farq: haqiqiy 40.0 wpm / 96.0% o'rniga 9.13 wpm va
 * `clamp01` 4.20 dan qirqib tashlagan 100.0%. Ya'ni migratsiyagacha tarixi bor
 * HAR BIR foydalanuvchining aniqlik plitkasi "100.0%" bo'lib qolardi — v1 ga
 * nisbatan ANIQ REGRESSIYA (v1 da ikkala son ham AYNI `sessions` massividan
 * olinardi: oyna qisqa edi, lekin nisbat ichki jihatdan to'g'ri edi).
 *
 * ⭐ IZCHIL OYNA — `v1MigratedAt` MARKERIDAN KEYINGI kunlar (`d > migratsiya
 * kuni`). Nega aynan shu chegara: o'sha kunlar BUTUNLAY v2 yozuv yo'li bilan
 * yozilgan, ya'ni `activeMs`, `correctKeystrokes`, `k` va `nc` ning hammasi
 * AYNI gaplar to'plamidan chiqadi. Migratsiyadan oldingi kunlarda esa
 * `activeMs`/`correctKeystrokes` v1 `days` dan TO'LIQ, `k`/`nc` esa faqat omon
 * qolgan seanslardan — ular BITTA kun ichida ham kelishmaydi. Migratsiya
 * kunining O'ZI ham chiqariladi: u ARALASH bo'lishi mumkin.
 *
 * ⚠️ `null` — izchil oynada O'LCHOV YO'Q. Bu 0 EMAS: nol "0 wpm bilan tergan"
 * degan ma'noni berardi. Tip `number | null` — ekran uni jimgina o'tkazib
 * yubora olmaydi.
 *
 * ⚠️ `ratiosSince` FAQAT oyna butun tarixdan TOR bo'lganda qo'yiladi (ya'ni
 * migratsiya kunida yoki undan oldin ham kun qatori bo'lsa). Yo'qligi
 * "nisbatlar BUTUN tarixni qamraydi" degani.
 *
 * ⚠️ XOM hisoblagichlar (`sessions`, `activeMs`, `correctKeystrokes`,
 * `keystrokes`, `netChars`) hamon KONVERTDAN va o'zgarishsiz: ular TO'G'RI,
 * buzuq bo'lgani faqat ulardan olingan NISBAT edi. Halollik ular uchun
 * `*Since` orqali UI ga topshiriladi (§4.3).
 */
export type Totals = {
  sessions: number
  activeMs: number
  correctKeystrokes: number
  keystrokes: number
  netChars: number
  /** Izchil oynadagi net WPM. `null` — o'lchov YO'Q. */
  netWpm: number | null
  /** Izchil oynadagi aniqlik (0..1). `null` — o'lchov YO'Q. */
  accuracy: number | null
  /** Nisbatlar qaysi KUNDAN beri o'lchangan. Yo'q bo'lsa — butun tarix. */
  ratiosSince?: number
  sessionsSince?: number
  keystrokesSince?: number
  netCharsSince?: number
}

/** Izchil oynadagi to'rtta yig'indi — nisbatlarning surati va maxraji. */
type RatioWindow = {
  activeMs: number
  correctKeystrokes: number
  keystrokes: number
  netChars: number
}

/**
 * Oynadagi kun qatorlarini yig'adi.
 *
 * ⚠️ `k` yoki `nc` YO'Q kun BUTUNLAY tashlanadi, nol bilan to'ldirilmaydi
 * (`PLAN.md` §11.3, 4-invariant). Bunday qator oynaga faqat begona/qo'lda
 * tahrirlangan import fayli orqali tushishi mumkin — v2 yozuv yo'li ikkalasini
 * ham HAR DOIM yozadi. Uni qo'shish esa aynan tuzatilayotgan xatoni qaytarardi:
 * `activeMs` maxrajga tushib, `nc` surati esa tushmasdi.
 */
function foldRatioWindow(rows: readonly DayRow[]): RatioWindow {
  const window: RatioWindow = { activeMs: 0, correctKeystrokes: 0, keystrokes: 0, netChars: 0 }
  for (const row of rows) {
    if (row.k === undefined || row.nc === undefined) continue
    window.activeMs += row.activeMs
    window.correctKeystrokes += row.correctKeystrokes
    window.keystrokes += row.k
    window.netChars += row.nc
  }
  return window
}

/**
 * `meta[v1MigratedAt]` xom qiymatidan (ms tamg'asi) migratsiya KUNI.
 *
 * `undefined` — marker yo'q yoki buzuq. O'shanda oyna CHEKLANMAYDI: markersiz
 * ombor migratsiyadan umuman o'tmagan, ya'ni har bir kun qatori v2 yozuv yo'li
 * bilan yozilgan va aralashish manbaining o'zi yo'q.
 */
function toMigratedDay(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return undefined
  const day = dayNumber(raw)
  return Number.isFinite(day) ? day : undefined
}

/** `totals()` ning BITTA tranzaksiyada o'qiladigan xom holati. */
type TotalsSnapshot = {
  lifetime: LifetimeMeta
  window: RatioWindow
  ratiosSince: number | undefined
}

export async function totals(): Promise<Totals | null> {
  const snapshot = await withStatsDb<TotalsSnapshot | null>(
    [STORE_META, STORE_DAYS],
    'readonly',
    (tx, collect) => {
      const meta = tx.objectStore(STORE_META)
      const lifetimeReq = meta.get(META_KEY_LIFETIME)
      lifetimeReq.onsuccess = () => {
        const lifetime = toLifetime(lifetimeReq.result)
        // Konvert yo'q — `collect` CHAQIRILMAYDI, natija `null` bo'lib qoladi.
        if (lifetime === null) return

        const markerReq = meta.get(META_KEY_V1_MIGRATED_AT)
        markerReq.onsuccess = () => {
          const migratedDay = toMigratedDay(markerReq.result)
          const days = tx.objectStore(STORE_DAYS)

          // ⚠️ BUTUN do'kon SKANERLANMAYDI: kun kalitlari ('YYYY-MM-DD')
          // leksikografik tartibda xronologik, shuning uchun oyna kalit
          // ORALIG'I bilan olinadi va migratsiyadan oldingi (odatda eng katta)
          // qism umuman o'qilmaydi.
          const rowsReq =
            migratedDay === undefined
              ? days.getAll()
              : days.getAll(IDBKeyRange.lowerBound(dayNumberToKey(migratedDay + 1)))

          rowsReq.onsuccess = () => {
            const window = foldRatioWindow(rowsReq.result as DayRow[])
            if (migratedDay === undefined) {
              collect({ lifetime, window, ratiosSince: undefined })
              return
            }

            // `ratiosSince` FAQAT oyna TOR bo'lganda. `count()` indeks
            // metama'lumotidan chiqadi — qatorlar o'qilmaydi.
            const earlierReq = days.count(IDBKeyRange.upperBound(dayNumberToKey(migratedDay)))
            earlierReq.onsuccess = () => {
              collect({
                lifetime,
                window,
                ratiosSince: earlierReq.result > 0 ? migratedDay + 1 : undefined,
              })
            }
          }
        }
      }
    },
    null,
  )

  // Ikkala `null` ham ("IDB yo'q" va "konvert yo'q") UI uchun BIR XIL ma'noga
  // ega: umrbod sonlar NOMA'LUM. Ularni ajratish kerak bo'lsa manba
  // `statsAvailability()` da.
  if (snapshot === null || snapshot === undefined) return null

  const { lifetime, window } = snapshot
  const minutes = window.activeMs / MS_PER_MINUTE

  return {
    sessions: lifetime.sessions,
    activeMs: lifetime.activeMs,
    correctKeystrokes: lifetime.correctKeystrokes,
    keystrokes: lifetime.keystrokes,
    netChars: lifetime.netChars,
    netWpm: minutes > 0 ? window.netChars / CHARS_PER_WORD / minutes : null,
    // ⚠️ INVARIANT QOROVULI: izchil oynada `correctKeystrokes <= k` — ikkala son
    // ham AYNI gaplardan keladi, ya'ni `clamp01` endi HECH QACHON ishlamasligi
    // kerak. Saqlanadi, chunki oynaga import orqali begona qator tushishi mumkin
    // va `accuracy > 1` ekranga "120% aniqlik" bo'lib chiqardi.
    accuracy: window.keystrokes > 0 ? clamp01(window.correctKeystrokes / window.keystrokes) : null,
    ...(snapshot.ratiosSince === undefined ? {} : { ratiosSince: snapshot.ratiosSince }),
    ...(lifetime.sessionsSince === undefined ? {} : { sessionsSince: lifetime.sessionsSince }),
    ...(lifetime.keystrokesSince === undefined ? {} : { keystrokesSince: lifetime.keystrokesSince }),
    ...(lifetime.netCharsSince === undefined ? {} : { netCharsSince: lifetime.netCharsSince }),
  }
}

function qualifiesForStreak(row: DayRow | undefined): boolean {
  return row !== undefined && row.correctKeystrokes >= STREAK_MIN_CORRECT
}

/**
 * Uzluksiz seriya: kuniga kamida `STREAK_MIN_CORRECT` (100) to'g'ri bosish
 * bo'lgan kunlarning ketma-ketligi, bugundan orqaga sanaladi.
 *
 * Bugun chegaraga yetmagan bo'lsa sanash KECHADAN boshlanadi — kun hali
 * tugamagan, shuning uchun tugallanmagan bugun seriyani uzmaydi.
 *
 * ⚠️ Kunlar `Date` obyektini `setDate()` bilan surish orqali EMAS, KUN RAQAMI
 * bilan sanaladi. Ikkalasi ham DST ga chidamli, lekin kun raqami ombor kaliti
 * bilan AYNAN bir xil manbadan (`dayNumberToKey`) chiqadi — ya'ni "bugun"
 * tushunchasining ikkinchi nusxasi umuman paydo bo'lmaydi.
 *
 * (§8.4a) Har keyingi kun oldingisining `onsuccess` idan so'raladi, ya'ni
 * tranzaksiya butun yurish davomida FAOL qoladi.
 */
export async function streakDays(now: number = Date.now()): Promise<number> {
  const streak = await withStatsDb<number>(
    [STORE_DAYS],
    'readonly',
    (tx, collect) => {
      const store = tx.objectStore(STORE_DAYS)
      let day = dayNumber(now)
      let count = 0
      let first = true

      const probe = (): void => {
        const req = store.get(dayNumberToKey(day))
        req.onsuccess = () => {
          if (qualifiesForStreak(req.result as DayRow | undefined)) {
            count += 1
            collect(count)
          } else if (!first) {
            return // Seriya uzildi.
          }
          first = false
          day -= 1
          if (count < MAX_STREAK_DAYS) probe()
        }
      }

      probe()
    },
    0,
  )

  return streak ?? 0
}

// ---------------------------------------------------------------------------
// Reyting (§6)
// ---------------------------------------------------------------------------

/** `hardestWords` qaytaradigan qator. `lastDay` — kun raqami yoki NOMA'LUM (§9.1). */
export type HardWordRow = {
  word: string
  exposures: number
  errors: number
  /** UMRBOD nisbat (`errors / exposures`). Tartiblashga TA'SIR QILMAYDI — moslik uchun. */
  rate: number
  /** Empirik Bayes bali: qanchalik YUQORI bo'lsa, so'z shunchalik qiyin. */
  score: number
  lastDay: number | undefined
}

/**
 * Global so'nuvchi xato ulushi `g = Σdx / Σde` — shrinkage priorining markazi (§6.1).
 *
 * Yig'indi UMRBOD emas, SO'NUVCHI hisoblagichlar bo'yicha olinadi va ular ham
 * `today` ga keltiriladi: `g` "bugungi bazaviy daraja" degani.
 *
 * `null` — O'LCHOV YO'Q (`Σde === 0`). Zaxira qiymat bu yerda QAYTARILMAYDI:
 * chaqiruvchilar ikki xil — reyting uchun `DEFAULT_G` kerak, ekran uchun esa
 * "hali o'lchanmagan" deb aytish kerak.
 */
function globalErrorRate(
  rows: readonly WordRow[],
  today: number,
  anchor: number | undefined,
): number | null {
  let sumDe = 0
  let sumDx = 0
  for (const row of rows) {
    const decayedRow = decayRow(row, today, anchor)
    sumDe += decayedRow.de
    sumDx += decayedRow.dx
  }
  return sumDe > 0 ? sumDx / sumDe : null
}

/**
 * So'z qatorlarini reytingga aylantiradi. SOF — IDB'siz sinaladi.
 *
 * Tartiblash `score = (dx + m·g) / (de + m)` bo'yicha, ya'ni SO'NUVCHI
 * hisoblagichlardan hisoblangan, bazaviy darajaga tortilgan baho. Umrbod
 * `errors / exposures` ATAYIN tashlandi: u hech narsani unutmaydi va uch yil
 * oldin qiynalgan so'zni ro'yxat boshida abadiy ushlab turardi (§1.1).
 *
 * `minExposures` to'sig'i UMRBOD `exposures` ga qo'llanadi, so'nuvchi `de` ga
 * emas (§11.4): ~53 kundan siyrak uchraydigan so'z uchun `de` hech qachon
 * 3 dan oshmaydi (§6.4), ya'ni aynan QIYIN so'zlar ro'yxatdan tushib qolardi.
 *
 * `g` TO'SIQDAN OLDIN, butun lug'at bo'yicha hisoblanadi: u global bazaviy
 * daraja, ya'ni `minExposures` ni o'zgartirish ballarni surib yubormasligi kerak.
 */
function rankWords(
  rows: readonly WordRow[],
  today: number,
  anchor: number | undefined,
  threshold: number,
  limit: number,
): HardWordRow[] {
  const g = globalErrorRate(rows, today, anchor) ?? DEFAULT_G

  const ranked: HardWordRow[] = []
  for (const row of rows) {
    if (row.e < threshold) continue
    const decayedRow = decayRow(row, today, anchor)
    ranked.push({
      word: row.w,
      exposures: row.e,
      errors: row.x,
      rate: row.e > 0 ? row.x / row.e : 0,
      score: shrunkScore(decayedRow.dx, decayedRow.de, g),
      // ⚠️ KO'RSATILADIGAN sana — hamon `row.l` (§9.1). Langar so'nish uchun
      // ishlatiladi, lekin ekranga CHIQMAYDI: `l` si tiklanmagan so'z
      // "noma'lum (migratsiyagacha)" bo'lib qolishi shart.
      lastDay: row.l,
    })
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.exposures !== a.exposures) return b.exposures - a.exposures
    return a.word < b.word ? -1 : a.word > b.word ? 1 : 0
  })

  return ranked.slice(0, limit)
}

/**
 * Eng qiyin so'zlar (§6).
 *
 * ⚠️ FAQAT `words` do'konini skanerlaydi — `sessions` ga UMUMAN tegmaydi.
 * §4.1: so'nuvchi ballni IndexedDB indekslay olmaydi (u hisoblanadigan ifoda
 * va o'qish vaqtida o'zgaradi), shuning uchun reyting to'liq skanerdan chiqadi.
 * ~5 000 qatorda bu ~10 ms.
 *
 * `getAll()` kursordan afzal: butun jadval BITTA so'rov bilan keladi, ya'ni
 * tranzaksiya 5 000 ta `continue()` sikliga cho'zilmaydi.
 */
export async function hardestWords(
  minExposures: number = DEFAULT_MIN_EXPOSURES,
  limit: number = DEFAULT_LIMIT,
  now: number = Date.now(),
): Promise<HardWordRow[]> {
  const threshold = Math.max(1, Math.floor(toFiniteNumber(minExposures, DEFAULT_MIN_EXPOSURES)))
  const max = Math.max(0, Math.floor(toFiniteNumber(limit, DEFAULT_LIMIT)))
  if (max === 0) return []

  const today = dayNumber(now)

  const rows = await withStatsDb<HardWordRow[]>(
    [STORE_WORDS, STORE_META],
    'readonly',
    (tx, collect) => {
      const anchorReq = tx.objectStore(STORE_META).get(META_KEY_DECAY_ANCHOR_DAY)
      anchorReq.onsuccess = () => {
        const anchor = toAnchor(anchorReq.result)
        const wordsReq = tx.objectStore(STORE_WORDS).getAll()
        wordsReq.onsuccess = () => {
          collect(rankWords(wordsReq.result as WordRow[], today, anchor, threshold, max))
        }
      }
    },
    [],
  )

  return rows ?? []
}

/**
 * Bugungi `g` — SO'NUVCHI bazaviy daraja, reyting formulasining o'z-o'zini
 * tekshirish soni (§6.2).
 *
 * `null` — hali o'lchanmagan (bo'sh baza). Qorovul imzoning O'ZIDA, shuning
 * uchun ekran uni haqiqiy 0.08 o'lchovi bilan aralashtira olmaydi.
 *
 * ⚠️ Bu §12 M0 o'lchovi EMAS — buning uchun `measureLifetimeG()` bor.
 */
export async function measureG(now: number = Date.now()): Promise<number | null> {
  const today = dayNumber(now)
  const value = await withStatsDb<number | null>(
    [STORE_WORDS, STORE_META],
    'readonly',
    (tx, collect) => {
      const anchorReq = tx.objectStore(STORE_META).get(META_KEY_DECAY_ANCHOR_DAY)
      anchorReq.onsuccess = () => {
        const anchor = toAnchor(anchorReq.result)
        const wordsReq = tx.objectStore(STORE_WORDS).getAll()
        wordsReq.onsuccess = () => {
          collect(globalErrorRate(wordsReq.result as WordRow[], today, anchor))
        }
      }
    },
    null,
  )
  return value ?? null
}

/**
 * ⭐ §12 M0 O'LCHOVI: umrbod `g = Σx / Σe`.
 *
 * `measureG()` uni BERA OLMAYDI: M1 dan keyin jadval urug'langan
 * (`de = min(e, 20)`), ya'ni `measureG()` — `min(e, 20)` bilan OG'IRLANGAN
 * o'rtacha. `min` ko'p uchraydigan (va odatda eng OSON) so'zlarning og'irligini
 * kesadi, shuning uchun siljish YUQORIGA:
 *
 *     100×{e:200, x:10} + 4900×{e:3, x:1}   ->   Σx/Σe = 0.1700,  measureG() = 0.2994
 *
 * `null` — so'z jadvali bo'sh.
 */
export async function measureLifetimeG(): Promise<number | null> {
  const value = await withStatsDb<number | null>(
    [STORE_WORDS],
    'readonly',
    (tx, collect) => {
      const req = tx.objectStore(STORE_WORDS).getAll()
      req.onsuccess = () => {
        let sumE = 0
        let sumX = 0
        for (const row of req.result as WordRow[]) {
          sumE += row.e
          sumX += row.x
        }
        collect(sumE > 0 ? sumX / sumE : null)
      }
    },
    null,
  )
  return value ?? null
}

/**
 * §6.3 — `g` va `m` ni MA'LUMOTDAN baholaydi (beta-binomial momentlar usuli).
 *
 * ⚠️ Bu ko'rsatkich `SHRINKAGE_M` ni O'ZGARTIRMAYDI. Reyting hamon qo'lda
 * tanlangan `m = 20` bilan hisoblanadi; bu son faqat konstantani TEKSHIRIB
 * TURISH uchun (§6.3: "hozir sobit m = 20, keyin baholanadigan"). Ikkalasini
 * yonma-yon ko'rsatish qaror ochiq qolganini bildiradi.
 *
 * Kirish — UMRBOD hisoblagichlar (`x`/`e`), so'nuvchi emas: `estimateBeta`
 * `p_i` ni binomial ulush deb modellaydi va binomial tuzatish hadi `n_i` ni
 * (ya'ni butun ta'sirlanishlar sonini) talab qiladi. So'nuvchi `de` kasr son
 * va u "sinovlar soni" ma'nosini tashimaydi.
 *
 * `null` — baho ishonchsiz (kam qator, sof binomial tarqoqlik yoki chekka
 * o'rtacha). Bu ODATIY natija, xato emas — va aynan shu holatda son ko'rsatish
 * eng zararli bo'lardi.
 */
export async function measureBeta(): Promise<{ g: number; m: number } | null> {
  const value = await withStatsDb<{ g: number; m: number } | null>(
    [STORE_WORDS],
    'readonly',
    (tx, collect) => {
      const req = tx.objectStore(STORE_WORDS).getAll()
      req.onsuccess = () => {
        const rates: Array<{ errors: number; exposures: number }> = []
        for (const row of req.result as WordRow[]) {
          if (row.e > 0) rates.push({ errors: row.x, exposures: row.e })
        }
        collect(estimateBeta(rates))
      }
    },
    null,
  )
  return value ?? null
}

// ---------------------------------------------------------------------------
// ⭐ M2/M3 gate (PLAN §8)
// ---------------------------------------------------------------------------

/**
 * ⭐ Ovozli/ovozsiz taqqoslash — `days` do'konidagi CHELAKLARDAN.
 *
 * ⚠️ ENG MUHIM O'ZGARISH: manba `sessions` EMAS. §1.3 aynan shu nuqsonni
 * ta'riflaydi — v1 da bu funksiya faqat seans yozuvlarini o'qirdi, seanslar esa
 * `MAX_SESSIONS = 500` bilan (endi 180 kunlik retention bilan) tashlanadi. Ya'ni
 * loyihaning butun pedagogik farazini tekshiradigan YAGONA o'lchov asbobi
 * eskirish bilan JIMGINA zaiflashardi: kuniga 2 seansda 500 ta ~8 oyda to'ladi.
 *
 * `days` esa HECH QACHON qisqartirilmaydi, va kunlik chelaklar (§4.2) aynan shu
 * uchun kiritilgan — gate seanslar o'chirilgandan keyin ham to'liq yashaydi.
 *
 * `unknown` — ovoz holati yozilmagan gaplar. Ular `off` ga QO'SHILMAYDI: eski
 * tarix "ovozsiz" ustunini ifloslantirib, gate'ning ma'nosini yo'q qilardi.
 */
export async function audioComparison(): Promise<AudioComparison> {
  const folded = await withStatsDb<{ on: AudioAccum; off: AudioAccum; unknown: number }>(
    [STORE_DAYS],
    'readonly',
    (tx, collect) => {
      const req = tx.objectStore(STORE_DAYS).getAll()
      req.onsuccess = () => {
        let on = emptyAccum()
        let off = emptyAccum()
        let unknown = 0
        for (const row of req.result as DayRow[]) {
          if (row.on !== undefined) on = sumAccum(on, row.on)
          if (row.off !== undefined) off = sumAccum(off, row.off)
          unknown += row.unknown ?? 0
        }
        collect({ on, off, unknown })
      }
    },
    { on: emptyAccum(), off: emptyAccum(), unknown: 0 },
  )

  const result = folded ?? { on: emptyAccum(), off: emptyAccum(), unknown: 0 }
  return {
    on: accumToBucket(result.on),
    off: accumToBucket(result.off),
    unknown: result.unknown,
  }
}

// ---------------------------------------------------------------------------
// Kunlik trend
// ---------------------------------------------------------------------------

/**
 * Kunlik trendning bitta nuqtasi.
 *
 * ⭐ `approx` — kunlik WPM qaysi yo'l bilan chiqqani. `false` bo'lsa u `nc`
 * (net belgilar) dan hisoblangan va ANIQ; `true` bo'lsa eski taqribiy yo'l
 * ishlatilgan (`correctKeystrokes`), ya'ni backspace'dan keyin qayta yozilgan
 * harf IKKI MARTA sanalgan — PLAN §6 da ochiq tan olingan nomuvofiqlik (§4.2).
 *
 * Bayroq chaqiruvchiga CHIQARILADI, chunki `nc` faqat OLDINGA ishlaydi:
 * migratsiyada u faqat omon qolgan seanslardan tiklanadi va undan eskiroq
 * kunlar abadiy taqribiy qoladi. "Yo'q maydon ≠ nol" (`PLAN.md` §11.3,
 * 4-invariant) — UI bunday kunni "o'lchanmagan" deb ko'rsatishi kerak, jimgina
 * aniq son sifatida emas.
 *
 * Ma'lumot BUTUNLAY yo'q kun `approx: false` bo'ladi: u yerda taqribiy
 * hisoblangan narsa yo'q, shunchaki nol.
 */
export type DailyPoint = {
  day: string
  netWpm: number
  correctKeystrokes: number
  approx: boolean
}

function wpmOf(chars: number, activeMs: number): number {
  if (activeMs <= 0) return 0
  return (chars * MS_PER_MINUTE) / (CHARS_PER_WORD * activeMs)
}

/**
 * Oxirgi `days` kun, ESKIDAN YANGIGA tartibda; bugun doim oxirgi element.
 * Ma'lumot bo'lmagan kunlar nol bilan to'ldiriladi — grafikda bo'shliq emas,
 * tushib ketgan chiziq ko'rinishi kerak.
 *
 * Faqat SO'RALGAN oraliq o'qiladi (`IDBKeyRange.bound`): `days` do'koni
 * abadiy va 20 yilda ~5 000 qatorga yetadi, 14 kunlik grafik uchun esa
 * hammasini yuklash ma'nosiz.
 */
export async function dailySeries(days: number, now: number = Date.now()): Promise<DailyPoint[]> {
  const requested = Math.floor(toFiniteNumber(days, 0))
  if (requested <= 0) return []
  const count = requested > MAX_SERIES_DAYS ? MAX_SERIES_DAYS : requested

  const lastDay = dayNumber(now)
  const firstDay = lastDay - (count - 1)
  const firstKey = dayNumberToKey(firstDay)
  const lastKey = dayNumberToKey(lastDay)

  const rows = await withStatsDb<DayRow[]>(
    [STORE_DAYS],
    'readonly',
    (tx, collect) => {
      // Kun kalitlari 'YYYY-MM-DD' — LEKSIKOGRAFIK tartibi xronologik tartib
      // bilan bir xil, shuning uchun oraliq to'g'ridan-to'g'ri kalit bo'yicha
      // olinadi.
      const req = tx.objectStore(STORE_DAYS).getAll(IDBKeyRange.bound(firstKey, lastKey))
      req.onsuccess = () => collect(req.result as DayRow[])
    },
    [],
  )

  const byKey = new Map<string, DayRow>()
  for (const row of rows ?? []) byKey.set(row.d, row)

  const series: DailyPoint[] = []
  for (let day = firstDay; day <= lastDay; day++) {
    const key = dayNumberToKey(day)
    const row = byKey.get(key)
    if (row === undefined) {
      series.push({ day: key, netWpm: 0, correctKeystrokes: 0, approx: false })
      continue
    }
    // ⭐ `nc` bor kunda WPM ANIQ (§4.2): net belgilar / 5 / daqiqa.
    const exact = row.nc !== undefined
    series.push({
      day: key,
      netWpm: exact
        ? wpmOf(row.nc as number, row.activeMs)
        : wpmOf(row.correctKeystrokes, row.activeMs),
      correctKeystrokes: row.correctKeystrokes,
      approx: !exact,
    })
  }

  return series
}

// ---------------------------------------------------------------------------
// Seans yozuvlari
// ---------------------------------------------------------------------------

export async function getSession(id: string): Promise<SessionRecord | null> {
  if (id === '') return null
  const row = await withStatsDb<SessionRecord | null>(
    [STORE_SESSIONS],
    'readonly',
    (tx, collect) => {
      const req = tx.objectStore(STORE_SESSIONS).get(id)
      req.onsuccess = () => collect((req.result as SessionRecord | undefined) ?? null)
    },
    null,
  )
  return row ?? null
}

/**
 * Eng oxirgi `limit` ta seans, YANGIDAN ESKIGA.
 *
 * ⚠️ v1 da Statistika ekrani buning uchun BUTUN hujjatni yuklab, `startedAt`
 * bo'yicha saralab, 12 tasini kesib olardi. Bu yerda `by_endedAt` indeksi
 * bo'yicha TESKARI kursor kerakli sondan keyin TO'XTAYDI — ya'ni 180 kunlik
 * ombor qanchalik to'la bo'lsa ham 12 ta qator o'qiladi.
 *
 * Tartib `endedAt` bo'yicha, `startedAt` emas: indeks aynan shu maydonda
 * (§4.4). Ikkalasi bir seans ichida bir necha daqiqagacha farq qiladi, lekin
 * tartib amalda bir xil — seanslar ketma-ket bo'ladi.
 */
export async function recentSessions(limit: number): Promise<SessionRecord[]> {
  const max = Math.max(0, Math.floor(toFiniteNumber(limit, 0)))
  if (max === 0) return []

  const rows = await withStatsDb<SessionRecord[]>(
    [STORE_SESSIONS],
    'readonly',
    (tx, collect) => {
      const index = tx.objectStore(STORE_SESSIONS).index(INDEX_SESSIONS_BY_ENDED_AT)
      const found: SessionRecord[] = []
      eachCursor<SessionRecord>(index, 'prev', (row) => {
        found.push(row)
        collect(found)
        if (found.length >= max) return false
      })
    },
    [],
  )

  return rows ?? []
}

/**
 * Shu seansdan bevosita OLDINGI seans (§9.4).
 *
 * ⚠️ v1 da bu funksiya BUTUN omborni yuklab, `startedAt` bo'yicha saralab,
 * indeks qidirardi — ya'ni bitta qo'shni yozuv uchun 500 seans o'qilardi.
 * Bu yerda `by_endedAt` indeksi bo'yicha TESKARI kursor ishlatiladi va u
 * birinchi mos qatorda TO'XTAYDI: odatiy holatda (joriy seans eng yangisi)
 * bu bir yoki ikkita qadam.
 *
 * Joriy seansning O'ZI o'tkazib yuboriladi, undan YANGIROQLARI ham: kursor
 * eng yangisidan boshlanadi va joriy seans hali yozilmagan bo'lishi ham mumkin.
 */
export async function previousSession(current: SessionRecord): Promise<SessionRecord | null> {
  const row = await withStatsDb<SessionRecord | null>(
    [STORE_SESSIONS],
    'readonly',
    (tx, collect) => {
      const index = tx.objectStore(STORE_SESSIONS).index(INDEX_SESSIONS_BY_ENDED_AT)
      eachCursor<SessionRecord>(index, 'prev', (row) => {
        if (row.id === current.id) return
        if (row.endedAt > current.endedAt) return
        collect(row)
        return false
      })
    },
    null,
  )
  return row ?? null
}

// ---------------------------------------------------------------------------
// Eksport / import (§9.5)
// ---------------------------------------------------------------------------

/**
 * v2 zaxira fayli.
 *
 * `kind: 'stats'` QO'SHILDI — v1 stats eksportida u yo'q edi, darslar
 * eksportida esa bor (`lessons.ts`). Nomuvofiqlik tuzatildi: endi ikkala fayl
 * ham o'zining nima ekanini aytadi va noto'g'ri tugmaga tashlangan fayl
 * tushunarli xato beradi.
 *
 * `lifetime` konvertga KIRITILADI: usiz tiklash umrbod hisoblagichlarni nolga
 * tushirardi (yoki, battari, eskisini jimgina saqlab qolardi).
 *
 * `decayAnchorDay` ham kiritiladi. Usiz tiklangan omborda `l` si yo'q
 * qatorlar ABADIY muzlab qolardi — aynan §1.1 dagi fossil, faqat endi
 * zaxiradan tiklash tufayli.
 */
type StatsFileV2 = {
  version: 2
  kind: 'stats'
  words: WordRow[]
  days: DayRow[]
  sessions: SessionRecord[]
  lifetime: LifetimeMeta
  decayAnchorDay?: number
}

/** Zaxira uchun o'qish mumkin bo'lgan JSON (2 probel chekinish). */
export async function exportJson(): Promise<string> {
  const dump = await withStatsDb<Omit<StatsFileV2, 'version' | 'kind'>>(
    [STORE_WORDS, STORE_DAYS, STORE_SESSIONS, STORE_META],
    'readonly',
    (tx, collect) => {
      const result: Omit<StatsFileV2, 'version' | 'kind'> = {
        words: [],
        days: [],
        sessions: [],
        lifetime: emptyLifetime(),
      }
      let left = 4
      const done = (): void => {
        left -= 1
        if (left === 0) collect(result)
      }

      const wordsReq = tx.objectStore(STORE_WORDS).getAll()
      wordsReq.onsuccess = () => {
        result.words = wordsReq.result as WordRow[]
        done()
      }
      const daysReq = tx.objectStore(STORE_DAYS).getAll()
      daysReq.onsuccess = () => {
        result.days = daysReq.result as DayRow[]
        done()
      }
      const sessionsReq = tx.objectStore(STORE_SESSIONS).getAll()
      sessionsReq.onsuccess = () => {
        result.sessions = sessionsReq.result as SessionRecord[]
        done()
      }
      const meta = tx.objectStore(STORE_META)
      const lifetimeReq = meta.get(META_KEY_LIFETIME)
      lifetimeReq.onsuccess = () => {
        result.lifetime = toLifetime(lifetimeReq.result) ?? emptyLifetime()
        const anchorReq = meta.get(META_KEY_DECAY_ANCHOR_DAY)
        anchorReq.onsuccess = () => {
          const anchor = toAnchor(anchorReq.result)
          if (anchor !== undefined) result.decayAnchorDay = anchor
          done()
        }
      }
    },
    { words: [], days: [], sessions: [], lifetime: emptyLifetime() },
  )

  const body = dump ?? { words: [], days: [], sessions: [], lifetime: emptyLifetime() }
  const file: StatsFileV2 = { version: 2, kind: 'stats', ...body }
  return JSON.stringify(file, null, 2)
}

/**
 * Faylning bitta so'z qatorini tozalaydi. `null` — qator umuman yaroqsiz.
 *
 * ⭐ `seeded` — `de`/`dx` §6.5 bo'yicha UMRBOD hisoblagichlardan tiklandimi.
 * Bayroq chaqiruvchiga chiqariladi, chunki urug'lantirilgan qator SO'NISH
 * LANGARISIZ ABADIY MUZLAB qoladi (§1.1 fossili): `l` si yo'q qatorda so'nish
 * sanasi `row.l ?? meta[decayAnchorDay]` dan chiqadi va ikkalasi ham yo'q
 * bo'lsa `decayRow` qiymatlarni umuman o'zgartirmaydi.
 */
function toWordRow(raw: unknown): { row: WordRow; seeded: boolean } | null {
  if (!isRecord(raw)) return null
  const rawWord = raw['w']
  if (typeof rawWord !== 'string') return null
  // ⚠️ (§2.5) Kalit NORMALLASHTIRILADI. IndexedDB birlamchi kalitlari
  // O'ZGARMAS, ya'ni bu yerdan o'tib ketgan `"The"` keyin faqat qatorni
  // o'chirib qayta kiritish bilan tuzatilardi — amalda ABADIY qolardi.
  const word = rawWord.trim().toLowerCase()
  if (word === '') return null

  const e = Math.floor(toNonNegative(raw['e']))
  // `e === 0` li qator §6.5 ning `e > 0` invariantini buzardi.
  if (e === 0) return null
  const rawErrors = Math.floor(toNonNegative(raw['x']))
  const x = rawErrors > e ? e : rawErrors

  const storedDe = toOptionalCount(raw['de'])
  const storedDx = toOptionalCount(raw['dx'])
  // Naqsh `statsV1.ts` dagi `parseStatsV1` bilan AYNI: ikkalasi ham bo'lgandagina
  // saqlangan juftlik ishlatiladi — yarmi yo'q qator ISHONCHSIZ.
  let decay: { de: number; dx: number }
  let seeded = false
  if (storedDe === undefined || storedDx === undefined) {
    decay = seedDecayed(e, x)
    seeded = true
  } else {
    decay = { de: storedDe, dx: storedDx > storedDe ? storedDe : storedDx }
  }

  const f = toOptionalDay(raw['f'])
  const l = toOptionalDay(raw['l'])

  return {
    row: {
      // `...raw` — notanish maydonlar saqlanadi (§9.2). Ma'lumlari pastda
      // ustidan yoziladi, `f`/`l` esa yaroqsiz bo'lsa BUTUNLAY olib tashlanadi
      // (pastdagi `delete`), aks holda `by_l` indeksiga axlat tushardi.
      ...raw,
      w: word,
      e,
      x,
      de: decay.de,
      dx: decay.dx,
      s: Math.floor(toNonNegative(raw['s'])),
      b: Math.floor(toNonNegative(raw['b'])),
      ...(f === undefined ? { f: undefined } : { f }),
      ...(l === undefined ? { l: undefined } : { l }),
    } as WordRow,
    seeded,
  }
}

/** Faylning bitta kun qatorini tozalaydi. `null` — kalit 'YYYY-MM-DD' emas. */
function toDayRow(raw: unknown): DayRow | null {
  if (!isRecord(raw)) return null
  const key = raw['d']
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null

  const k = toOptionalCount(raw['k'])
  const nc = toOptionalCount(raw['nc'])
  const unknown = toOptionalCount(raw['unknown'])

  return {
    ...raw,
    d: key,
    correctKeystrokes: Math.floor(toNonNegative(raw['correctKeystrokes'])),
    activeMs: toNonNegative(raw['activeMs']),
    sentences: Math.floor(toNonNegative(raw['sentences'])),
    // ⚠️ Yo'q maydon NOL BILAN TO'LDIRILMAYDI (`PLAN.md` §11.3, 4-invariant):
    // `k`/`nc`/chelaklar faqat OLDINGA ishlaydi va ularning yo'qligi
    // "o'lchanmagan" degani.
    ...(k === undefined ? { k: undefined } : { k }),
    ...(nc === undefined ? { nc: undefined } : { nc }),
    ...(unknown === undefined ? { unknown: undefined } : { unknown }),
    ...(isRecord(raw['on']) ? { on: toAccum(raw['on']) } : { on: undefined }),
    ...(isRecord(raw['off']) ? { off: toAccum(raw['off']) } : { off: undefined }),
  } as DayRow
}

function toAccum(raw: Record<string, unknown>): AudioAccum {
  return {
    sentences: Math.floor(toNonNegative(raw['sentences'])),
    activeMs: toNonNegative(raw['activeMs']),
    keystrokes: Math.floor(toNonNegative(raw['keystrokes'])),
    correctKeystrokes: Math.floor(toNonNegative(raw['correctKeystrokes'])),
    netWeighted: toNonNegative(raw['netWeighted']),
    rawWeighted: toNonNegative(raw['rawWeighted']),
  }
}

/**
 * `undefined` qiymatli maydonlarni OLIB TASHLAYDI.
 *
 * IndexedDB `{ f: undefined }` ni saqlaydi va `'f' in row` ROST bo'lib qoladi
 * — ya'ni "yo'q maydon" va "qiymati `undefined` maydon" diskda BIR XIL
 * ko'rinmaydi, `by_l` indeksi esa ikkinchisini ham chetlab o'tmasligi mumkin.
 * Yuqoridagi tozalovchilar ixtiyoriy maydonni `undefined` bilan belgilaydi
 * (shunda `...raw` dan kelgan yaroqsiz qiymat ustidan yoziladi), bu funksiya
 * esa ularni butunlay yo'q qiladi.
 */
function dropUndefined<T extends object>(row: T): T {
  const clean: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined) clean[key] = value
  }
  return clean as T
}

/**
 * Zaxiradan tiklaydi: mavjud ma'lumot fayldagisi bilan TO'LIQ ALMASHTIRILADI
 * (birlashtirilmaydi — aks holda ikki marta import qilish yig'indilarni
 * ikkilantirardi). Bu v1 dagi qaror bilan bir xil.
 *
 * ⚠️ v1 (`version: 1`) FAYLLARI HAM QABUL QILINADI (§9.5) — foydalanuvchining
 * eski zaxiralari. Ular `buildMigration` orqali o'tadi, ya'ni import yo'li
 * boot migratsiyasi bilan AYNAN bir xil qoidalarga bo'ysunadi (kalit
 * normallashtirish, §6.5 urug'lantirish, §4.3 maydonma-maydon `lifetime`).
 * Nusxa qoida yozilsa ikkita "yaroqli v1" tushunchasi paydo bo'lardi.
 *
 * ⭐ MIGRATSIYA MARKERI QAYTA YOZILADI. Bu nozik va usiz halokatli: `meta`
 * do'konini tozalash markerni ham o'chiradi, `dnt.stats.v1` esa §9.3 bo'yicha
 * hamon diskda yotibdi — ya'ni keyingi boot v1 hujjatini IMPORT QILINGAN
 * ma'lumot USTIGA quyardi.
 */
export async function importJson(
  raw: string,
  now: number = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'Faylni JSON sifatida o\'qib bo\'lmadi.' }
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: 'Fayl formati noto\'g\'ri: JSON obyekti kutilgan edi.' }
  }

  const today = dayNumber(now)
  let payload: StatsFileV2

  if (parsed['version'] === 2) {
    if (parsed['kind'] !== undefined && parsed['kind'] !== 'stats') {
      return { ok: false, error: 'Bu fayl statistika zaxirasi emas.' }
    }
    const built = buildV2Payload(parsed, today)
    if (!built.ok) return built
    payload = built.file
  } else if (parsed['version'] === 1) {
    const result = parseStatsV1(parsed, today)
    if (!result.ok) return { ok: false, error: result.error }
    const plan = buildMigration(result.data, collectLessons(result.data.sessions))
    payload = {
      version: 2,
      kind: 'stats',
      words: plan.words,
      days: plan.days,
      sessions: plan.sessions,
      lifetime: plan.lifetime,
      ...(plan.seedAnchorDay === undefined ? {} : { decayAnchorDay: plan.seedAnchorDay }),
    }
  } else {
    return {
      ok: false,
      error: 'Qo\'llab-quvvatlanmaydigan versiya: `version: 1` yoki `version: 2` kutilgan edi.',
    }
  }

  const written = await withStatsDb(
    [STORE_WORDS, STORE_DAYS, STORE_SESSIONS, STORE_META],
    'readwrite',
    (tx) => {
      const words = tx.objectStore(STORE_WORDS)
      const days = tx.objectStore(STORE_DAYS)
      const sessions = tx.objectStore(STORE_SESSIONS)
      const meta = tx.objectStore(STORE_META)

      // ⭐ §9.5 — UMRBOD KONVERT ALMASHTIRILMAYDI, BIRLASHTIRILADI.
      //
      // Ma'lumot (`words`/`days`/`sessions`) uchun semantika ALMASHTIRISH:
      // yig'indilarni qo'shish ikki marta sanashga olib kelardi. Lekin umrbod
      // hisoblagichlar MONOTON — ular "kamida shuncha" degan ma'noni tashiydi
      // va HECH QACHON kamaymasligi kerak (§4.3). Eski zaxirani tiklash ularni
      // orqaga surib yuborardi, ya'ni §4.3 aynan oldini olish uchun yozilgan
      // "umrbod raqam orqaga yuradi" nuqsoni import orqali qaytardi.
      //
      // Shuning uchun avval mavjud konvert O'QILADI va `max()` bilan
      // birlashtiriladi. O'qish `onsuccess` zanjirida — tranzaksiya faol
      // qoladi (§8.4a).
      const currentReq = meta.get(META_KEY_LIFETIME)
      currentReq.onsuccess = () => {
        const merged = mergeLifetimeOnImport(
          toLifetime(currentReq.result),
          payload.lifetime,
        )

        // ALMASHTIRISH: ma'lumot tozalanadi. Tranzaksiya atomik, ya'ni
        // "tozalandi-yu yozilmadi" holati diskka CHIQMAYDI.
        words.clear()
        days.clear()
        sessions.clear()
        meta.clear()

        for (const row of payload.words) words.put(row)
        for (const row of payload.days) days.put(row)
        for (const row of payload.sessions) sessions.put(row)

        meta.put(merged, META_KEY_LIFETIME)
        finishMeta(meta)
      }
    },
  )

  if (!written) {
    return { ok: false, error: 'Statistika ombori mavjud emas — import qilib bo\'lmadi.' }
  }
  return { ok: true }

  /** Konvertdan keyingi qolgan `meta` kalitlari — zanjirni bir joyda tugatish uchun. */
  function finishMeta(meta: IDBObjectStore): void {
    if (payload.decayAnchorDay !== undefined) {
      meta.put(payload.decayAnchorDay, META_KEY_DECAY_ANCHOR_DAY)
    }
    // ⭐ Markersiz keyingi boot v1 ni ustidan quyardi.
    meta.put(now, META_KEY_V1_MIGRATED_AT)
  }
}

/**
 * §9.5 — importda umrbod konvertni birlashtiradi.
 *
 * Hisoblagichlar `max()` bilan: ular MONOTON va "kamida shuncha" degan ma'noni
 * tashiydi, ya'ni eski zaxirani tiklash ularni orqaga surmasligi kerak.
 *
 * `*Since` esa boshqacha ishlaydi va uni ham `max()` qilish XATO bo'lardi.
 * `*Since` — "bu son FAQAT shu kundan beri aniq bilinadi" degan belgi, ya'ni
 * KICHIKROQ sana ko'proq bilimni bildiradi. Va maydonning UMUMAN yo'qligi
 * "to'liq bilinadi" degani — u har qanday sanadan kuchliroq. Shuning uchun:
 * biror tomonda belgi yo'q bo'lsa natijada ham yo'q, aks holda MINIMUM.
 *
 * `current === null` (konvert hali yo'q) bo'lsa fayldagisi shundayligicha
 * olinadi — birlashtiradigan narsa yo'q.
 */
function mergeLifetimeOnImport(
  current: LifetimeMeta | null,
  incoming: LifetimeMeta,
): LifetimeMeta {
  if (current === null) return incoming

  const pickSince = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined || b === undefined ? undefined : Math.min(a, b)

  const netCharsSince = pickSince(current.netCharsSince, incoming.netCharsSince)
  const sessionsSince = pickSince(current.sessionsSince, incoming.sessionsSince)
  const keystrokesSince = pickSince(current.keystrokesSince, incoming.keystrokesSince)

  return {
    activeMs: Math.max(current.activeMs, incoming.activeMs),
    correctKeystrokes: Math.max(current.correctKeystrokes, incoming.correctKeystrokes),
    netChars: Math.max(current.netChars, incoming.netChars),
    sessions: Math.max(current.sessions, incoming.sessions),
    keystrokes: Math.max(current.keystrokes, incoming.keystrokes),
    ...(netCharsSince === undefined ? {} : { netCharsSince }),
    ...(sessionsSince === undefined ? {} : { sessionsSince }),
    ...(keystrokesSince === undefined ? {} : { keystrokesSince }),
  }
}

/**
 * v2 faylining uchala massivini tekshiradi va yozishga tayyorlaydi.
 *
 * `today` FAQAT so'nish langarining ZAXIRASI uchun kerak — pastdagi ⭐ ga qarang.
 */
function buildV2Payload(
  parsed: Record<string, unknown>,
  today: number,
): { ok: true; file: StatsFileV2 } | { ok: false; error: string } {
  const rawWords = parsed['words']
  const rawDays = parsed['days']
  const rawSessions = parsed['sessions']
  if (!Array.isArray(rawWords) || !Array.isArray(rawDays) || !Array.isArray(rawSessions)) {
    return { ok: false, error: '`words`, `days` va `sessions` massiv bo\'lishi shart.' }
  }

  // Kalit normallashtirilgandan keyin TO'QNASHGAN qatorlar birlashtiriladi
  // (§2.5) — migratsiyadagi AYNI qoida bilan: `"The"` va `"the"` bir so'zning
  // ikkita yarim tarixi va birini tashlash ta'sirlanishlarni yo'qotardi.
  const words = new Map<string, WordRow>()
  let seeded = false
  for (const item of rawWords) {
    const parsedRow = toWordRow(item)
    if (parsedRow === null) continue
    if (parsedRow.seeded) seeded = true
    const clean = dropUndefined(parsedRow.row)
    const existing = words.get(clean.w)
    words.set(clean.w, existing === undefined ? clean : mergeWordRows(existing, clean))
  }

  const days: DayRow[] = []
  for (const item of rawDays) {
    const row = toDayRow(item)
    if (row !== null) days.push(dropUndefined(row))
  }

  const sessions: SessionRecord[] = []
  for (const item of rawSessions) {
    const row = toSessionRecord(item)
    if (row !== null) sessions.push(row)
  }

  const lifetime = toLifetime(parsed['lifetime'])
  // ⭐ SO'NISH LANGARINING ZAXIRASI (§1.1 fossilining oldini olish).
  //
  // Fayldagi langar DOIM afzal: u urug'lantirish SODIR BO'LGAN kunda qo'yilgan,
  // ya'ni haqiqiyroq va odatda ancha erta. Yo'q bo'lsa-yu, shu import
  // urug'lantirish qilgan bo'lsa — langar BUGUNGI kun bilan yoziladi.
  //
  // ⚠️ Usiz: `l` ham, `de`/`dx` ham, `decayAnchorDay` ham yo'q fayl
  // urug'lantirilgan, LEKIN hech qachon so'nmaydigan qatorlarni yaratardi
  // (`decayRow` da `row.l ?? anchor` ikkalasi ham `undefined`) — ya'ni §1.1
  // fossili aynan import orqali qaytardi. v1 yo'li bundan himoyalangan
  // (`parseStatsV1`: `storedAnchor ?? (seeded ? today : undefined)`), v2 yo'lida
  // esa ekvivalent zaxira YO'Q edi. Qoida shu bilan IKKALA yo'lda bir xil.
  const anchor = toAnchor(parsed['decayAnchorDay']) ?? (seeded ? today : undefined)

  return {
    ok: true,
    file: {
      version: 2,
      kind: 'stats',
      words: [...words.values()],
      days,
      sessions,
      // Konvert yo'q fayl — bu eski yoki qo'lda yasalgan zaxira. Bo'sh konvert
      // shu yerda TO'G'RI: hamma qator fayldan keladi, ya'ni hisob noldan
      // boshlanadi va "qisman" emas.
      lifetime: lifetime ?? emptyLifetime(),
      ...(anchor === undefined ? {} : { decayAnchorDay: anchor }),
    },
  }
}

/**
 * Butun statistikani o'chiradi. Darslar (`dnt.lessons.v1`) tegilmaydi.
 *
 * ⭐ v1 kaliti HAM o'chiriladi (§9.3): "hammasini o'chir" degan buyruqdan keyin
 * o'sha ma'lumotning yashirin nusxasi qolib ketishi va'daga zid bo'lardi.
 * Ustiga u keyingi boot'da qayta ko'chirilib, o'chirilgan tarix TIRILARDI.
 *
 * ⭐ `meta.lifetime` BO'SH holatda QAYTA YOZILADI, shunchaki o'chirilmaydi.
 * Farqi muhim: konvertsiz omborga yozilgan keyingi gap `lifetimeForWrite` ning
 * ta'mirlash shoxiga tushib, hamma sonni "bugundan beri" deb belgilardi —
 * holbuki tozalangan omborda ular ROSTDAN noldan va ANIQ.
 */
export async function clearStats(now: number = Date.now()): Promise<void> {
  await withStatsDb(
    [STORE_WORDS, STORE_DAYS, STORE_SESSIONS, STORE_META],
    'readwrite',
    (tx) => {
      tx.objectStore(STORE_WORDS).clear()
      tx.objectStore(STORE_DAYS).clear()
      tx.objectStore(STORE_SESSIONS).clear()
      const meta = tx.objectStore(STORE_META)
      meta.clear()
      meta.put(emptyLifetime(), META_KEY_LIFETIME)
      // Marker: v1 kaliti pastda o'chiriladi, lekin markersiz keyingi boot
      // bo'sh v1 hujjatini qayta "ko'chirib", bekorga ish qilardi.
      meta.put(now, META_KEY_V1_MIGRATED_AT)
    },
  )

  clearV1()
}

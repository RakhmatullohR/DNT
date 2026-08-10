// `dnt-stats` IndexedDB sxemasi: do'kon nomlari, qator tiplari va SOF
// yordamchilar (docs/stats-longterm.md §4).
//
// Bu fayl IndexedDB API'siga UMUMAN tegmaydi — u faqat "diskda nima yotadi"ni
// tasvirlaydi va yig'uvchilar ustidagi arifmetikani beradi. Shuning uchun
// bu yerdagi har bir funksiya `node` muhitida, hech qanday mock'siz sinaladi —
// `src/core/wordScore.ts` bilan bir xil bo'linish. IDB'ning o'zi (ulanish,
// tranzaksiya, kursor) qo'shni `statsDb.ts` da.
//
// Kun kaliti mantiqini bu yer QAYTA YOZMAYDI: `dayNumber`/`dayNumberToKey`
// allaqachon `wordScore.ts` da, DST va mintaqa ofseti bo'yicha sinalgan holda
// mavjud. Ikkinchi nusxa ikkita HAR XIL "bugun" tushunchasini yaratardi.

import { dayNumber, dayNumberToKey } from '../core/wordScore.ts'

/** Ma'lumotlar bazasi nomi (§4). Bitta baza — to'rtta do'kon. */
export const DB_NAME = 'dnt-stats'

/**
 * Sxema versiyasi. Har qanday do'kon yoki indeks o'zgarishi bu sonni oshirishni
 * TALAB qiladi: `createObjectStore` faqat `onupgradeneeded` ichida ishlaydi
 * (§8.4c), u esa faqat versiya o'sganda chaqiriladi.
 */
export const DB_VERSION = 1

export const STORE_WORDS = 'words'
export const STORE_DAYS = 'days'
export const STORE_SESSIONS = 'sessions'
export const STORE_META = 'meta'

/** `words.l` (oxirgi kun) bo'yicha indeks — "yaqinda mashq qilinganlar" ro'yxati uchun. */
export const INDEX_WORDS_BY_L = 'by_l'

/** `sessions.endedAt` bo'yicha indeks — TESKARI kursor bilan oxirgi seansni topish uchun (§9.4). */
export const INDEX_SESSIONS_BY_ENDED_AT = 'by_endedAt'

/**
 * `meta` do'konining yagona kaliti. `meta` da `keyPath` YO'Q (out-of-line):
 * qiymat — bu erkin shakldagi konvert, unga sun'iy `id` maydonini qo'shish
 * faqat shovqin bo'lardi.
 */
export const META_KEY_LIFETIME = 'lifetime'

/**
 * ⭐ SO'NISH LANGARI — `l` si YO'Q qatorlar qaysi kundan boshlab so'nishini
 * belgilovchi kun raqami (`PLAN.md` §11.3, 4-invariant).
 *
 * ⚠️ KO'RSATILADIGAN sana va SO'NISH langari — ALOHIDA narsa. §9.1 `l` ni
 * migratsiya sanasi bilan to'ldirishni rad etadi va bu KUCHDA qoladi: `l` si
 * tiklanmagan so'z ekranda "noma'lum (migratsiyagacha)" bo'lib qolaveradi.
 * Lekin SO'NISH uchun langar SHART — usiz o'sha so'zlarning urug'lantirilgan
 * `de`/`dx` i abadiy muzlab, ular aynan §1.1 dagi fossil bo'lib qolardi.
 *
 * O'qish yo'lidagi qoida: `so'nish sanasi = row.l ?? meta[decayAnchorDay]`.
 * Bu maydon `by_l` indeksiga ta'sir qilmaydi — `l` si yo'q qator unga
 * baribir tushmaydi.
 */
export const META_KEY_DECAY_ANCHOR_DAY = 'decayAnchorDay'

/**
 * `words` do'koni qatori (§4.1), BIRLAMCHI KALIT — `w`.
 *
 * `keyPath: 'w'` ATAYIN tanlangan (avtoinkrement `id` emas): so'zning kichik
 * harfli yuza shakli tabiiy va barqaror kalit, ya'ni har o'qishda qidiruv
 * indekssiz, to'g'ridan-to'g'ri `get(word)` bilan bajariladi.
 *
 * `e`/`x` — umrbod hisoblagichlar ("nechi marta yozilgan", "nechi marta xato").
 * `de`/`dx` — o'sha ikkalasining so'nuvchi (90 kunlik yarim yemirilish) nusxasi;
 * ular so'z bo'yicha CHEGARASIZ tarix massivini sobit ikkita songa siqadi (§4.1).
 * `s`/`b` — joriy va eng yaxshi toza seriya.
 */
export type WordRow = {
  /** Kichik harfli yuza shakl — BIRLAMCHI KALIT. */
  w: string
  /** Umrbod ta'sirlanish. */
  e: number
  /** Umrbod xato. */
  x: number
  /** So'nuvchi ta'sirlanish (yarim yemirilish 90 kun). */
  de: number
  /** So'nuvchi xato. */
  dx: number
  /** Joriy toza seriya — ketma-ket xatosiz ta'sirlanish. */
  s: number
  /** Eng yaxshi seriya. */
  b: number
  /**
   * Birinchi kun (kun raqami, LOKAL). IXTIYORIY, ATAYIN.
   *
   * ⚠️ §9.1: migratsiyada tiklab bo'lmagan so'z uchun bu maydon QO'YILMAYDI.
   * `f = migratsiya kuni` deb yozish ~3–9 ming so'zga bir xil soxta sanani
   * berardi, va `f` — kech qo'yilgan minimum bo'lgani uchun — `l` dan farqli
   * o'laroq keyingi ta'sirlanishda HECH QACHON o'zini tuzatmasdi.
   * Yo'q maydon "noma'lum (migratsiyagacha)" degani, nol yoki bugun EMAS.
   */
  f?: number
  /**
   * Oxirgi kun (kun raqami, LOKAL). IXTIYORIY, `f` bilan bir xil sababdan.
   *
   * MONOTON yoziladi: `l = max(oldingi, bugun)` — tizim soati orqaga ketsa yoki
   * mintaqa o'zgarsa yozuv buzilmasin (§4.1).
   *
   * `by_l` indeksi aynan shu maydon ustida: `l` si yo'q qatorlar indeksga
   * UMUMAN TUSHMAYDI, ya'ni "yaqinda mashq qilinganlar" ro'yxati noma'lum
   * sanali so'zlarni soxta joyga qo'ymaydi.
   */
  l?: number
}

/**
 * Ovoz holati bo'yicha bitta chelakning YIG'UVCHILARI (§4.2).
 *
 * ⚠️ IKKITA SON BILAN CHELAK YASAB BO'LMAYDI. Ekranga chiziladigan
 * `AudioBucket` yetti maydonli, lekin uning uchtasi (`netWpm`, `rawWpm`,
 * `accuracy`) — O'RTACHA, ya'ni ularni kundan kunga qo'shib bo'lmaydi.
 * Shuning uchun diskda chelak boshiga aynan OLTITA additiv yig'uvchi yotadi
 * va qolgan uchtasi o'qish paytida `accumToBucket` da CHIQARILADI.
 * `netWeighted`/`rawWeighted` — `activeMs` ga og'irlangan yig'indi: shundagina
 * uzun gap qisqasidan ko'proq hissa qo'shadi.
 */
export type AudioAccum = {
  sentences: number
  activeMs: number
  keystrokes: number
  correctKeystrokes: number
  /** Σ(`netWpm` · `activeMs`) — og'irlikli o'rtacha uchun surat. */
  netWeighted: number
  /** Σ(`rawWpm` · `activeMs`) — og'irlikli o'rtacha uchun surat. */
  rawWeighted: number
}

/**
 * Chelakning ko'rsatiladigan shakli — `accumToBucket` natijasi.
 *
 * ⚠️ M2 davomida bu tip `stats.ts` da IKKINCHI marta takrorlangan edi (M2
 * qatlami eski `localStorage` moduliga bog'lanmasligi uchun). M3 da o'sha
 * nusxa O'CHIRILDI va ta'rif AYNAN SHU YERDA yagona bo'lib qoldi: chelakni
 * hosil qiladigan arifmetika (`addAccum`/`accumToBucket`) ham shu faylda,
 * ya'ni tip va uni yasaydigan qoida bir joyda turadi.
 */
export type AudioBucket = {
  sentences: number
  activeMs: number
  keystrokes: number
  correctKeystrokes: number
  netWpm: number
  rawWpm: number
  accuracy: number
}

/**
 * `days` do'koni qatori (§4.2), BIRLAMCHI KALIT — `d`, `'YYYY-MM-DD'` LOKAL.
 *
 * `days` HECH QACHON qisqartirilmaydi — aynan shu sabab uni umrbod
 * `activeMs`/`correctKeystrokes` uchun YAGONA aniq manbaga aylantiradi (§4.3).
 */
export type DayRow = {
  /** `'YYYY-MM-DD'` LOKAL — BIRLAMCHI KALIT (`dayKeyOf` bilan yasaladi). */
  d: string
  correctKeystrokes: number
  activeMs: number
  sentences: number
  /**
   * Jami bosishlar — kunlik ANIQLIKNI (`correctKeystrokes / k`) abadiy
   * hisoblash uchun. Bugun bu son faqat seans yozuvida bor va seans
   * qisqartirilganda u bilan birga YO'QOLADI.
   */
  k?: number
  /**
   * Net belgilar. §4.2: PLAN §6 da OCHIQ TAN OLINGAN kunlik trend
   * nomuvofiqligini tuzatadi — kunlik chiziq `correctKeystrokes` dan
   * chizilgani uchun backspace'dan keyin qayta yozilgan harf IKKI MARTA
   * sanaladi. `netCharsOf(netWpm, activeMs)` bilan gap yozuvidan hosil qilinadi.
   */
  nc?: number
  /** Ovoz YOQIQ holatdagi yig'uvchilar. */
  on?: AudioAccum
  /** Ovoz O'CHIQ holatdagi yig'uvchilar. */
  off?: AudioAccum
  /** Ovoz holati yozilmagan (eski) gaplar soni — taqqoslashga KIRMAYDI. */
  unknown?: number
}

/*
 * ⚠️ `k`, `nc`, `on`/`off` va `unknown` ATAYIN IXTIYORIY (§4.2 oxiri).
 * Ular faqat OLDINGA ishlaydi: migratsiyada ularni faqat omon qolgan ≤500
 * seansdan tiklash mumkin, undan eskiroq kunlar esa hozirgi taqribiy trendda
 * ABADIY qoladi. Demak YO'Q MAYDON ≠ NOL — o'qiyotgan kod ularni nolga
 * to'ldirmasligi, balki "o'lchanmagan" deb ko'rsatishi shart.
 */

/**
 * `meta.lifetime` — umrbod hisoblagichlar (§4.3).
 *
 * ⚠️ `since` MAYDONMA-MAYDON, bitta umumiy sana EMAS. §4.3 jadvali:
 *
 * | Maydon                          | Manbasi                          | `since`                   |
 * |---------------------------------|----------------------------------|---------------------------|
 * | `activeMs`, `correctKeystrokes` | `days` dan ANIQ                  | yo'q — haqiqiy umrbod     |
 * | `netChars`                      | omon qolgan seanslardan HOSIL     | eng eski omon qolgan seans|
 * | `sessions`, `keystrokes`        | faqat QISMAN                     | eng eski omon qolgan seans|
 *
 * Uchala guruh HAR XIL `since` ga ega. Bitta umumiy sana qo'yish aynan shu
 * jadval oldini olishi kerak bo'lgan xatoni yasardi: aniq bilinadigan
 * `activeMs` ni ham "falon sanadan beri" deb pastga tushirardi, yoki qisman
 * bilinadigan `sessions` ni yalang'och umrbod raqam sifatida ko'rsatardi.
 * `*Since` si bor maydonlar UI da `≥ N (sanadan)` deb chiziladi.
 */
export type LifetimeMeta = {
  /** `days` dan ANIQ — `since` YO'Q. */
  activeMs: number
  /** `days` dan ANIQ — `since` YO'Q. */
  correctKeystrokes: number
  /** Omon qolgan seanslardan HOSIL QILINGAN. */
  netChars: number
  /** `netChars` qaysi kundan boshlab bilinadi (kun raqami). Yo'q bo'lsa — to'liq. */
  netCharsSince?: number
  /** Faqat QISMAN — omon qolgan seanslardan. */
  sessions: number
  /** `sessions` qaysi kundan boshlab bilinadi (kun raqami). */
  sessionsSince?: number
  /** Faqat QISMAN — omon qolgan seanslardan. */
  keystrokes: number
  /** `keystrokes` qaysi kundan boshlab bilinadi (kun raqami). */
  keystrokesSince?: number
}

/** `meta.lifetime` ga qo'shiladigan delta (§8.2: har gapda yoziladi). */
export type LifetimeDelta = {
  activeMs?: number
  correctKeystrokes?: number
  netChars?: number
  sessions?: number
  keystrokes?: number
}

/** Millisekund tamg'asidan `days` kalitini yasaydi: LOKAL kun -> `'YYYY-MM-DD'`. */
export function dayKeyOf(ms: number): string {
  return dayNumberToKey(dayNumber(ms))
}

/** Bo'sh chelak — kun qatorida `on`/`off` birinchi marta paydo bo'lganda. */
export function emptyAccum(): AudioAccum {
  return {
    sentences: 0,
    activeMs: 0,
    keystrokes: 0,
    correctKeystrokes: 0,
    netWeighted: 0,
    rawWeighted: 0,
  }
}

/**
 * Bitta gapning yakunini chelakka qo'shadi. SOF: kirish obyektlari
 * o'zgartirilmaydi, YANGI chelak qaytariladi.
 *
 * Tezliklar `activeMs` ga OG'IRLANIB yig'iladi (`netWpm * activeMs`), chunki
 * o'rtachalarning o'rtachasi noto'g'ri: 5 sekundlik gap 5 daqiqalik gap bilan
 * teng ovoz berardi.
 */
export function addAccum(
  acc: AudioAccum,
  s: {
    activeMs: number
    keystrokes: number
    correctKeystrokes: number
    netWpm: number
    rawWpm: number
  },
): AudioAccum {
  return {
    sentences: acc.sentences + 1,
    activeMs: acc.activeMs + s.activeMs,
    keystrokes: acc.keystrokes + s.keystrokes,
    correctKeystrokes: acc.correctKeystrokes + s.correctKeystrokes,
    netWeighted: acc.netWeighted + s.netWpm * s.activeMs,
    rawWeighted: acc.rawWeighted + s.rawWpm * s.activeMs,
  }
}

/**
 * Ikkita CHELAKNI qo'shadi. SOF.
 *
 * ⚠️ `addAccum` bilan almashtirib bo'lmaydi: u BITTA GAPNI qo'shadi va
 * `sentences` ni doim 1 ga oshiradi. Chelakni chelakka qo'shish uchun har olti
 * yig'uvchi maydonma-maydon qo'shilishi kerak.
 *
 * ⚠️ Bu funksiya M3 da `stats.ts` dan SHU YERGA ko'chdi, chunki endi uni IKKI
 * tomon chaqiradi: `stats.ts` (`audioComparison`, kun qatorini yangilash) va
 * `statsMigrate.ts` (migratsiya rejasini diskdagi qator bilan BIRLASHTIRISH).
 * Nusxa ko'chirilsa ikkita HAR XIL "chelaklarni qo'shish" qoidasi paydo
 * bo'lardi va farq faqat migratsiya kunida, bir marta, jimgina chiqardi.
 */
export function sumAccum(a: AudioAccum, b: AudioAccum): AudioAccum {
  return {
    sentences: a.sentences + b.sentences,
    activeMs: a.activeMs + b.activeMs,
    keystrokes: a.keystrokes + b.keystrokes,
    correctKeystrokes: a.correctKeystrokes + b.correctKeystrokes,
    netWeighted: a.netWeighted + b.netWeighted,
    rawWeighted: a.rawWeighted + b.rawWeighted,
  }
}

/**
 * Oltita yig'uvchidan yettita maydonli ko'rsatish shaklini chiqaradi.
 *
 * Bo'luvchi nol bo'lsa natija 0: bo'sh chelakda `0/0 = NaN` chiqardi va u
 * ekranga `NaN wpm` bo'lib tushardi. 0 bu yerda "o'lchanmagan" degani —
 * chelakning o'zi yo'qligi bilan farqlanadi (`DayRow.on` ixtiyoriy).
 */
export function accumToBucket(acc: AudioAccum): AudioBucket {
  return {
    sentences: acc.sentences,
    activeMs: acc.activeMs,
    keystrokes: acc.keystrokes,
    correctKeystrokes: acc.correctKeystrokes,
    netWpm: acc.activeMs > 0 ? acc.netWeighted / acc.activeMs : 0,
    rawWpm: acc.activeMs > 0 ? acc.rawWeighted / acc.activeMs : 0,
    accuracy: acc.keystrokes > 0 ? acc.correctKeystrokes / acc.keystrokes : 0,
  }
}

/**
 * Gapning net belgilari: `netWpm · daqiqalar · 5` (§4.2, `DayRow.nc`).
 *
 * "So'z" — terish o'lchovida 5 belgi, shuning uchun WPM'dan belgiga qaytish
 * 5 ga ko'paytirish demak. Bu son `correctKeystrokes` dan MUSTAQIL: backspace
 * bilan tuzatilgan harf `netWpm` da allaqachon hisobga olingan.
 */
export function netCharsOf(netWpm: number, activeMs: number): number {
  return (netWpm * activeMs) / 60_000 * 5
}

/**
 * Bo'sh umrbod konvert. `*Since` maydonlari QO'YILMAYDI — bo'sh bazada
 * hech narsa "falon sanadan beri" emas, hammasi noldan aniq bilinadi.
 */
export function emptyLifetime(): LifetimeMeta {
  return {
    activeMs: 0,
    correctKeystrokes: 0,
    netChars: 0,
    sessions: 0,
    keystrokes: 0,
  }
}

/**
 * Umrbod hisoblagichlarga deltani qo'shadi. SOF: yangi obyekt qaytariladi.
 *
 * ⚠️ `*Since` maydonlari deltadan O'ZGARMAYDI: ular migratsiyada BIR MARTA
 * qo'yiladi va "bu maydon qaysi sanadan beri to'liq bilinadi" degan o'zgarmas
 * faktni bildiradi. Yangi yozuv eski bilimsizlikni to'ldirmaydi.
 *
 * `...meta` BIRINCHI: konvertda bu fayl bilmaydigan maydon bo'lsa (eski yoki
 * YANGI build yozgan), u yo'qolmasdan diskka qaytadi — §9.2 dagi oldinga
 * moslik yumshatishi (`unknownSessions` o'chgandan keyin qolgan yagona himoya).
 */
export function addLifetime(meta: LifetimeMeta, delta: LifetimeDelta): LifetimeMeta {
  return {
    ...meta,
    activeMs: meta.activeMs + (delta.activeMs ?? 0),
    correctKeystrokes: meta.correctKeystrokes + (delta.correctKeystrokes ?? 0),
    netChars: meta.netChars + (delta.netChars ?? 0),
    sessions: meta.sessions + (delta.sessions ?? 0),
    keystrokes: meta.keystrokes + (delta.keystrokes ?? 0),
  }
}

// ---------------------------------------------------------------------------
// `sessions` do'konidagi yozuvlar — M3 da YAGONA ta'rif
// ---------------------------------------------------------------------------

/*
 * ⚠️ Bu ikki tip M2 gacha `stats.ts` da (ya'ni `localStorage` modulida) yashagan
 * edi va §9.2 ularni "M3 da bitta ta'rifga birlashtiriladi" deb belgilagan.
 * Ular AYNAN shu yerga ko'chirildi, `stats.ts` ga qaytarilmadi, chunki:
 *
 *   - `sessions` do'koni ularni AYNAN shu shaklda saqlaydi (`keyPath: 'id'`),
 *     ya'ni bu "diskda nima yotadi" savolining javobi — shu faylning mavzusi;
 *   - `statsV1.ts` (eski parser) va `stats.ts` (v2 API) IKKALASI ham shu tipni
 *     talab qiladi. Ularning biriga qo'yilsa, ikkinchisi eski `localStorage`
 *     moduliga bog'lanib qolardi — aynan M2 da qochilgan bog'lanish.
 */

/**
 * Bitta terilgan gapning yozuvi.
 *
 * `lessonId` ATAYIN YO'Q (§2.3): u `SessionRecord.lessonId` da allaqachon bor
 * va gap darajasida takrorlanishi bitta yozuvga ~30 B qo'shardi. Eski
 * yozuvlardagi maydon o'qishda JIMGINA tashlanadi — tarix buzilmaydi.
 */
export type SentenceRecord = {
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

/** `sessions` do'koni qatori, BIRLAMCHI KALIT — `id`; `by_endedAt` indeksi §9.4 uchun. */
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

/**
 * Seans qatorining GAPLARSIZ qismi — `writeSentences`/`writeSessionEnvelope`
 * uzatadigan "konvert" (§8.2.3).
 *
 * ATAYIN `Omit<SessionRecord, 'id' | 'sentences'>`: `id` seans BOSHIDA
 * ajratiladi va chaqiruv argumenti sifatida alohida keladi (§8.2.4), gaplar
 * esa omborda YIG'ILADI — konvertga qo'shilsa har yozuvda butun ro'yxat qayta
 * uzatilardi va "qisman yozuv" ning butun ma'nosi yo'qolardi (§3.2c).
 */
export type SessionEnvelope = Omit<SessionRecord, 'id' | 'sentences'>

/** ⭐ M2/M3 gate natijasi: ovoz yoqiq/o'chiq ustunlari va o'lchanmagan gaplar soni. */
export type AudioComparison = {
  on: AudioBucket
  off: AudioBucket
  /** Ovoz holati yozilmagan (eski) gaplar. Taqqoslashga KIRMAYDI. */
  unknown: number
}

// ---------------------------------------------------------------------------
// Ishonchsiz kirishni tekshirish
// ---------------------------------------------------------------------------

/*
 * Bu yordamchilar IKKI chaqiruvchiga xizmat qiladi: `statsV1.ts` (eski
 * `localStorage` hujjati) va `stats.ts` dagi `importJson` (foydalanuvchi
 * tanlagan begona fayl). Nusxa ko'chirilsa ikkita HAR XIL "yaroqli yozuv"
 * tushunchasi paydo bo'lardi va farq faqat buzuq fayl kelgan kuni chiqardi.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Manfiy va `NaN` qiymatlar 0 ga keltiriladi — UI da hech qachon "NaN wpm" ko'rinmasin. */
export function toNonNegative(value: unknown): number {
  const n = toFiniteNumber(value, 0)
  return n > 0 ? n : 0
}

export function toText(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

export function clamp01(value: number): number {
  return value > 1 ? 1 : value
}

/**
 * Ixtiyoriy so'nuvchi hisoblagich: yaroqsiz qiymat butun QATORNI emas, faqat
 * SHU maydonni yo'q qiladi.
 *
 * Sabab: `e`/`x` — foydalanuvchining haqiqiy mashq tarixi, `de`/`dx` esa undan
 * qayta hisoblab olinadigan yordamchi son. Buzuq `de` uchun yillik tarixni
 * tashlash almashuvni teskari tomonga qo'yardi; `undefined` qaytarilsa §6.5
 * urug'lantirishi uni umrbod hisoblagichlardan qayta tiklaydi.
 *
 * Manfiy qiymat ham yaroqsiz: so'nuvchi hisoblagich manfiy bo'la olmaydi, va
 * manfiy `dx` reytingni pastga tortib, so'zni jimgina ro'yxatdan yashirardi.
 */
export function toOptionalCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return value
}

/**
 * Ixtiyoriy kun raqami (`f`, `l`). Butun songa keltiriladi — kun raqami
 * ta'rifi bo'yicha butun (`wordScore.dayNumber`), kasr qiymat esa `decayed`
 * dagi `dt` ni sutkaning bir qismiga yanglishtirardi.
 *
 * Manfiy raqam 1970 dan oldingi sanani bildiradi — bu ombor uchun ma'nosiz.
 */
export function toOptionalDay(value: unknown): number | undefined {
  const day = toOptionalCount(value)
  return day === undefined ? undefined : Math.floor(day)
}

export function toSentenceRecord(raw: unknown): SentenceRecord | null {
  if (!isRecord(raw)) return null
  return {
    // `lessonId` ATAYIN o'qilmaydi: eski yozuvlarda u bor, lekin `SentenceRecord`
    // dan olib tashlangan (§2.3). Maydon shu yerda JIMGINA tushib qoladi.
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

export function toSessionRecord(raw: unknown): SessionRecord | null {
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

// ---------------------------------------------------------------------------
// Yozuvni ixchamlashtirish (§2.3)
// ---------------------------------------------------------------------------

/**
 * Yozuvdagi yaxlitlash ko'paytirgichlari: WPM — 1 kasr, aniqlik — 3 kasr.
 *
 * `netWpm: 39.71388918543824` diskda 17 ta ma'nosiz belgi yeydi. Aniqlikka
 * 3 kasr ATAYIN qoldirilgan — u 0..1 oralig'ida va 1 kasr bilan 99.4% va
 * 99.9% bir xil ko'rinib qolardi.
 */
export const WPM_SCALE = 10
export const ACCURACY_SCALE = 1_000

/** `value` ni `scale` ga mos kasr xonasigacha yaxlitlaydi (10 -> 1 kasr, 1000 -> 3 kasr). */
export function roundTo(value: number, scale: number): number {
  return Math.round(value * scale) / scale
}

/**
 * Gap yozuvining suzuvchi sonlarini yaxlitlaydi (§2.3). IDEMPOTENT.
 *
 * Bosish SONLARI (`keystrokes`, `correctKeystrokes`, `activeMs`) tegilmaydi:
 * ular butun va aynan shulardan kunlik chelaklar qayta hisoblanadi —
 * yaxlitlash ularda ma'lumot yo'qotish bo'lardi.
 *
 * ⚠️ M3 da bu funksiya `stats.ts` dan shu yerga KO'CHDI, chunki endi uni IKKI
 * tomon chaqiradi: `useTypingSession` (seans konvertining og'irlikli
 * o'rtachasi AYNAN yaxlitlangan qiymatlardan chiqishi uchun) va `stats.ts`
 * (diskka nima tushishini ombor kafolatlashi uchun). Ikki nusxa bo'lsa
 * konvert bilan gaplar jadvali oxirgi kasrda ayrilib, uni tekshirgan odam
 * mavjud bo'lmagan xatoni qidirardi.
 *
 * `...record` BIRINCHI — notanish maydonlar (eski/yangi build yozgani)
 * saqlanib qoladi (§9.2).
 */
export function roundSentence(record: SentenceRecord): SentenceRecord {
  return {
    ...record,
    netWpm: roundTo(record.netWpm, WPM_SCALE),
    rawWpm: roundTo(record.rawWpm, WPM_SCALE),
    accuracy: roundTo(record.accuracy, ACCURACY_SCALE),
  }
}

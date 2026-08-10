// `localStorage` v1 -> IndexedDB v2 migratsiyasi (docs/stats-longterm.md §9).
//
// Bu fayl v1 PARSERINI QAYTA YOZMAYDI: u `statsV1.ts` dagi `loadStatsV1()` ni
// chaqiradi (§9.2 — parser saqlanadi, o'chirilmaydi). Sabab oddiy: v1 hujjatini
// tekshirish qoidalari (buzuq yozuvni tashlash, `exposures: 0` ni rad etish,
// `de`/`dx` ni §6.5 bo'yicha urug'lantirish) allaqachon 60+ test bilan
// mixlangan. Ikkinchi nusxa ikkita HAR XIL "yaroqli v1" tushunchasini yasardi,
// va ular orasidagi farq faqat migratsiya kunida, bir marta, jimgina chiqardi.
//
// Fayl IKKI QISMGA bo'lingan va bo'linish ATAYIN:
//
//   1. `buildMigration` — SOF funksiya. Butun hisob-kitob (so'z xaritasi, kun
//      xaritasi, umrbod hisoblagichlar) shu yerda, IndexedDB'ga umuman
//      tegmasdan bajariladi va alohida, IDB'siz sinaladi.
//   2. `migrateV1ToV2` — IDB qobig'i. Tranzaksiya ichida FAQAT `put` lar bor.
//
// ⚠️ (§8.4a) BU BO'LINISH — TRANZAKSIYA QOIDASINING O'ZI. IndexedDB
// tranzaksiyasi kutilayotgan IDB so'rovisiz hodisalar siklga qaytsa AVTOMATIK
// yopiladi, ya'ni tranzaksiya ichida IDB'ga tegishli bo'lmagan bitta `await`
// ham uni o'ldiradi va keyingi so'rov `TransactionInactiveError` bilan
// yiqiladi. Hisobni tranzaksiyadan OLDIN, sof funksiyada tugatish — eng
// xavfsiz naqsh: yozuv bosqichida kutiladigan hech narsa qolmaydi.
//
// ⚠️ (§9.3) v1 `localStorage` kaliti (`dnt.stats.v1`) BU BOSQICHDA
// O'CHIRILMAYDI. Orqaga qaytish oynasi ataylab ochiq qoldiriladi va u keyingi
// relizda yopiladi. Shu sababli marker (`v1MigratedAt`) IDB tomonda yotadi:
// "ko'chirildimi" degan javob v1 kalitining borligiga BOG'LIQ EMAS.

import { tokenize } from '../core/tokenize.ts'
import { dayNumber } from '../core/wordScore.ts'
import { getLesson } from './lessons.ts'
import { openDb, runTx } from './statsDb.ts'
import {
  META_KEY_DECAY_ANCHOR_DAY,
  META_KEY_LIFETIME,
  META_KEY_MIXED_ERA_DAY,
  STORE_DAYS,
  STORE_META,
  STORE_SESSIONS,
  STORE_WORDS,
  addAccum,
  dayKeyOf,
  emptyAccum,
  isRecord,
  netCharsOf,
  sumAccum,
  toNonNegative,
  toOptionalDay,
} from './statsSchema.ts'
import type { DayRow, LifetimeMeta, SessionRecord, WordRow } from './statsSchema.ts'
import { loadStatsV1, seedDecayed } from './statsV1.ts'
import type { StatsDataV1 } from './statsV1.ts'

/**
 * IDEMPOTENTLIK MARKERI — `meta` do'konidagi kalit, qiymati migratsiya vaqti
 * (ms). Mavjud bo'lsa migratsiya BOSHQA HECH QACHON bajarilmaydi.
 *
 * ⚠️ Marker `meta.lifetime` bilan bir do'konda va — muhimi — YOZUV BILAN
 * BITTA tranzaksiyada qo'yiladi. Ikki marta ishlash xatari bu yerda nazariy
 * emas: migratsiyadan keyin ilova yozishda davom etadi, ya'ni ikkinchi ishga
 * tushish jonli qatorlarni ESKI v1 qiymatlari bilan ustidan yozib, oradagi
 * mashqni butunlay yo'q qilardi.
 */
export const META_KEY_V1_MIGRATED_AT = 'v1MigratedAt'

/**
 * Migratsiya natijasi.
 *
 * `migrated: false` — bu XATO EMAS: uchala sabab ham normal holat, va ular
 * ATAYIN ajratilgan, chunki UI ularga har xil munosabatda bo'ladi:
 * `no-idb` — banner (§8.4d, brauzer omborni bermayapti), `already-migrated` —
 * jim davom etish, `no-v1-data` — yangi foydalanuvchi.
 */
export type MigrationResult =
  | { ok: true; migrated: false; reason: 'already-migrated' | 'no-v1-data' | 'no-idb' }
  | { ok: true; migrated: true; words: number; days: number; sessions: number }
  | { ok: false; error: string }

/**
 * `lessonId` -> o'sha darsning gaplari. `buildMigration` ni SOF saqlash uchun
 * darslar `localStorage` dan OLDINDAN o'qib olinadi (`collectLessons`).
 *
 * Darsi o'chirilgan seans bu xaritaga UMUMAN tushmaydi — `undefined` aynan
 * "dars yo'q" degani (§9.1: bunday seans tiklashga hissa qo'shmaydi, lekin
 * migratsiyani YIQITMAYDI).
 */
export type LessonSentences = ReadonlyMap<string, readonly string[]>

/** Diskka yoziladigan tayyor qatorlar — tranzaksiyadan OLDIN to'liq hisoblanadi. */
export type MigrationPlan = {
  words: WordRow[]
  days: DayRow[]
  sessions: SessionRecord[]
  lifetime: LifetimeMeta
  /**
   * v1 hujjatida saqlangan so'nish langari (`StatsData.seedAnchorDay`), bo'lsa.
   *
   * ⚠️ U migratsiya sanasidan AFZAL: langar M0+M1 omborida urug'lantirish
   * SODIR BO'LGAN kunda qo'yilgan, ya'ni haqiqiyroq va odatda ancha erta.
   * Migratsiya kuni bilan almashtirish oradagi butun so'nishni bekor qilib,
   * fossil qatorlarni yana bir marta "yangi" qilib ko'rsatardi.
   *
   * Yo'q bo'lsa (v1 ombori M1 dan oldin muzlab qolgan) langar sifatida
   * migratsiya kuni yoziladi — `writePlan` ga qarang.
   */
  seedAnchorDay?: number
}

// ---------------------------------------------------------------------------
// SOF qism — hisob-kitob
// ---------------------------------------------------------------------------

/**
 * Ikkita ixtiyoriy kun raqamidan bittasi: biri yo'q bo'lsa MAVJUDI g'olib,
 * ikkalasi ham bor bo'lsa `pick` (`f` uchun `Math.min`, `l` uchun `Math.max`).
 *
 * `Math.min(a, b)` ni to'g'ridan-to'g'ri chaqirib bo'lmaydi: `undefined` bilan
 * u `NaN` beradi, va `NaN` kun raqami `by_l` indeksini jimgina buzardi.
 */
function pickDay(
  a: number | undefined,
  b: number | undefined,
  pick: (x: number, y: number) => number,
): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return pick(a, b)
}

/**
 * `s` — JORIY toza seriya, ya'ni u ENG SO'NGGI ta'sirlanishga tegishli.
 * Shuning uchun `l` si KECHROQ qatorniki olinadi: eskirog'ining seriyasi
 * oradagi ta'sirlanishlar bilan allaqachon uzilgan bo'lishi mumkin.
 *
 * Sanalar teng yoki NOMA'LUM bo'lsa KICHIGI olinadi — bu eng konservativ
 * taxmin: aralashgan tarixda seriya faqat UZILISHI mumkin, uzayishi emas,
 * ya'ni "eng yaxshi seriya" bo'rttirilmaydi (`nextWordRow` dagi bilan bir xil
 * mulohaza).
 */
function pickStreak(a: WordRow, b: WordRow): number {
  if (a.l === undefined) return b.l === undefined ? Math.min(a.s, b.s) : b.s
  if (b.l === undefined) return a.s
  if (a.l === b.l) return Math.min(a.s, b.s)
  return a.l > b.l ? a.s : b.s
}

/**
 * Kalit normallashtirilgandan keyin to'qnashgan ikkita qatorni birlashtiradi
 * (§2.5): hisoblagichlar QO'SHILADI, `f` — eng erta, `l` — eng kech kun.
 *
 * ⚠️ Qo'shishdan keyin `x <= e` va `dx <= de` invariantlari QAYTA
 * o'rnatiladi. Kirish qatorlari alohida-alohida bu shartni qanoatlantirgan
 * bo'lsa yig'indi ham qanoatlantiradi, lekin `buildMigration` ga v1 parseridan
 * O'TMAGAN hujjat ham berilishi mumkin — o'shanda `dx > de` ball shkalasini
 * 1 dan oshirib yuborardi.
 *
 * ⭐ `...rest` (ya'ni `a` ning qolgan maydonlari) BIRINCHI — §9.2 ning
 * oldinga moslik yumshatishi: har bir o'qi-o'zgartir-yoz zanjiri qatorni
 * `{ ...current, <ma'lum maydonlar> }` bilan qayta yozadi, ya'ni notanish
 * maydon yo'qolmaydi. `f`/`l` esa spread'dan ATAYIN chiqarib tashlangan:
 * `a` da `f: undefined` OWN maydon bo'lib qolsa, `'l' in row === false`
 * shartiga tayanadigan §9.1 kafolati (`by_l` indeksiga tushmaslik) buzilardi.
 *
 * ⭐ `s`/`b` ENDI ZO'RLAB NOLGA TUSHIRILMAYDI. Ilgari shunday edi va sabab
 * ham to'g'ri yozilgan edi — v1 hujjatidan seriyani tiklab bo'lmaydi, ya'ni
 * `buildMigration` ichidagi to'qnashuvda ikkala qator ham 0. Lekin funksiya
 * KEYIN ikkita boshqa joyda ishlatila boshladi va u yerda `a` — DISKDAGI
 * jonli qator: `writePlan` uni migratsiya oynasida yozilgan qator bilan,
 * `importJson` esa zaxira faylining ikkita yarim qatori bilan birlashtiradi.
 * Ikkalasida ham `s`/`b` HAQIQIY, va nolga tushirish `nextWordRow` sanagan
 * seriyani jimgina yo'q qilardi.
 *
 * `b` — "eng yaxshi" ta'rifi bo'yicha MAKSIMUM: ikkita tarixning hech biri
 * ikkinchisining rekordini pasaytira olmaydi.
 *
 * EKSPORT qilinadi: `stats.ts` dagi `importJson` v2 faylida ham AYNI
 * to'qnashuvga duch kelishi mumkin (qo'lda tahrirlangan yoki begona zaxira),
 * va u yerda boshqacha qoida qo'llash bir so'zning yarim tarixini jimgina
 * yo'qotardi.
 */
export function mergeWordRows(a: WordRow, b: WordRow): WordRow {
  const e = a.e + b.e
  const x = a.x + b.x
  const de = a.de + b.de
  const dx = a.dx + b.dx

  const f = pickDay(a.f, b.f, Math.min)
  const l = pickDay(a.l, b.l, Math.max)
  const s = pickStreak(a, b)

  const { f: _droppedF, l: _droppedL, ...rest } = a

  return {
    ...rest,
    w: a.w,
    e,
    x: x > e ? e : x,
    de,
    dx: dx > de ? de : dx,
    s,
    b: Math.max(a.b, b.b, s),
    ...(f === undefined ? {} : { f }),
    ...(l === undefined ? {} : { l }),
  }
}

/**
 * Migratsiya rejasidagi kun qatorini DISKDAGI qator bilan birlashtiradi. SOF.
 *
 * ⚠️ QO'SHISH, ALMASHTIRISH EMAS — va bu hissalar DIZAYN bo'yicha AJRALGANIGA
 * tayanadi: diskdagi qator faqat `writeSentences` yozgan gaplardan iborat
 * (migratsiya boshlangandan keyin terilgan), rejadagi qator esa faqat v1
 * hujjatidan. M3 da v1 ombori FAQAT O'QILADI, ya'ni yangi terilgan gap v1
 * hujjatiga hech qachon tushmaydi. Kesishuv yo'q -> ikki marta sanash ham yo'q.
 *
 * ⚠️ IXTIYORIY maydonlar (`k`, `nc`, `on`/`off`, `unknown`) ikkala tomonda ham
 * yo'q bo'lsa YO'Q bo'lib qoladi (`PLAN.md` §11.3, 4-invariant): `+ 0` ham
 * "o'lchanmagan" kunni "nol o'lchandi" ga aylantirardi.
 *
 * `...current` BIRINCHI — diskdagi notanish maydonlar saqlanadi (§9.2).
 */
function mergeDayRows(current: DayRow, incoming: DayRow): DayRow {
  return {
    ...current,
    d: current.d,
    correctKeystrokes: current.correctKeystrokes + incoming.correctKeystrokes,
    activeMs: current.activeMs + incoming.activeMs,
    sentences: current.sentences + incoming.sentences,
    ...(current.k === undefined && incoming.k === undefined
      ? {}
      : { k: (current.k ?? 0) + (incoming.k ?? 0) }),
    ...(current.nc === undefined && incoming.nc === undefined
      ? {}
      : { nc: (current.nc ?? 0) + (incoming.nc ?? 0) }),
    ...(current.on === undefined && incoming.on === undefined
      ? {}
      : { on: sumAccum(current.on ?? emptyAccum(), incoming.on ?? emptyAccum()) }),
    ...(current.off === undefined && incoming.off === undefined
      ? {}
      : { off: sumAccum(current.off ?? emptyAccum(), incoming.off ?? emptyAccum()) }),
    ...(current.unknown === undefined && incoming.unknown === undefined
      ? {}
      : { unknown: (current.unknown ?? 0) + (incoming.unknown ?? 0) }),
  }
}

/**
 * Migratsiya konvertini DISKDAGI konvert bilan birlashtiradi. SOF.
 *
 * ⭐ QO'SHISH — `max()` EMAS, va farq shu yerda MA'NOVIY.
 *
 * `importJson` dagi `mergeLifetimeOnImport` `max()` ishlatadi, chunki u yerdagi
 * ikki konvert AYNI tarixning ikkita KO'RINISHI: zaxira fayli va joriy ombor
 * bir xil mashqni sanaydi, ya'ni qo'shish ikki marta sanash bo'lardi.
 *
 * Bu yerda esa ular AJRALGAN. Diskda konvert bo'lishining YAGONA yo'li —
 * `writeSentences` uni migratsiya oynasida yaratgani (`lifetimeForWrite` ta'mir
 * shoxi): `importJson` ham, `clearStats()` ham markerni qo'yadi, ya'ni ular
 * ishlagan bo'lsa yuqoridagi qorovul migratsiyani UMUMAN o'tkazmasdi. Demak
 * diskdagi konvert = faqat migratsiya oynasida terilgan gaplar, rejadagi
 * konvert = faqat v1 tarixi. `max()` ularning KICHIGINI butunlay yo'q qilardi:
 * ko'rikchi aynan shuni o'lchagan (`totals().sessions` 1 -> 0).
 *
 * ⚠️ `*Since` esa QO'SHILMAYDI, MINIMUM olinadi: u son emas, "bu maydon qaysi
 * kundan beri bilinadi" degan BELGI, ya'ni kichikroq sana ko'proq bilim. Bir
 * tomonda belgi yo'q bo'lsa ikkinchisi olinadi — `mergeLifetimeOnImport` dagi
 * "yo'qlik sanadan KUCHLIROQ" qoidasi bu yerda QO'LLANMAYDI: migratsiyagacha
 * bo'lgan davr seansdan hosil qilingan hisoblagichlar uchun hech qachon to'liq
 * qamralmagan, ya'ni yo'qlik "to'liq bilinadi" degani emas.
 *
 * `raw` ATAYIN `unknown`: bu diskdan kelgan qiymat va u obyekt bo'lmasligi ham
 * mumkin. Obyekt bo'lmasa birlashtiradigan narsa yo'q — reja shundayligicha
 * yoziladi.
 */
function mergeLifetimeOnMigration(raw: unknown, incoming: LifetimeMeta): LifetimeMeta {
  if (!isRecord(raw)) return incoming

  const pickSince = (a: unknown, b: number | undefined): number | undefined => {
    const day = toOptionalDay(a)
    if (day === undefined) return b
    if (b === undefined) return day
    return Math.min(day, b)
  }

  const netCharsSince = pickSince(raw['netCharsSince'], incoming.netCharsSince)
  const sessionsSince = pickSince(raw['sessionsSince'], incoming.sessionsSince)
  const keystrokesSince = pickSince(raw['keystrokesSince'], incoming.keystrokesSince)

  return {
    // `...raw` BIRINCHI — diskdagi notanish maydonlar saqlanadi (§9.2).
    ...raw,
    activeMs: toNonNegative(raw['activeMs']) + incoming.activeMs,
    correctKeystrokes: toNonNegative(raw['correctKeystrokes']) + incoming.correctKeystrokes,
    netChars: toNonNegative(raw['netChars']) + incoming.netChars,
    sessions: toNonNegative(raw['sessions']) + incoming.sessions,
    keystrokes: toNonNegative(raw['keystrokes']) + incoming.keystrokes,
    ...(netCharsSince === undefined ? {} : { netCharsSince }),
    ...(sessionsSince === undefined ? {} : { sessionsSince }),
    ...(keystrokesSince === undefined ? {} : { keystrokesSince }),
  }
}

/**
 * v1 hujjatidan v2 qatorlarini hosil qiladi. SOF: `localStorage`, IndexedDB,
 * `Date.now()` — hech biriga tegmaydi, ya'ni butun migratsiya mantiqi mock'siz
 * sinaladi.
 *
 * Uchta manba QAT'IY ajratilgan va ular BIR-BIRINI TO'LDIRMAYDI (§4.2):
 *
 *   - `words` — v1 so'z jadvalidan (kalit §2.5 bo'yicha normallashtiriladi va
 *     to'qnashganlari birlashtiriladi); `f`/`l` omon qolgan SEANSLARDAN tiklanadi;
 *   - `days` baza uchtasi (`correctKeystrokes`, `activeMs`, `sentences`) —
 *     FAQAT v1 `days` dan, `k`/`nc`/chelaklar esa FAQAT seanslardan;
 *   - `lifetime` — §4.3 jadvali bo'yicha maydonma-maydon.
 *
 * ⚠️ IKKI MARTA SANASH bu yerdagi asosiy xatar (§13). Shuning uchun seanslar
 * bo'ylab yurish `days` ning baza uchtasiga UMUMAN tegmaydi: o'sha uchtasi
 * v1 da allaqachon to'liq, va ularni seanslardan qayta qo'shish har bir
 * omon qolgan kunni ikkilantirardi.
 */
export function buildMigration(stats: StatsDataV1, lessons: LessonSentences): MigrationPlan {
  const words = new Map<string, WordRow>()
  for (const [rawWord, stat] of Object.entries(stats.words)) {
    // ⚠️ (§2.5) KALIT NORMALLASHTIRISH — AYNAN SHU YERDA, boshqa joyda emas.
    //
    // v1 kalitlari kichik harfda KAFOLATLANMAGAN: `recordSession` yozishda
    // `trim().toLowerCase()` qiladi, `parseStats` esa O'QISHDA qilmaydi — u
    // kalitni qanday bo'lsa shundayligicha oladi, `importJson` esa aynan
    // o'sha natijani diskka yozadi. Ya'ni qo'lda tahrirlangan yoki begona
    // zaxira fayli v1 omboriga `{"The": …, "the": …}` ni kirita oladi.
    //
    // Nega aynan migratsiyada tuzatilishi SHART: IndexedDB birlamchi kalitlari
    // O'ZGARMAS, va biz `keyPath: 'w'` ni tanladik. Bu yerdan o'tib ketgan
    // noto'g'ri kalitni keyin tuzatish "har qatorni o'chirib qayta kiritish va
    // to'qnashganlarini QO'LDA birlashtirish" degani — ya'ni xato amalda
    // ABADIY bo'lib qolardi. Ustiga pastdagi `f`/`l` tiklash
    // `token.text.toLowerCase()` bilan qidiradi: `"The"` qatori hech qachon
    // topilmasdi va `"the"` bilan yonma-yon, sanasiz yashab qolardi.
    const word = rawWord.trim().toLowerCase()
    if (word === '') continue // `recordSession` bilan bir xil qoida.

    // §6.5 urug'lantirish. Bu shoxga `loadStatsV1()` ORQALI kelinmaydi
    // (`parseStatsV1` `de`/`dx` ni o'zi urug'lantiradi va `exposures: 0`
    // qatorlarini tashlaydi), lekin `WordStatV1.de`/`dx` TIP darajasida
    // ixtiyoriy: `buildMigration` ga to'g'ridan-to'g'ri berilgan hujjatda ular
    // bo'lmasligi mumkin. Qoida shuning uchun bu yerda ham bajariladi —
    // "bo'lmaydi" degan taxminga tayanmasdan. Formula `statsV1.ts` dan
    // IMPORT qilinadi: uchinchi nusxa uchta har xil urug'ga ajralib ketardi.
    const decay =
      stat.de === undefined || stat.dx === undefined
        ? seedDecayed(stat.exposures, stat.errors)
        : { de: stat.de, dx: stat.dx }

    const row: WordRow = {
      w: word,
      e: stat.exposures,
      x: stat.errors,
      de: decay.de,
      dx: decay.dx,
      // ⚠️ SERIYALAR NOLDAN BOSHLANADI, va bu ALMASHUV, yaxshilanish emas.
      // Toza seriyani omon qolgan seanslardan TIKLAB BO'LMAYDI: qaysi so'zda
      // xato qilingani gap darajasida hech qayerda saqlanmagan — `errorCounts`
      // seans davomida `useTypingSession` ichida yashaydi va yozilmaydi,
      // `SentenceRecord` da esa faqat gapning YIG'MA `keystrokes`/
      // `correctKeystrokes` i bor. Ya'ni "bu gapdagi qaysi so'z xato edi"
      // degan savolga ma'lumot yo'q. Shuning uchun `s`/`b` migratsiyadan
      // boshlab OLDINGA sanaladi.
      s: 0,
      b: 0,
      // Saqlangan `f`/`l` KO'CHIRILADI (M0+M1 dan keyin yozilgan qatorlarda
      // ular allaqachon HAQIQIY sana): pastdagi tiklash ularni faqat
      // kengaytiradi — `l` ni yuqoriga, `f` ni pastga.
      ...(stat.f === undefined ? {} : { f: stat.f }),
      ...(stat.l === undefined ? {} : { l: stat.l }),
    }

    // Normallashtirishdan keyin TO'QNASHGAN qatorlar birlashtiriladi. Oxirgisi
    // g'olib bo'lishi mumkin emas: `"The"` va `"the"` — bir so'zning ikkita
    // yarim tarixi, va birini tashlash ta'sirlanishlarni jimgina yo'qotardi.
    const existing = words.get(word)
    words.set(word, existing === undefined ? row : mergeWordRows(existing, row))
  }

  const days = new Map<string, DayRow>()
  for (const [key, day] of Object.entries(stats.days)) {
    days.set(key, {
      d: key,
      // Baza uchtasi v1 `days` dan TO'G'RIDAN-TO'G'RI: ular TO'LIQ, chunki
      // `days` hech qachon qisqartirilmaydi (qisqartirish faqat `sessions` ga
      // tegadi). Ularni seanslardan qayta hisoblash ma'lumotni YO'QOTARDI.
      correctKeystrokes: day.correctKeystrokes,
      activeMs: day.activeMs,
      sentences: day.sentences,
    })
  }

  // Omon qolgan seanslar bo'ylab BITTA yurish: undan `f`/`l` tiklanishi,
  // kun qatorlarining `k`/`nc`/chelaklari va umrbod `netChars`/`keystrokes`
  // birdan chiqadi.
  let netChars = 0
  let keystrokes = 0
  let sinceDay: number | undefined

  for (const session of stats.sessions) {
    // `undefined` — dars o'chirilgan (§9.1). Seansning o'zi baribir
    // ko'chiriladi va uning kunlik/umrbod hissasi ham saqlanadi; yo'qoladigan
    // yagona narsa — SO'Z MATNI, ya'ni `f`/`l` tiklanishi.
    const sentences = lessons.get(session.lessonId)

    const startDay = dayNumber(session.startedAt)
    sinceDay = sinceDay === undefined ? startDay : Math.min(sinceDay, startDay)

    for (const record of session.sentences) {
      // `skipped` gap `Escape` bilan tashlangan: u v1 da ham `days` ga
      // yozilmagan va seans yig'indisiga kirmagan. Bu yerda ham hech qayerda
      // sanalmaydi — aks holda migratsiya jimgina yangi ma'lumot to'qirdi.
      if (record.skipped) continue

      const day = dayNumber(record.at)
      const key = dayKeyOf(record.at)

      // Kun qatori v1 `days` da bo'lmasligi mumkin (nomuvofiq eski ombor).
      // Bunda baza uchtasi NOL bilan qoladi: ular faqat v1 `days` dan keladi,
      // va seansdan to'ldirish yuqoridagi "ikki marta sanamang" qoidasini
      // buzardi (o'sha kun v1 da bo'lganida ikkilanardi).
      const row: DayRow = days.get(key) ?? {
        d: key,
        correctKeystrokes: 0,
        activeMs: 0,
        sentences: 0,
      }

      // `k` va `nc` FAQAT seanslardan (§4.2): omon qolgan seansi yo'q kunlarda
      // ular `undefined` bo'lib QOLADI. Yo'q maydon ≠ nol — bunday kun
      // "abadiy taqribiy trendda qoladi" va UI da shunday ko'rsatiladi.
      row.k = (row.k ?? 0) + record.keystrokes
      row.nc = (row.nc ?? 0) + netCharsOf(record.netWpm, record.activeMs)

      if (record.audioEnabled === undefined) {
        // Ovoz holati NOMA'LUM (maydon qo'shilishidan oldingi gap). Uni
        // `off` ga qo'shish M2/M3 gate'ini eski tarix bilan ifloslantirardi.
        row.unknown = (row.unknown ?? 0) + 1
      } else if (record.audioEnabled) {
        row.on = addAccum(row.on ?? emptyAccum(), record)
      } else {
        row.off = addAccum(row.off ?? emptyAccum(), record)
      }

      days.set(key, row)

      netChars += netCharsOf(record.netWpm, record.activeMs)
      keystrokes += record.keystrokes

      if (sentences === undefined) continue

      // ⭐ §9.1 — `f`/`l` ni omon qolgan seanslardan TIKLASH. Qayta qurish
      // naqshi `Results.tsx` dagi `sessionWordRows` bilan AYNAN bir xil:
      // `lessonId` -> dars -> `sentences[sentenceIndex]` -> `tokenize`.
      const sentence = sentences[record.sentenceIndex]
      if (sentence === undefined) continue // Dars qisqargan — gap endi yo'q.

      for (const token of tokenize(sentence)) {
        if (token.kind !== 'word') continue
        const wordRow = words.get(token.text.toLowerCase())
        // v1 so'z jadvalida yo'q so'z uchun qator YARATILMAYDI: `e`/`x` ning
        // yagona manbasi o'sha jadval, va `e: 0` li qator §6.5 ning
        // `e > 0` invariantini buzardi.
        if (wordRow === undefined) continue

        wordRow.l = wordRow.l === undefined ? day : Math.max(wordRow.l, day)
        wordRow.f = wordRow.f === undefined ? day : Math.min(wordRow.f, day)
      }
    }
  }

  // ⚠️ TIKLANMAGAN SO'ZLARDA `f`/`l` `undefined` QOLADI — migratsiya sanasi
  // QO'YILMAYDI (§9.1). `f = l = bugun` deb yozish ~3–9 ming so'zga bir xil
  // soxta sana berardi: maydon mavjud, ekranga ulangan va BUTUNLAY ma'nosiz.
  // `l` ni hech bo'lmasa keyingi ta'sirlanish tuzatardi, `f` esa — kech
  // qo'yilgan minimum bo'lgani uchun — HECH QACHON tuzalmasdi.

  return {
    words: [...words.values()],
    days: [...days.values()],
    // Seanslar to'liq ko'chiriladi (gap yozuvlari bilan): `sessions` do'koni
    // aynan shu shaklni kutadi (`keyPath: 'id'`).
    sessions: stats.sessions,
    lifetime: buildLifetime(stats, netChars, keystrokes, sinceDay),
    ...(stats.seedAnchorDay === undefined ? {} : { seedAnchorDay: stats.seedAnchorDay }),
  }
}

/**
 * §4.3 — `meta.lifetime` ni MAYDONMA-MAYDON urug'lantiradi.
 *
 * | Maydon                          | Manba                    | `since`        |
 * |---------------------------------|--------------------------|----------------|
 * | `activeMs`, `correctKeystrokes` | `days` dan ANIQ          | YO'Q           |
 * | `netChars`                      | seanslardan HOSIL        | eng eski seans |
 * | `sessions`, `keystrokes`        | faqat omon qolgan seans  | eng eski seans |
 *
 * ⚠️ Birinchi qator nega ANIQ: `recordSession` har bir `skipped` bo'lmagan
 * gapning `correctKeystrokes` va `activeMs` ini `days` ga yozadi, va `days`
 * HECH QACHON qisqartirilmaydi — qisqartirish faqat `sessions` ga tegadi.
 * Ya'ni bu ikkalasi haqiqiy umrbod son, `since` ga muhtoj emas.
 *
 * > §4.3 dagi YON TOPILMA: `totals().activeMs` BUGUN ham noto'g'ri — seanslar
 * > `MAX_SESSIONS` bilan qisqarganda u kamayadi. `days` dan urug'lantirish
 * > shuning uchun nafaqat migratsiyani to'g'ri qiladi, balki JONLI xatoni ham
 * > tuzatadi: umrbod raqam bundan keyin orqaga yurmaydi.
 *
 * ⚠️ Seans umuman yo'q bo'lsa `*Since` maydonlari QO'YILMAYDI. "Falon
 * sanadan beri" degan belgi sana bo'lmagan joyda ma'nosiz, va uni bugungi kun
 * bilan to'ldirish `f`/`l` dagi bilan bir xil soxta sana muammosini yasardi.
 */
function buildLifetime(
  stats: StatsDataV1,
  netChars: number,
  keystrokes: number,
  sinceDay: number | undefined,
): LifetimeMeta {
  let activeMs = 0
  let correctKeystrokes = 0
  for (const day of Object.values(stats.days)) {
    activeMs += day.activeMs
    correctKeystrokes += day.correctKeystrokes
  }

  return {
    activeMs,
    correctKeystrokes,
    netChars,
    sessions: stats.sessions.length,
    keystrokes,
    ...(sinceDay === undefined
      ? {}
      : { netCharsSince: sinceDay, sessionsSince: sinceDay, keystrokesSince: sinceDay }),
  }
}

// ---------------------------------------------------------------------------
// IDB qobig'i — faqat o'qish/yozish
// ---------------------------------------------------------------------------

/**
 * v1 `localStorage` ombori mavjud bo'lsa uni IndexedDB'ga ko'chiradi (§9).
 *
 * IDEMPOTENT: `meta` do'konidagi `v1MigratedAt` markeri ikkinchi ishga
 * tushishni to'sadi. Marker BO'SH ombor uchun ham yoziladi — aks holda har
 * boot'da 2 MB'gacha v1 hujjati bekorga qayta o'qilib, qayta tekshirilardi.
 *
 * Yiqilmaydi: IDB umuman yo'q bo'lsa (`openDb()` -> `null`) natija
 * `no-idb`, bloklangan bo'lsa (`StatsDbBlockedError`) — `ok: false` va xabar.
 */
export async function migrateV1ToV2(): Promise<MigrationResult> {
  try {
    const db = await openDb()
    if (db === null) return { ok: true, migrated: false, reason: 'no-idb' } // (§8.4d)

    // ARZON oldindan tekshiruv. Pastdagi yozuv tranzaksiyasi markerni QAYTA
    // tekshiradi (haqiqiy kafolat o'sha yerda, atomik "tekshir-va-yoz"), bu
    // esa faqat ko'chirilgan omborda v1 hujjatini qayta parse qilmaslik uchun.
    if (await hasMarker(db)) return { ok: true, migrated: false, reason: 'already-migrated' }

    // ⚠️ (§8.4a) BUTUN hisob-kitob tranzaksiyadan OLDIN. `loadStatsV1()` va
    // `getLesson()` — sinxron `localStorage` o'qishlari, lekin ular baribir
    // shu yerda, tranzaksiya ochilishidan oldin tugaydi.
    //
    // `at` BIR MARTA olinadi: u ham v1 parserining "bugun" i (langar uchun),
    // ham markerning vaqt tamg'asi. Ikki marta `Date.now()` chaqirilsa ular
    // yarim tunda AYRILIB qolishi mumkin edi.
    const at = Date.now()
    const stats = loadStatsV1(dayNumber(at))
    const plan = buildMigration(stats, collectLessons(stats.sessions))

    const written = await writePlan(db, plan, at)
    // Boshqa tab oradan o'tib ulgurdi: marker bor edi, hech narsa yozilmadi.
    if (!written) return { ok: true, migrated: false, reason: 'already-migrated' }

    if (plan.words.length === 0 && plan.days.length === 0 && plan.sessions.length === 0) {
      // Ko'chiradigan narsa yo'q edi, lekin marker YOZILDI (yuqoridagi izoh).
      return { ok: true, migrated: false, reason: 'no-v1-data' }
    }

    return {
      ok: true,
      migrated: true,
      words: plan.words.length,
      days: plan.days.length,
      sessions: plan.sessions.length,
    }
  } catch (err) {
    // `StatsDbBlockedError` shu yerda ushlanadi (§8.4b): boshqa tab eski
    // versiyani ushlab turibdi — vaqtinchalik holat, va chaqiruvchi uni
    // "IDB yo'q" bilan bir xil ko'rsatmasligi uchun `ok: false` bo'lib chiqadi.
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Seanslar tegib o'tgan darslarning gaplarini OLDINDAN yig'adi.
 *
 * `getLesson` har chaqiruvda BUTUN darslar hujjatini o'qib parse qiladi,
 * shuning uchun har `lessonId` uchun aynan bir marta chaqiriladi. Topilmagan
 * dars xaritaga tushmaydi va `seen` tufayli qayta so'ralmaydi.
 *
 * EKSPORT qilinadi, chunki `stats.ts` dagi `importJson` ESKI (`version: 1`)
 * zaxira faylini ham aynan `buildMigration` bilan o'qiydi (§9.5: "v1 fayllarni
 * o'qish MAJBURIY") va o'sha yerda ham §9.1 dagi `f`/`l` tiklanishi kerak.
 * Nusxa ko'chirilsa import yo'li migratsiya yo'lidan jimgina ayrilib qolardi.
 */
export function collectLessons(sessions: readonly SessionRecord[]): LessonSentences {
  const map = new Map<string, readonly string[]>()
  const seen = new Set<string>()

  for (const session of sessions) {
    if (seen.has(session.lessonId)) continue
    seen.add(session.lessonId)
    const lesson = getLesson(session.lessonId)
    if (lesson !== null) map.set(session.lessonId, lesson.sentences)
  }

  return map
}

/** Marker bormi (`readonly` tranzaksiya). */
function hasMarker(db: IDBDatabase): Promise<boolean> {
  return runTx<boolean>(
    db,
    [STORE_META],
    'readonly',
    (tx, collect) => {
      const req = tx.objectStore(STORE_META).get(META_KEY_V1_MIGRATED_AT)
      req.onsuccess = () => collect(req.result !== undefined)
    },
    // So'rov yiqilsa `collect` chaqirilmaydi — "marker yo'q" xavfsiz taxmin
    // emas, lekin bunda tranzaksiya ham RAD etiladi, ya'ni bu qiymat chiqmaydi.
    false,
  )
}

/**
 * Rejani BITTA tranzaksiyada diskka yozadi. `false` — marker allaqachon bor
 * edi va hech narsa yozilmadi.
 *
 * ⭐ SO'NISH LANGARI shu yerda qo'yiladi: `plan.seedAnchorDay ?? dayNumber(at)`
 * (`PLAN.md` §11.3, 4-invariant). v1 dagi langar AFZAL, chunki u
 * urug'lantirish sodir bo'lgan kunda qo'yilgan va migratsiya sanasidan erta;
 * yo'q bo'lsa migratsiya kuni ishlatiladi — ya'ni `v1MigratedAt` bilan bir xil
 * lahza, lekin KUN raqami shaklida (o'qish yo'li `dt` ni kunlarda hisoblaydi).
 *
 * Langarsiz `l` si tiklanmagan qatorlar v2 da ham abadiy muzlab qolardi: bu
 * aynan v1 dagi nuqsonning IndexedDB'ga o'zgarishsiz ko'chgan nusxasi bo'lardi.
 *
 * ⚠️ (§8.4a) `body` SINXRON va ichida IDB'dan boshqa hech narsa kutilmaydi:
 * marker tekshiruvi `onsuccess` ichida davom etadi, `put` lar esa navbatga
 * ketma-ket qo'yiladi. Tranzaksiya butun davomida FAOL qoladi.
 *
 * Tekshirish va yozish AYNAN BITTA tranzaksiyada bo'lgani ham ataylab: shu
 * bilan "tekshir-va-yoz" atomik bo'ladi va ikkita bir vaqtda ochilgan tab
 * ikkalasi ham migratsiya qilib, qiymatlarni IKKILANTIRA olmaydi.
 *
 * ⭐ `words`/`days`/`meta.lifetime` KO'R `put` BILAN YOZILMAYDI —
 * O'QI-BIRLASHTIR-YOZ. Sabab POYGA: bu tranzaksiya `loadStatsV1()` +
 * `buildMigration()` TUGAGANDAN KEYIN ochiladi, ular esa 2 MB hujjat uchun
 * o'nlab ms yeydi. O'sha oynada foydalanuvchi gap terib tugatsa,
 * `writeSentences` o'z qatorlarini allaqachon yozgan bo'ladi va butun qatorni
 * almashtiradigan `put` uni JIMGINA yo'q qilardi — seans qatori diskda qolib,
 * uning so'z/kun/umrbod hissasi yo'qolardi, ya'ni DOIMIY nomuvofiqlik.
 * O'lchangan zarar: `alpha` ta'sirlanishi 11 -> 10, bugungi `correctKeystrokes`
 * 948 -> 900, `totals().sessions` 1 -> 0.
 *
 * ⚠️ `getAll()` har qator uchun alohida `get()` dan afzal: ikkita so'rov
 * o'rniga minglab so'rov tranzaksiyani cho'zardi. Do'konlar bu lahzada deyarli
 * bo'sh — ularda faqat migratsiya oynasida yozilgan qatorlar bo'lishi mumkin
 * (marker qorovuli boshqa har qanday yo'lni to'sadi).
 *
 * `sessions` esa KO'R `put` bo'lib qoladi: v1 seanslarining `id` lari ESKI
 * build tomonidan ajratilgan, oynada yozilgani esa YANGI seans — to'qnashuv
 * uchun ikkalasi bir xil `id` olishi kerak bo'lardi.
 */
function writePlan(db: IDBDatabase, plan: MigrationPlan, at: number): Promise<boolean> {
  return runTx<boolean>(
    db,
    [STORE_WORDS, STORE_DAYS, STORE_SESSIONS, STORE_META],
    'readwrite',
    (tx, collect) => {
      const meta = tx.objectStore(STORE_META)
      const guard = meta.get(META_KEY_V1_MIGRATED_AT)

      guard.onsuccess = () => {
        if (guard.result !== undefined) {
          collect(false)
          return
        }

        const wordsStore = tx.objectStore(STORE_WORDS)
        const liveWordsReq = wordsStore.getAll()
        liveWordsReq.onsuccess = () => {
          const live = new Map<string, WordRow>()
          for (const row of liveWordsReq.result as WordRow[]) live.set(row.w, row)
          for (const row of plan.words) {
            const current = live.get(row.w)
            // `mergeWordRows` — migratsiya ichidagi kalit to'qnashuvi bilan AYNI
            // qoida: hisoblagichlar qo'shiladi, `f` eng erta, `l` eng kech kun.
            wordsStore.put(current === undefined ? row : mergeWordRows(current, row))
          }
        }

        const daysStore = tx.objectStore(STORE_DAYS)
        const liveDaysReq = daysStore.getAll()
        liveDaysReq.onsuccess = () => {
          const live = new Map<string, DayRow>()
          for (const row of liveDaysReq.result as DayRow[]) live.set(row.d, row)
          for (const row of plan.days) {
            const current = live.get(row.d)
            daysStore.put(current === undefined ? row : mergeDayRows(current, row))
          }
        }

        const sessionsStore = tx.objectStore(STORE_SESSIONS)
        for (const row of plan.sessions) sessionsStore.put(row)

        const liveLifetimeReq = meta.get(META_KEY_LIFETIME)
        liveLifetimeReq.onsuccess = () => {
          meta.put(mergeLifetimeOnMigration(liveLifetimeReq.result, plan.lifetime), META_KEY_LIFETIME)
        }

        meta.put(plan.seedAnchorDay ?? dayNumber(at), META_KEY_DECAY_ANCHOR_DAY)

        // ⭐ ARALASH DAVR CHEGARASI — FAQAT v1 kun qatorlari haqiqatan
        // ko'chirilgan bo'lsa (`PLAN.md` §11.3, 9-invariant). Aynan o'shalar
        // baza uchtasini `k`/`nc` siz olib keladi, ya'ni nisbatni ikki xil
        // gaplar to'plamidan yig'adigan yagona manba.
        //
        // ⚠️ Markerning O'ZIDAN foydalanib bo'lmaydi: u bo'sh v1 ombori uchun
        // ham yoziladi, ya'ni har bir YANGI foydalanuvchida ham bor. Farqni
        // `META_KEY_MIXED_ERA_DAY` izohi batafsil yozadi.
        if (plan.days.length > 0) meta.put(dayNumber(at), META_KEY_MIXED_ERA_DAY)
        // Marker OXIRIDA: tranzaksiya atomik bo'lgani uchun tartib
        // to'g'rilikka ta'sir qilmaydi, lekin o'qiganda niyat shu tartibda
        // ko'rinadi — "hammasi yozildi, endi belgilandi".
        meta.put(at, META_KEY_V1_MIGRATED_AT)

        collect(true)
      }
    },
    // `guard.onsuccess` chiqmasa hech narsa yozilmagan bo'ladi — `false` aynan
    // shu ma'noni beradi ("marker bor edi / yozilmadi").
    false,
  )
}

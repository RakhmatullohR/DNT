// Seans chegaralari (PLAN §7): "20 gap yoki 10 daqiqa — qaysi biri oldin tugasa".
//
// Bu fayl ATAYLAB sof: DOM yo'q, `Date.now()` yo'q, React yo'q. Vaqt chaqiruvchidan
// keladi, shuning uchun qoidani testda soatni kutmasdan tekshirib bo'ladi.
//
// Qoida kod ichida tarqalib ketmasligi kerak edi: chegara ikki joyda (gap tugaganda
// va taymer tikkillaganda) tekshiriladi, ikkalasi ham AYNAN shu funksiyaga tayanadi.

/** Bir seansdagi maksimal gaplar soni (PLAN §7). */
export const SESSION_MAX_SENTENCES = 200

/** Bir seansning maksimal davomiyligi (ms) — 10 daqiqa (PLAN §7). */
export const SESSION_MAX_MS = 600 * 60_000

/**
 * Seansni tugatish vaqti keldimi.
 *
 * `done` — shu seansda ORTDA QOLGAN gaplar soni (tugatilgani ham, `Escape` bilan
 * tashlangani ham): ikkalasi ham seansning hajmini yeydi.
 * `elapsedMs` — seans boshlangan (birinchi bosish) paytdan beri o'tgan vaqt.
 *
 * `NaN`/`Infinity` 0 deb qabul qilinadi: buzuq raqam seansni birinchi bosishdayoq
 * tugatib yuborishi mumkin edi.
 */
export function sessionShouldEnd(done: number, elapsedMs: number): boolean {
  const sentences = Number.isFinite(done) ? done : 0
  const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : 0
  if (sentences >= SESSION_MAX_SENTENCES) return true
  return elapsed >= SESSION_MAX_MS
}

/**
 * Seans dars ichidagi qaysi gapdan boshlanadi.
 *
 * `>= total` NOL ga aylantiriladi, `total - 1` ga emas. Sabab: `store/lessons.ts`
 * dagi `clampProgress` `sentences.length` qiymatini ATAYLAB saqlaydi — u "dars
 * tugadi" belgisi. Belgi oxirgi gapga qaytarilsa, tugagan darsni ochish o'sha
 * gapni yana yozdirardi, u tugagach progress yana `total` bo'lardi va
 * natijalar -> "Davom ettirish" -> o'sha gap halqasi cheksiz aylanardi, har
 * aylanishda statistikaga bir gaplik seans yozib. Tugagan dars boshidan
 * boshlanadi — Home ekrani ham aynan shunday qiladi.
 *
 * Qoida hook ichida emas, shu yerda turadi: `useTypingSession` React va
 * marshrutizatorni tortadi, ya'ni u yerda qoida testda mixlanmay qolardi.
 */
export function clampIndex(value: number, total: number): number {
  const index = Math.floor(value)
  if (!Number.isFinite(index) || index < 0) return 0
  return index >= total ? 0 : index
}

/**
 * Seans qaysi gapdan boshlanadi — TASHLANGAN gaplarni ham hisobga olib.
 *
 * `clampIndex` ning ustidagi bitta qoida: dars OXIRIGA yetgan bo'lsa
 * (`progress >= total`) va `Escape` bilan tashlangan gaplar qolgan bo'lsa,
 * seans boshidan emas, o'sha tashlanganlarning ENG KICHIGIDAN boshlanadi.
 *
 * Nega aynan shunday, ya'ni nega "tashlangan gapda progress oldinga surilmasin"
 * degan soddaroq qoida EMAS: unda keyingi har bir seans o'sha ataylab tashlangan
 * gapga qaytaverardi va undan chiqishning yagona yo'li uni yozib tugatish
 * bo'lardi — ya'ni "tashlash" umuman ishlamay qolardi. Bu yerda esa gap
 * seans oqimini to'xtatmaydi, faqat dars oxirida navbatga qaytadi.
 *
 * Eng kichigidan boshlanishi yetarli: qolgan tashlangan gaplar undan KEYIN
 * turadi, ya'ni seans oldinga yurib ularning ustidan baribir o'tadi.
 *
 * Yaroqsiz indekslar (manfiy, kasr, `total` dan katta, `NaN`) e'tiborsiz
 * qoldiriladi: ro'yxat `localStorage` dan keladi va ishonchsiz.
 */
export function nextSentenceIndex(
  progress: number,
  total: number,
  skipped: readonly number[] = [],
): number {
  const start = clampIndex(progress, total)
  const value = Math.floor(progress)
  // `Infinity`/`NaN` "dars tugadi" belgisi emas — buzuq qiymat oddiy yo'lga tushadi.
  if (total <= 0 || !Number.isFinite(value) || value < total) return start

  let smallest = -1
  for (const raw of skipped) {
    const index = Math.floor(raw)
    if (!Number.isFinite(index) || index < 0 || index >= total) continue
    if (smallest === -1 || index < smallest) smallest = index
  }
  return smallest === -1 ? start : smallest
}

/**
 * Seansda ROSTDAN yozilgan gap bormi — bo'sh seans darvozasi shu javobga tayanadi (PLAN §7).
 *
 * `skipped` (Escape) yozuvlar seans HAJMINI yeydi (`sessionShouldEnd` dagi `done`),
 * lekin yig'indiga kirmaydi (PLAN §6a). Ya'ni faqat yozuvlar SONIGA qaralsa, hammasi
 * Escape bilan tashlangan seans ham "bo'sh emas" ko'rinardi va omborga `activeMs: 0`,
 * `netWpm: 0`, `accuracy: 0` bo'lgan seans yozilardi — PLAN oldini olmoqchi bo'lgan
 * aynan o'sha ifloslanish.
 *
 * Argument ataylab MINIMAL strukturaviy tip: `core` `store` ga bog'lanmaydi (PLAN §1).
 */
export function hasWrittenSentence(records: readonly { skipped: boolean }[]): boolean {
  return records.some((record) => !record.skipped)
}

// ---------------------------------------------------------------------------
// Gap darajasidagi yozuv shartnomasi (docs/stats-longterm.md §8.2)
// ---------------------------------------------------------------------------

/** `planSentenceWrite` qaytaradigan qaror. */
export type SentenceWritePlan<T> = {
  /** AYNAN SHU chaqiruvda, BITTA tranzaksiyada yoziladigan gaplar — tartibda. */
  write: readonly T[]
  /** Keyingi chaqiruvga o'tadigan bufer. */
  pending: readonly T[]
  /** Shu chaqiruvdan keyin seansda rostdan yozilgan gap bormi. */
  hasWritten: boolean
}

/**
 * ⭐ Gap tugaganda NIMA yozilishini hal qiladi (`docs/stats-longterm.md` §8.2.5).
 *
 * Muammo: ombor endi seans oxirida emas, HAR GAPDA yoziladi (§8) — shunda
 * `pagehide` da yo'qotish blast radiusi butun seansdan bitta gapga tushadi.
 * Lekin bu PLAN §7 dagi bo'sh seans darvozasi bilan to'qnashadi: hammasi
 * `Escape` bilan tashlangan seans HECH NARSA yozmasligi kerak, va bu qoida
 * test bilan mixlangan (`hasWrittenSentence`).
 *
 * Yechim — buferlash. Birinchi YOZILGAN gap paydo bo'lgunicha tashlangan
 * gaplar ushlab turiladi va o'sha gap bilan BIRGA quyiladi; seans butunlay
 * tashlangan holda tugasa bufer shunchaki tashlanadi (chaqiruvchi uni
 * yozmaydi — bu yerda alohida funksiya kerak emas).
 *
 * ⚠️ Bufer BITTA gap emas, KETMA-KET KELGAN BARCHA tashlangan gaplar uchun.
 * "Faqat oxirgisini ushlab turish" varianti sinovdan o'tmaydi: foydalanuvchi
 * ketma-ket uchta gapni tashlab, keyin to'rtinchisini yozsa, birinchi ikkitasi
 * jimgina yo'qolardi va seansdagi gaplar soni yozuv bilan kelishmay qolardi.
 *
 * Birinchi yozilgan gapdan KEYIN buferlash to'xtaydi: o'shandan boshlab har
 * gap (tashlangani ham) darhol yoziladi. Tashlangan gap seans yozuviga kiradi,
 * lekin kunlik/so'z/umrbod hisoblagichlarga HISSA QO'SHMAYDI — bu qoida yozuv
 * qatlamida, bu yerda emas.
 *
 * SOF: kiruvchi massivlar o'zgartirilmaydi, yangi qaror qaytariladi.
 */
export function planSentenceWrite<T extends { skipped: boolean }>(
  pending: readonly T[],
  hasWritten: boolean,
  record: T,
): SentenceWritePlan<T> {
  // Darvoza allaqachon ochilgan — buferlashning ma'nosi qolmadi.
  if (hasWritten) return { write: [record], pending: [], hasWritten: true }

  // Hali bitta ham gap yozilmagan va bu ham tashlangan: ushlab turamiz.
  if (record.skipped) return { write: [], pending: [...pending, record], hasWritten: false }

  // Birinchi YOZILGAN gap — bufer u bilan birga, BITTA tranzaksiyada quyiladi.
  return { write: [...pending, record], pending: [], hasWritten: true }
}

/** `wordDeltaOf` qaytaradigan bitta so'zning hissasi. */
export type WordDelta = { exposures: number; errors: number }

/** `wordDeltaOf` kutadigan minimal token shakli (`core/types.ts` dagi `Token` mos keladi). */
type WordToken = { kind: 'word' | 'gap'; text: string }

/**
 * ⭐ BITTA gapning so'z hissasi (`docs/stats-longterm.md` §8.1).
 *
 * ⚠️ Bu funksiya §13 dagi "eng jiddiy amalga oshirish xatari" ga qarshi turadi.
 * `useTypingSession` dagi `wordStatsRef` seans davomida KUMULYATIV yig'iladi
 * (`exposures: current.exposures + 1`), ya'ni uni har gapda omborga quysa
 * sonlar ko'payib ketardi: ikkinchi gapdan keyin birinchi gapning hissasi
 * IKKINCHI marta yozilardi. Gap darajasidagi yozuv DELTA talab qiladi, va
 * delta kumulyativ xaritadan ayirish bilan emas, gapning O'ZIDAN olinadi —
 * ayirish usuli bitta o'tkazib yuborilgan yangilanishda jimgina siljib ketardi.
 *
 * Kalitlar KICHIK HARFGA keltiriladi: `The` va `the` bitta yozuvga qo'shiladi,
 * chunki reyting so'zning o'zi haqida, uning gap boshida turgani haqida emas.
 *
 * Bitta gapda ikki marta uchragan so'z IKKI ta'sirlanish beradi — bu ataylab:
 * u rostdan ikki marta yozilgan.
 *
 * Xatolar `errorCounts` dan olinadi (kalit — TOKEN indeksi, so'z indeksi emas).
 *
 * ⚠️ **HAR TA'SIRLANISH UCHUN KO'PI BILAN BITTA XATO** (`min(…, 1)`), klavish
 * darajasidagi yig'indi EMAS. Ya'ni `errors` = "bu so'z necha marta XATO BILAN
 * yozilgan". Qisqich AYNAN shu yerda, MANBADA turishi shart:
 *
 *   - Ombor darajasida qisqartirish (`errors > exposures ? exposures : errors`)
 *     TARTIBGA BOG'LIQ bo'lib qoladi: ayni mashq tarixi seanslar tartibiga
 *     qarab 17% yoki 50% beradi, va buzilish qaytarib bo'lmaydigan UMRBOD
 *     hisoblagichda sodir bo'ladi (`PLAN.md` §11.3, 10-invariant).
 *   - Xato OG'IRLIGI (nechta harf) baribir saqlanmasdi — ombor qisqichi uni
 *     allaqachon yo'q qilardi: `{e:1,x:1}×10` va `{e:1,x:5}×10` bir xil qatorga
 *     tushardi.
 *   - `docs/stats-longterm.md` §6.3 dagi `estimateBeta` `p_i` ni BINOMIAL ULUSH
 *     deb modellaydi — bu faqat shu birlikda ma'noga ega.
 *
 * Qisqich TOKEN bo'yicha qo'llanadi, so'z bo'yicha yig'indiga emas: bitta gapda
 * ikki marta uchragan va ikkalasida ham xato qilingan so'z `{exposures:2,
 * errors:2}` beradi — `errors <= exposures` shundagina QURILISH bo'yicha
 * o'rinli bo'ladi.
 */
export function wordDeltaOf(
  tokens: readonly WordToken[],
  errorCounts: ReadonlyMap<number, number>,
): Map<string, WordDelta> {
  const delta = new Map<string, WordDelta>()

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === undefined || token.kind !== 'word') continue

    const key = token.text.toLowerCase()
    const current = delta.get(key)
    // `min(…, 1)` — bitta ta'sirlanish ko'pi bilan bitta xato beradi (yuqoridagi izoh).
    const errors = (errorCounts.get(i) ?? 0) > 0 ? 1 : 0
    if (current === undefined) delta.set(key, { exposures: 1, errors })
    else delta.set(key, { exposures: current.exposures + 1, errors: current.errors + errors })
  }

  return delta
}

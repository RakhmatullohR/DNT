// Seans chegaralari (PLAN §7): "20 gap yoki 10 daqiqa — qaysi biri oldin tugasa".
//
// Bu fayl ATAYLAB sof: DOM yo'q, `Date.now()` yo'q, React yo'q. Vaqt chaqiruvchidan
// keladi, shuning uchun qoidani testda soatni kutmasdan tekshirib bo'ladi.
//
// Qoida kod ichida tarqalib ketmasligi kerak edi: chegara ikki joyda (gap tugaganda
// va taymer tikkillaganda) tekshiriladi, ikkalasi ham AYNAN shu funksiyaga tayanadi.

/** Bir seansdagi maksimal gaplar soni (PLAN §7). */
export const SESSION_MAX_SENTENCES = 20

/** Bir seansning maksimal davomiyligi (ms) — 10 daqiqa (PLAN §7). */
export const SESSION_MAX_MS = 10 * 60_000

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

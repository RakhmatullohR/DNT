// Statistika hisoblagichlari (PLAN §6).
// Sof funksiyalar: DOM, audio, tarmoq va localStorage bilan ishlamaydi.
// Vaqt manbai — DOIM `state.activeMs`: `IDLE_PAUSE_MS` (5 s) dan uzun tanaffuslar
// u yerga allaqachon qo'shilmagan, shuning uchun bu yerda qayta filtrlash SHART EMAS.

import type { TypingState } from './types.ts'

/** Standart WPM ta'rifi bo'yicha bitta "so'z" shartli ravishda 5 ta belgi. */
const CHARS_PER_WORD = 5

/** Bir daqiqadagi millisekundlar. */
const MS_PER_MINUTE = 60_000

export type Metrics = {
  /** Faol yozuv vaqti (ms) — uzun tanaffuslar chiqarib tashlangan. */
  activeMs: number
  /** (to'g'ri belgilar / 5) / daqiqa. */
  netWpm: number
  /** (jami bosishlar / 5) / daqiqa. */
  rawWpm: number
  /** To'g'ri bosishlar / jami bosishlar; 0..1 oralig'ida. */
  accuracy: number
  keystrokes: number
  correctKeystrokes: number
  /** `keystrokes - correctKeystrokes`; hech qachon manfiy bo'lmaydi. */
  errors: number
}

/**
 * Manfiy son, `NaN` va `Infinity` ni 0 ga keltiradi.
 * UI ga chiqadigan har bir raqam cheklangan bo'lishi kerak — aks holda ekranda
 * "NaN wpm" yoki "Infinity" ko'rinadi va butun statistika paneli buziladi.
 */
function safeCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Net WPM — faqat to'g'ri yozilgan belgilar hisobga olinadi.
 * `activeMs === 0` bo'lsa 0 qaytaradi (nolga bo'linish -> Infinity/NaN bo'lmasin).
 */
export function netWpm(correctChars: number, activeMs: number): number {
  const chars = safeCount(correctChars)
  const ms = safeCount(activeMs)
  if (ms === 0) return 0
  // (chars / 5) / (ms / 60000) bilan bir xil, lekin bitta bo'linish —
  // oraliq yaxlitlash xatosi kamayadi: 250 belgi / 60000 ms aynan 50 beradi.
  return (chars * MS_PER_MINUTE) / (CHARS_PER_WORD * ms)
}

/**
 * Raw WPM — xato bosishlar ham qo'shilgan jami tezlik.
 * `activeMs === 0` bo'lsa 0 qaytaradi.
 */
export function rawWpm(keystrokes: number, activeMs: number): number {
  const keys = safeCount(keystrokes)
  const ms = safeCount(activeMs)
  if (ms === 0) return 0
  return (keys * MS_PER_MINUTE) / (CHARS_PER_WORD * ms)
}

/**
 * Aniqlik — to'g'ri bosishlarning jami bosishlarga nisbati.
 * Hali hech narsa bosilmagan bo'lsa (`total === 0`) 1 qaytadi:
 * boshlanmagan mashqni "0% aniqlik" deb ko'rsatish noto'g'ri bo'lardi.
 * Natija doim 0..1 oralig'ida cheklanadi.
 */
export function accuracyOf(correct: number, total: number): number {
  const all = safeCount(total)
  if (all === 0) return 1
  const ok = safeCount(correct)
  const value = ok / all
  return value > 1 ? 1 : value
}

/**
 * Yozuv holatidan to'liq statistika to'plamini hisoblaydi.
 *
 * Net WPM uchun "to'g'ri belgilar" = `s.typed.length`. `block` rejimida `typed`
 * doim `target.slice(0, cursor)` ga teng, ya'ni bu haqiqatan ekranga chiqqan
 * to'g'ri belgilar soni. `correctKeystrokes` esa boshqa narsa — backspace'dan
 * keyin qayta yozilgan harf u yerda ikki marta sanaladi, shuning uchun u
 * tezlik emas, faqat ANIQLIK uchun ishlatiladi.
 *
 * Qiymatlar yaxlitlanmaydi — yaxlitlashni UI qatlami bajaradi.
 */
export function computeMetrics(s: TypingState): Metrics {
  const activeMs = safeCount(s.activeMs)
  const keystrokes = safeCount(s.keystrokes)
  // To'g'ri bosishlar jami bosishlardan ko'p bo'lib qolmasin — `errors` manfiy chiqmasligi uchun.
  const correctKeystrokes = Math.min(safeCount(s.correctKeystrokes), keystrokes)
  const correctChars = safeCount(s.typed.length)

  return {
    activeMs,
    netWpm: netWpm(correctChars, activeMs),
    rawWpm: rawWpm(keystrokes, activeMs),
    accuracy: accuracyOf(correctKeystrokes, keystrokes),
    keystrokes,
    correctKeystrokes,
    errors: keystrokes - correctKeystrokes,
  }
}

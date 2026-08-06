// Yozuv dvigateli (PLAN §4) — SOF reducer: audio yo'q, DOM yo'q, `Date.now()` yo'q.
//
// Vaqt faqat `now` parametri orqali kiradi, shuning uchun testlar soatni to'liq
// boshqaradi. Holat HECH QACHON mutatsiya qilinmaydi: har o'zgarishda yangi
// obyekt, yangi `Map` va yangi `Set` qaytariladi.
//
// Rejim — `block` (PLAN §4): noto'g'ri belgida kursor SILJIMAYDI. `forgiving`
// v1 ga kiritilmagan, chunki unda kursor so'z boshidan noto'g'ri harf bilan
// o'tib ketardi va o'sha so'z ovozi hech qachon chiqmasdi.

import type { Effect, Token, TypingEvent, TypingState } from './types.ts'
import { IDLE_PAUSE_MS } from './types.ts'
import { tokenize } from './tokenize.ts'

/** `reduce` qaytaradigan juftlik: yangi holat va u chiqargan effektlar. */
export type ReduceResult = { state: TypingState; effects: Effect[] }

/**
 * Gap uchun toza boshlang'ich holat.
 *
 * `Tab` bilan qayta boshlash aynan shu funksiyani qayta chaqirish demakdir:
 * `playedWords` bo'shaydi va gapning barcha so'zlari yana o'qiladi (PLAN §4).
 */
export function createState(target: string): TypingState {
  return {
    target,
    tokens: tokenize(target),
    cursor: 0,
    typed: [],
    errorCounts: new Map(),
    charErrors: new Map(),
    pendingWords: new Set(),
    playedWords: new Set(),
    keystrokes: 0,
    correctKeystrokes: 0,
    startedAt: null,
    lastKeyAt: null,
    activeMs: 0,
    finishedAt: null,
  }
}

/**
 * Yagona kirish nuqtasi. `now` — chaqiruvchi bergan vaqt (ms).
 *
 * `char`/`backspace` gap tugagandan keyin holatni O'ZGARTIRMAYDI.
 * `playbackStarted`/`playbackFailed` esa tugagandan keyin ham qabul qilinadi:
 * oxirgi so'z audiosi gap tugagandan keyin ham xabar berishi mumkin.
 */
export function reduce(s: TypingState, e: TypingEvent, now: number): ReduceResult {
  switch (e.type) {
    case 'char':
      return reduceChar(s, e.char, now)
    case 'backspace':
      return reduceBackspace(s, now)
    case 'playbackStarted':
      return reducePlaybackStarted(s, e.tokenIndex)
    case 'playbackFailed':
      return reducePlaybackFailed(s, e.tokenIndex)
  }
}

// ---------------------------------------------------------------------------
// Belgi bosish
// ---------------------------------------------------------------------------

function reduceChar(s: TypingState, char: string, now: number): ReduceResult {
  if (s.finishedAt !== null) return { state: s, effects: [] }

  const expected = s.target[s.cursor]
  // Kursor matn oxirida bo'lsa kutilayotgan belgi yo'q — bosishlar e'tiborsiz.
  if (expected === undefined) return { state: s, effects: [] }

  const timing = advanceClock(s, now)

  // Bosh harf QAT'IY: `t` va `T` teng emas (PLAN §4 "Chegaraviy holatlar").
  if (char !== expected) {
    const charErrors = new Map(s.charErrors)
    charErrors.set(s.cursor, (charErrors.get(s.cursor) ?? 0) + 1)

    const errorCounts = new Map(s.errorCounts)
    const tokenIndex = tokenIndexAt(s.tokens, s.cursor)
    if (tokenIndex !== -1) {
      errorCounts.set(tokenIndex, (errorCounts.get(tokenIndex) ?? 0) + 1)
    }

    return {
      // Kursor SILJIMAYDI, `typed` ham o'zgarmaydi.
      state: { ...s, ...timing, keystrokes: s.keystrokes + 1, errorCounts, charErrors },
      effects: [],
    }
  }

  const effects: Effect[] = []
  const cursor = s.cursor + 1

  // ⭐ Qoida `token.start` ga tayanadi, `cursor === 0` ga EMAS: `"The cat`
  // holatida birinchi so'z 1-indeksdan boshlanadi (PLAN §4).
  let pendingWords = s.pendingWords
  const wordIndex = wordTokenStartingAt(s.tokens, s.cursor)
  if (wordIndex !== -1 && !s.playedWords.has(wordIndex) && !s.pendingWords.has(wordIndex)) {
    pendingWords = new Set(s.pendingWords)
    pendingWords.add(wordIndex)
    effects.push({ type: 'playWord', tokenIndex: wordIndex })
  }

  const finished = cursor >= s.target.length
  if (finished) effects.push({ type: 'finished' })

  return {
    state: {
      ...s,
      ...timing,
      cursor,
      typed: [...s.typed, char],
      keystrokes: s.keystrokes + 1,
      correctKeystrokes: s.correctKeystrokes + 1,
      pendingWords,
      finishedAt: finished ? now : s.finishedAt,
    },
    effects,
  }
}

// ---------------------------------------------------------------------------
// Backspace
// ---------------------------------------------------------------------------

/**
 * Kursorni bitta ortga qaytaradi.
 *
 * ATAYLAB qilinmaydigan uchta narsa (PLAN §4):
 * - `errorCounts` / `charErrors` TOZALANMAYDI — xato qilingani qilingan;
 * - `keystrokes` OSHMAYDI — tuzatish urinish sifatida sanalmaydi;
 * - `playedWords` / `pendingWords` ga TEGILMAYDI — so'zni qayta yozganda
 *   ovoz takrorlanmaydi.
 */
function reduceBackspace(s: TypingState, now: number): ReduceResult {
  if (s.finishedAt !== null) return { state: s, effects: [] }

  // Bosish bo'lgani uchun taymer baribir yuritiladi (PLAN §6: taymer birinchi bosishda).
  const timing = advanceClock(s, now)

  if (s.cursor === 0) return { state: { ...s, ...timing }, effects: [] }

  return {
    state: { ...s, ...timing, cursor: s.cursor - 1, typed: s.typed.slice(0, -1) },
    effects: [],
  }
}

// ---------------------------------------------------------------------------
// ⭐ Ovoz zanjiri: so'z "o'qilgan" deb ovoz CHIQQANDA belgilanadi
// ---------------------------------------------------------------------------

/** Ovoz haqiqatan boshlandi — token endi qayta o'qilmaydi. */
function reducePlaybackStarted(s: TypingState, tokenIndex: number): ReduceResult {
  if (s.playedWords.has(tokenIndex) && !s.pendingWords.has(tokenIndex)) {
    return { state: s, effects: [] }
  }

  const pendingWords = new Set(s.pendingWords)
  pendingWords.delete(tokenIndex)
  const playedWords = new Set(s.playedWords)
  playedWords.add(tokenIndex)

  return { state: { ...s, pendingWords, playedWords }, effects: [] }
}

/**
 * ⭐ Tuzatishning butun mohiyati: ovoz chiqmadi — token `pendingWords` dan
 * chiqariladi, lekin `playedWords` ga TUSHMAYDI. Ya'ni o'sha so'z keyinroq
 * (masalan `Tab` dan keyin yoki qayta yozilganda) yana o'qilishi mumkin.
 * Jimlik "eshitilgan" deb hisoblanmaydi.
 */
function reducePlaybackFailed(s: TypingState, tokenIndex: number): ReduceResult {
  if (!s.pendingWords.has(tokenIndex)) return { state: s, effects: [] }

  const pendingWords = new Set(s.pendingWords)
  pendingWords.delete(tokenIndex)

  return { state: { ...s, pendingWords }, effects: [] }
}

// ---------------------------------------------------------------------------
// Yordamchilar
// ---------------------------------------------------------------------------

/** `advanceClock` qaytaradigan vaqt maydonlari. */
type Clock = Pick<TypingState, 'startedAt' | 'lastKeyAt' | 'activeMs'>

/**
 * Taymer birinchi bosishda boshlanadi; bosishlar orasi `IDLE_PAUSE_MS` dan
 * oshsa, o'sha oraliq faol vaqtga QO'SHILMAYDI — taymer pauza qilgan bo'ladi
 * (PLAN §6).
 */
function advanceClock(s: TypingState, now: number): Clock {
  let activeMs = s.activeMs
  if (s.lastKeyAt !== null) {
    const delta = now - s.lastKeyAt
    if (delta >= 0 && delta <= IDLE_PAUSE_MS) activeMs += delta
  }
  return { startedAt: s.startedAt ?? now, lastKeyAt: now, activeMs }
}

/**
 * Aynan `pos` dan boshlanadigan `word` tokeni indeksi, topilmasa `-1`.
 * Ovoz shu tekshiruv orqali chiqadi — so'zning BIRINCHI harfida.
 */
function wordTokenStartingAt(tokens: Token[], pos: number): number {
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]
    if (t === undefined) continue
    if (t.start > pos) break
    if (t.kind === 'word' && t.start === pos) return i
  }
  return -1
}

/**
 * Kursor turgan — yoki undan OLDINGI eng yaqin — `word` tokeni indeksi;
 * gapda birorta so'z bo'lmasa `-1`.
 *
 * Qayta eshitish (`Ctrl+Space`) shu tanlovga tayanadi. "Oldingi" tarmog'i shart:
 * so'zni yozib bo'lgan zahoti kursor probel ustida turadi, foydalanuvchi esa
 * AYNAN o'sha, hozirgina yozgan so'zni eshitmoqchi bo'ladi. Kursor gap oxiriga
 * yetganda ham oxirgi so'z qaytadi.
 *
 * Modul sof bo'lgani uchun funksiya shu yerda: hook faqat tokenlarni beradi.
 */
export function wordTokenAt(tokens: Token[], pos: number): number {
  let found = -1
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]
    if (t === undefined) continue
    if (t.start > pos) break
    if (t.kind !== 'word') continue
    found = i
    // Kursor AYNAN shu so'z ichida — oldinga qarashning hojati yo'q.
    if (pos < t.end) break
  }
  return found
}

/**
 * `pos` qaysi tokenga tegishli — xato hisobi shu tokenga yoziladi.
 * `pos` hech bir tokenning ichida bo'lmasa, undan KEYINGI birinchi token olinadi;
 * u ham bo'lmasa `-1`.
 */
function tokenIndexAt(tokens: Token[], pos: number): number {
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]
    if (t === undefined) continue
    if (pos < t.end) return i
  }
  return -1
}

// Barcha core modullar uchun YAGONA tip manbai.
// Bu fayl shartnoma: modullar bir-birining ichki tuzilishiga emas, shu yerga tayanadi.

export type TokenKind = 'word' | 'gap'

export type Token = {
  kind: TokenKind
  /** Gapdan aynan kesib olingan matn: `target.slice(start, end)` ga teng. */
  text: string
  /** Gap ichidagi boshlanish indeksi (inclusive). */
  start: number
  /** Gap ichidagi tugash indeksi (exclusive). */
  end: number
  /**
   * Token butunlay katta harfdan iborat va uzunligi >= 2 (`US`, `NASA`).
   * Faqat `kind === 'word'` uchun ma'noga ega — qolganida doim `false`.
   */
  caps: boolean
}

export type Key = { type: 'char'; char: string } | { type: 'backspace' }

export type TypingEvent =
  | Key
  | { type: 'playbackStarted'; tokenIndex: number }
  | { type: 'playbackFailed'; tokenIndex: number }

export type Effect = { type: 'playWord'; tokenIndex: number } | { type: 'finished' }

export type TypingState = {
  /** Normallashtirilgan, bo'shliqlari siqilgan gap. */
  target: string
  tokens: Token[]
  /** Keyingi kutilayotgan belgi indeksi. `block` rejimida faqat to'g'ri bosishda oshadi. */
  cursor: number
  /** Yozilgan belgilar; `block` rejimida doim `target.slice(0, cursor)` ga teng. */
  typed: string[]
  /** tokenIndex -> shu token ichida qilingan xatolar soni. */
  errorCounts: Map<number, number>
  /** charIndex -> shu pozitsiyada qilingan xatolar soni. */
  charErrors: Map<number, number>
  /** `playWord` yuborilgan, lekin ovoz hali chiqqani tasdiqlanmagan tokenlar. */
  pendingWords: Set<number>
  /** Ovozi HAQIQATAN chiqqani tasdiqlangan tokenlar — qayta o'qilmaydi. */
  playedWords: Set<number>
  keystrokes: number
  correctKeystrokes: number
  /** Birinchi bosish vaqti; hali bosilmagan bo'lsa `null`. */
  startedAt: number | null
  lastKeyAt: number | null
  /**
   * Faol yozuv vaqti (ms). Bosishlar orasi `IDLE_PAUSE_MS` dan oshsa,
   * o'sha oraliq QO'SHILMAYDI — taymer pauza qilgan hisoblanadi.
   */
  activeMs: number
  finishedAt: number | null
}

/** Bosishlar orasidagi shu qiymatdan uzun tanaffus faol vaqtga qo'shilmaydi. */
export const IDLE_PAUSE_MS = 5_000

/** Klaviatura adapteri chiqaradigan yuqori darajali harakat. */
export type KeyAction =
  | { type: 'event'; event: Key }
  /** `Enter` — gap tugagan bo'lsa keyingisiga o'tish. */
  | { type: 'next' }
  /** `Tab` — joriy gapni qayta boshlash. */
  | { type: 'restart' }
  /** `Escape` — gapni tashlab ketish (statistikaga kirmaydi). */
  | { type: 'skip' }
  /**
   * `Ctrl+Space` — joriy so'zni QAYTA eshitish.
   *
   * Alohida harakat, `event` EMAS: qayta eshitish reducer'dan o'tmasligi kerak.
   * `playedWords`/`pendingWords`/`keystrokes` ga tegilsa quloq uchun bosilgan
   * tugma statistikani va ovoz zanjirini o'zgartirib yuborardi.
   */
  | { type: 'replay' }
  | { type: 'ignore' }

/** `mapKeydown` uchun DOM'siz kirish — testlarda oddiy obyekt beriladi. */
export type KeydownLike = {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  isComposing: boolean
}

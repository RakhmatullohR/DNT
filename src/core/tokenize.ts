// Gapni tokenlarga bo'ladi: `word` (ovozi bor) va `gap` (ovozi yo'q, lekin yoziladi).
//
// Kirish ma'lumoti `normalize.ts` dan keladi, ya'ni kafolatlangan ASCII (0x20-0x7E).
// Shuning uchun `[A-Za-z]` yetarli — `naive`/`cafe` allaqachon diakritikasiz.

import type { Token } from './types.ts'

/**
 * So'z shakli (PLAN §3): harflar ketma-ketligi, ichida apostrof yoki tire bilan
 * ulangan bo'laklar bo'lishi mumkin — `don't`, `it's`, `well-known`.
 *
 * Apostrof va tire SO'Z ICHIDA saqlanadi, shuning uchun `don't` va `don-t`
 * turli fayllarga tushadi. So'z oxiridagi yolg'iz `'` yoki `-` esa so'zga
 * KIRMAYDI (ular ortidan harf kelishi shart) va `gap` bo'lib qoladi.
 *
 * Bayroqsiz eksport qilinadi: `lastIndex` holati chaqiruvchilar orasida
 * sizib o'tmasligi uchun `tokenize` ichkarida alohida global nusxadan foydalanadi.
 */
export const WORD_RE = /[A-Za-z]+(?:['-][A-Za-z]+)*/

/** `tokenize` ning ichki, faqat shu modulga tegishli global nusxasi. */
const WORD_RE_GLOBAL = new RegExp(WORD_RE.source, 'g')

/** Butunlay katta harfdan iborat, uzunligi >= 2 bo'lgan qisqartma: `US`, `NASA`. */
const CAPS_RE = /^[A-Z]{2,}$/

/**
 * Gapni uzluksiz tokenlar ketma-ketligiga aylantiradi.
 *
 * Kafolatlar (testlar bilan qoplangan):
 * - `tokens[0].start === 0`, har bir keyingi `token.start` oldingi `token.end` ga teng,
 *   oxirgi `token.end === sentence.length` — teshik ham, ustma-ust tushish ham yo'q;
 * - bo'sh token qaytarilmaydi (`end > start` doim);
 * - `token.text === sentence.slice(token.start, token.end)`;
 * - bo'sh gap uchun bo'sh massiv.
 *
 * So'zdan boshqa hamma narsa — bo'shliq, tinish belgisi va RAQAM — `gap` bo'ladi.
 * Raqamlar (`$1.50`, `2024`) ataylab `gap`: ovozi yo'q, lekin yozish shart (PLAN §3).
 */
export function tokenize(sentence: string): Token[] {
  const tokens: Token[] = []
  // Oldingi token qayerda tugagani — keyingi `gap` shu joydan boshlanadi.
  let gapStart = 0

  WORD_RE_GLOBAL.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WORD_RE_GLOBAL.exec(sentence)) !== null) {
    const text = match[0]
    const start = match.index
    const end = start + text.length

    // So'zdan oldingi bo'sh bo'lmagan oraliq.
    if (start > gapStart) {
      tokens.push(gapToken(sentence, gapStart, start))
    }

    tokens.push({
      kind: 'word',
      text,
      start,
      end,
      caps: CAPS_RE.test(text),
    })

    gapStart = end
  }

  // Oxirgi so'zdan keyingi quyruq: tinish belgisi, bo'shliq yoki butun gap so'zsiz bo'lsa.
  if (gapStart < sentence.length) {
    tokens.push(gapToken(sentence, gapStart, sentence.length))
  }

  return tokens
}

/** `gap` tokeni: `caps` u yerda ma'noga ega emas, doim `false`. */
function gapToken(sentence: string, start: number, end: number): Token {
  return {
    kind: 'gap',
    text: sentence.slice(start, end),
    start,
    end,
    caps: false,
  }
}

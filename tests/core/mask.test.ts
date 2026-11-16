// `src/core/mask.ts` testlari — bosh harf rejimining QOIDASI.
//
// Modul sof funksiya, shuning uchun testlar aynan qoidani o'lchaydi:
// yashiriladigan narsa — so'zning birinchi harfidan boshqa HARFLARI, va faqat
// ular. Chizuvchi tomon (`Practice.tsx`) bu yerda tekshirilmaydi: u to'plamdan
// `visibility: hidden` yasaydi, xolos.

import { describe, expect, it } from 'vitest'

import { maskedIndexes } from '../../src/core/mask.ts'
import { tokenize } from '../../src/core/tokenize.ts'
import type { Token } from '../../src/core/types.ts'

/**
 * Yashirilgan pozitsiyalarni `·` bilan almashtirib, natijani KO'RINADIGAN
 * qilib qaytaradi — indekslar ro'yxatini solishtirish testni o'qib bo'lmaydigan
 * holga keltirardi.
 */
function mask(sentence: string): string {
  const hidden = maskedIndexes(tokenize(sentence))
  return sentence
    .split('')
    .map((char, index) => (hidden.has(index) ? '·' : char))
    .join('')
}

describe('maskedIndexes', () => {
  it("har so'zning birinchi harfi ochiq qoladi", () => {
    expect(mask('The cat sat on the mat.')).toBe('T·· c·· s·· o· t·· m··.')
  })

  it('tinish belgisi va probel yashirilmaydi', () => {
    // Ular `gap` tokenida va OVOZI YO'Q (PLAN §3) — ko'rinmasa taxmin qilishdan
    // boshqa yo'l qolmasdi, ilova esa noto'g'ri belgida kursorni to'xtatadi.
    expect(mask('Hello, world!')).toBe('H····, w····!')
    expect(mask('"Go," he said.')).toBe('"G·," h· s···.')
  })

  it('raqamlar yashirilmaydi', () => {
    // `2024` va `$1.50` — `gap`, ya'ni ovozsiz.
    expect(mask('In 2024 it cost $1.50.')).toBe('I· 2024 i· c··· $1.50.')
  })

  it("so'z ICHIDAGI apostrof va tire ko'rinadi", () => {
    // Ular `word` tokenining ichida, lekin quloq ularni ajratmaydi.
    expect(mask("don't")).toBe("d··'·")
    expect(mask('well-known')).toBe('w···-·····')
  })

  it('bir harfli so\'zda yashiradigan narsa yo\'q', () => {
    expect(mask('I a b')).toBe('I a b')
  })

  it("butunlay katta harfli qisqartma ham oddiy so'z kabi", () => {
    expect(mask('NASA and US')).toBe('N··· a·· U·')
  })

  it("so'zsiz gapda bo'sh to'plam qaytadi", () => {
    expect(maskedIndexes(tokenize('2024 — 100%')).size).toBe(0)
    expect(maskedIndexes(tokenize('')).size).toBe(0)
  })

  it('indekslar GAP ichidagi haqiqiy pozitsiyalar', () => {
    // `token.start + i` hisobining o'zi: ikkinchi so'zning harflari birinchi
    // so'znikidan siljigan bo'lishi kerak.
    const hidden = maskedIndexes(tokenize('ab cd'))

    expect([...hidden].sort((a, b) => a - b)).toEqual([1, 4])
  })

  it("`gap` tokeniga UMUMAN tegilmaydi — token turi qaror qiladi, matn emas", () => {
    // Tokenlar QO'LDA yasalgan: `tokenize` `gap` ichiga harf qo'ymaydi (har
    // qanday harf ketma-ketligi `word` bo'ladi), ya'ni bu holatni real gap
    // orqali yasab bo'lmaydi. Test shu sababdan bor — funksiyaning shartnomasi
    // "so'z tokenlari niqoblanadi", "harflar niqoblanadi" EMAS. `tokenize`
    // o'zgarsa (masalan raqamlar `word` bo'lib qolsa) bu farq ko'rinadigan
    // bo'ladi va o'shanda qoida bilinmasdan siljib ketmasligi kerak.
    const tokens: Token[] = [
      { kind: 'gap', text: 'abc', start: 0, end: 3, caps: false },
      { kind: 'word', text: 'de', start: 3, end: 5, caps: false },
    ]

    expect([...maskedIndexes(tokens)]).toEqual([4])
  })

  it("to'plam faqat harflarni saqlaydi — hech bir gap belgisi tushmaydi", () => {
    const sentence = "The dog's well-known bark, in 2024!"
    const hidden = maskedIndexes(tokenize(sentence))

    for (const index of hidden) {
      expect(/[A-Za-z]/.test(sentence[index] ?? '')).toBe(true)
    }
  })
})

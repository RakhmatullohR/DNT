import { describe, expect, it } from 'vitest'
import type { Token } from '../../src/core/types.ts'
import { WORD_RE, tokenize } from '../../src/core/tokenize.ts'

/**
 * Uzluksizlik invarianti — tokenizatorning eng muhim xossasi.
 *
 * Reducer kursorni `token.start` ga tayanib boshqaradi, shuning uchun tokenlar
 * gapni TESHIKSIZ qoplashi shart: bitta yo'qolgan belgi ham kursorni tokenlar
 * orasidagi bo'shliqqa tashlaydi va gap hech qachon tugamaydi.
 */
function tasdiqlaInvariant(sentence: string): Token[] {
  const tokens = tokenize(sentence)

  if (sentence.length === 0) {
    expect(tokens).toEqual([])
    return tokens
  }

  expect(tokens.length).toBeGreaterThan(0)

  let kutilganStart = 0
  let oldingiKind: Token['kind'] | null = null

  for (const t of tokens) {
    // Zanjir uzilmaydi: har bir token oldingisi tugagan joydan boshlanadi.
    expect(t.start).toBe(kutilganStart)
    // Bo'sh token bo'lmaydi.
    expect(t.end).toBeGreaterThan(t.start)
    // Matn har doim aynan kesib olingan bo'lak.
    expect(t.text).toBe(sentence.slice(t.start, t.end))
    // `caps` faqat `word` uchun ma'noga ega.
    if (t.kind === 'gap') expect(t.caps).toBe(false)
    // Bir xil turdagi ikkita token yonma-yon tursa, ular bitta bo'lishi kerak edi.
    expect(t.kind).not.toBe(oldingiKind)

    kutilganStart = t.end
    oldingiKind = t.kind
  }

  expect(kutilganStart).toBe(sentence.length)
  return tokens
}

/** Testlarda taqqoslashni o'qishli qilish uchun qisqa ko'rinish. */
function qisqa(tokens: Token[]): Array<[Token['kind'], string, number, number]> {
  return tokens.map((t) => [t.kind, t.text, t.start, t.end])
}

describe('WORD_RE', () => {
  it('bayroqsiz eksport qilinadi — `lastIndex` holati sizib o\'tmaydi', () => {
    expect(WORD_RE.global).toBe(false)
    expect(WORD_RE.lastIndex).toBe(0)
  })

  it('apostrof va tireni so\'z ICHIDA ushlaydi, chetida esa yo\'q', () => {
    expect("Don't".match(WORD_RE)?.[0]).toBe("Don't")
    expect('well-known'.match(WORD_RE)?.[0]).toBe('well-known')
    // Ortidan harf kelmagan apostrof/tire so'zga kirmaydi.
    expect("dogs'".match(WORD_RE)?.[0]).toBe('dogs')
    expect('stop-'.match(WORD_RE)?.[0]).toBe('stop')
  })
})

describe('tokenize — offsetlar (PLAN §9)', () => {
  it("`Don't stop - it's fine.` da offsetlar to'g'ri va qisqarishlar bitta token", () => {
    const sentence = "Don't stop - it's fine."
    const tokens = tasdiqlaInvariant(sentence)

    expect(qisqa(tokens)).toEqual([
      ['word', "Don't", 0, 5],
      ['gap', ' ', 5, 6],
      ['word', 'stop', 6, 10],
      ['gap', ' - ', 10, 13],
      ['word', "it's", 13, 17],
      ['gap', ' ', 17, 18],
      ['word', 'fine', 18, 22],
      ['gap', '.', 22, 23],
    ])

    // Yolg'iz turgan tire — `gap`, chunki ortidan harf emas, bo'shliq keladi.
    const words = tokens.filter((t) => t.kind === 'word').map((t) => t.text)
    expect(words).toEqual(["Don't", 'stop', "it's", 'fine'])
  })

  it("har bir token matni gapdan aynan kesib olingan bo'lakka teng", () => {
    const sentence = "Don't stop - it's fine."
    for (const t of tokenize(sentence)) {
      expect(t.text).toBe(sentence.slice(t.start, t.end))
    }
  })
})

describe('tokenize — caps', () => {
  it("`US` bitta token va `caps === true`", () => {
    const tokens = tasdiqlaInvariant('US')
    expect(qisqa(tokens)).toEqual([['word', 'US', 0, 2]])
    expect(tokens[0]?.caps).toBe(true)
  })

  it("gap ichidagi `NASA` ham `caps === true`", () => {
    const tokens = tasdiqlaInvariant('He works at NASA now.')
    const nasa = tokens.find((t) => t.text === 'NASA')
    expect(nasa?.kind).toBe('word')
    expect(nasa?.caps).toBe(true)
  })

  it("bir harfli `I` va oddiy `The` uchun `caps === false`", () => {
    // Uzunlik >= 2 shart: `I` normal qoida bilan `i.mp3` ga tushadi.
    const i = tokenize('I am here.').find((t) => t.text === 'I')
    expect(i?.caps).toBe(false)

    const the = tokenize('The cat.').find((t) => t.text === 'The')
    expect(the?.caps).toBe(false)
  })

  it("`gap` tokenlarida `caps` doim `false`", () => {
    for (const t of tokenize('2024 - $1.50!')) {
      if (t.kind === 'gap') expect(t.caps).toBe(false)
    }
  })
})

describe('tokenize — raqamlar `gap` bo\'ladi (PLAN §3)', () => {
  it("`$1.50` va `2024` ovozsiz `gap` tokenlar, lekin gap qoplamasida qoladi", () => {
    const sentence = 'Smith paid $1.50 in 2024.'
    const tokens = tasdiqlaInvariant(sentence)

    const words = tokens.filter((t) => t.kind === 'word').map((t) => t.text)
    expect(words).toEqual(['Smith', 'paid', 'in'])

    // Raqamlar so'z emas — ular yozilishi shart, lekin o'qilmaydi.
    const gaps = tokens.filter((t) => t.kind === 'gap').map((t) => t.text)
    expect(gaps).toEqual([' ', ' $1.50 ', ' 2024.'])
  })
})

describe('tokenize — hujjatlashtirilgan holat: raqam bilan boshlangan so\'z', () => {
  it("`3D-printed` da token `D-printed` dan boshlanadi", () => {
    // HUJJATLASHTIRILGAN CHEKLOV (PLAN §9).
    // So'z shakli `[A-Za-z]` bilan boshlanishi shart, shuning uchun `3` so'zga
    // kira olmaydi va alohida `gap` bo'lib qoladi. Natijada so'z tokeni
    // 1-indeksdan, ya'ni `D-printed` dan boshlanadi.
    // Amaliy oqibati: foydalanuvchi `3` ni yozganda ovoz chiqmaydi, `D` bosilganda
    // esa "D-printed" o'qiladi — `3D-printed` emas. Bu bilib turilgan xatti-harakat,
    // xato emas: `[A-Za-z0-9]` ga kengaytirish `2024` va `$1.50` ni ham o'qiladigan
    // qilib qo'yardi (PLAN §3 ga zid).
    const sentence = '3D-printed parts'
    const tokens = tasdiqlaInvariant(sentence)

    expect(qisqa(tokens)).toEqual([
      ['gap', '3', 0, 1],
      ['word', 'D-printed', 1, 10],
      ['gap', ' ', 10, 11],
      ['word', 'parts', 11, 16],
    ])
  })
})

describe('tokenize — chegaraviy holatlar', () => {
  it("bo'sh gap uchun bo'sh massiv", () => {
    expect(tokenize('')).toEqual([])
  })

  it("faqat tinish belgisidan iborat gap — bitta `gap` token", () => {
    const tokens = tasdiqlaInvariant('... !?')
    expect(qisqa(tokens)).toEqual([['gap', '... !?', 0, 6]])
  })

  it("faqat bo'shliqdan iborat gap — bitta `gap` token", () => {
    const tokens = tasdiqlaInvariant('   ')
    expect(qisqa(tokens)).toEqual([['gap', '   ', 0, 3]])
  })

  it("so'z bilan boshlanib so'z bilan tugaydigan gapda chekka `gap` bo'lmaydi", () => {
    const tokens = tasdiqlaInvariant('cat')
    expect(qisqa(tokens)).toEqual([['word', 'cat', 0, 3]])
  })

  it("gap qo'shtirnoq bilan boshlansa birinchi so'z 1-indeksda bo'ladi", () => {
    // Reducer `cursor === 0` ga emas, `token.start` ga tayanishi kerak (PLAN §4).
    const tokens = tasdiqlaInvariant('"The cat," he said.')
    expect(tokens[0]?.kind).toBe('gap')
    expect(tokens[1]?.kind).toBe('word')
    expect(tokens[1]?.text).toBe('The')
    expect(tokens[1]?.start).toBe(1)
  })

  it("takrorlangan so'z har uchrashuvda alohida token bo'ladi", () => {
    const tokens = tasdiqlaInvariant('the cat and the dog')
    const the = tokens.filter((t) => t.kind === 'word' && t.text === 'the')
    expect(the.length).toBe(2)
    expect(the[0]?.start).toBe(0)
    expect(the[1]?.start).toBe(12)
  })
})

describe('tokenize — uzluksizlik invarianti', () => {
  const namunalar = [
    '',
    ' ',
    '.',
    'a',
    'I',
    'US',
    'cat',
    "Don't stop - it's fine.",
    '3D-printed parts',
    'Smith paid $1.50 in 2024.',
    '"The cat," he said.',
    "He said, \"I don't know - maybe.\"",
    'well-known e-mail x-ray',
    "dogs' tails; cats- too",
    'A1 B2 C3',
    '--- ... !!!',
    'the cat and the dog',
    "O'Brien and Mc-Donald met.",
  ]

  for (const sentence of namunalar) {
    it(`tokenlar gapni uzluksiz qoplaydi: ${JSON.stringify(sentence)}`, () => {
      const tokens = tasdiqlaInvariant(sentence)
      // Qo'shimcha yaxlit tekshiruv: barcha token matnlari birlashsa asl gap chiqadi.
      expect(tokens.map((t) => t.text).join('')).toBe(sentence)
    })
  }
})

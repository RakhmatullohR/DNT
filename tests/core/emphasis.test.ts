import { describe, expect, it } from 'vitest'
import { isEmphasized, parseEmphasis } from '../../src/core/emphasis.ts'
import { normalize } from '../../src/core/normalize.ts'
import { splitSentences } from '../../src/core/splitSentences.ts'

/** Qalin bo'laklarni matnning o'zidan kesib oladi — oraliqlarni o'qishga qulay qiladi. */
function marked(raw: string): string[] {
  const { text, ranges } = parseEmphasis(raw)
  return ranges.map((r) => text.slice(r.start, r.end))
}

describe('parseEmphasis', () => {
  it("belgisiz matn o'zgarmaydi", () => {
    expect(parseEmphasis('He was certain.')).toEqual({ text: 'He was certain.', ranges: [] })
  })

  it("bo'sh matn", () => {
    expect(parseEmphasis('')).toEqual({ text: '', ranges: [] })
  })

  it('tirnoqlar matndan OLIB TASHLANADI', () => {
    expect(parseEmphasis('He was `absolutely` certain.').text).toBe('He was absolutely certain.')
  })

  it('oraliq TOZALANGAN matn indekslarida qaytadi', () => {
    const { text, ranges } = parseEmphasis('He was `absolutely` certain.')
    expect(ranges).toEqual([{ start: 7, end: 17 }])
    expect(text.slice(7, 17)).toBe('absolutely')
  })

  it("bitta gapda bir nechta bo'lak", () => {
    expect(marked('`Never` say `never` again.')).toEqual(['Never', 'never'])
    expect(parseEmphasis('`Never` say `never` again.').text).toBe('Never say never again.')
  })

  it("bo'lak ichida bir nechta so'z bo'lishi mumkin", () => {
    expect(marked('It was `far too late` by then.')).toEqual(['far too late'])
  })

  it('matn boshidagi va oxiridagi bo\'lak', () => {
    expect(marked('`Stop` right there `now`')).toEqual(['Stop', 'now'])
    expect(parseEmphasis('`Stop` right there `now`').text).toBe('Stop right there now')
  })

  it('tinish belgisi bo\'lak ichida ham qolaveradi', () => {
    expect(marked('He said `no, never!` twice.')).toEqual(['no, never!'])
  })

  // --- Belgi HISOBLANMAYDIGAN holatlar: tirnoq matnda ko'rinib qoladi ---

  it("yopilmagan tirnoq matnda QOLADI", () => {
    expect(parseEmphasis('He was `absolutely certain.')).toEqual({
      text: 'He was `absolutely certain.',
      ranges: [],
    })
  })

  it("yolg'iz tirnoq bo'lak yasamaydi", () => {
    expect(parseEmphasis('a ` b').ranges).toEqual([])
  })

  it("ichi bo'sh juft belgi emas — ikkala tirnoq ham qoladi", () => {
    expect(parseEmphasis('a `` b')).toEqual({ text: 'a `` b', ranges: [] })
  })

  it('faqat probeldan iborat juft ham belgi emas', () => {
    expect(parseEmphasis('a ` ` b')).toEqual({ text: 'a ` ` b', ranges: [] })
  })

  it("uchta tirnoq: birinchi juft ishlaydi, uchinchisi matnda qoladi", () => {
    const { text, ranges } = parseEmphasis('`one` two `three')
    expect(text).toBe('one two `three')
    expect(ranges).toEqual([{ start: 0, end: 3 }])
  })

  // --- Kafolatlar ---

  it("natijada belgi qolmasa, tirnoq ham qolmaydi", () => {
    expect(parseEmphasis('`a` `b` `c`').text).toBe('a b c')
  })

  it("oraliqlar o'sish tartibida va kesishmaydi", () => {
    const { ranges } = parseEmphasis('`a` x `bb` y `ccc`')
    for (let i = 1; i < ranges.length; i += 1) {
      const prev = ranges[i - 1]
      const cur = ranges[i]
      expect(prev !== undefined && cur !== undefined).toBe(true)
      if (prev === undefined || cur === undefined) continue
      expect(prev.end).toBeLessThanOrEqual(cur.start)
    }
  })

  it("har bir oraliq matn chegarasida qoladi", () => {
    const { text, ranges } = parseEmphasis('`Never` say `never` again.')
    for (const range of ranges) {
      expect(range.start).toBeGreaterThanOrEqual(0)
      expect(range.end).toBeGreaterThan(range.start)
      expect(range.end).toBeLessThanOrEqual(text.length)
    }
  })

  it('idempotent: tozalangan matnni qayta parslash hech narsani o\'zgartirmaydi', () => {
    const once = parseEmphasis('He was `absolutely` certain.')
    expect(parseEmphasis(once.text)).toEqual({ text: once.text, ranges: [] })
  })

  // --- Bo'shliq kafolati: target `splitSentences` bilan bir xil toza bo'lishi kerak ---

  it("belgi olingach OXIRGI probel qolmaydi", () => {
    expect(parseEmphasis('One. `Two. `')).toEqual({
      text: 'One. Two.',
      ranges: [{ start: 5, end: 9 }],
    })
  })

  it("belgi olingach IKKILANGAN probel qolmaydi", () => {
    const { text } = parseEmphasis('A. `B. ` C.')
    expect(text).toBe('A. B. C.')
    expect(text).not.toContain('  ')
  })

  it("bosh probel ham tashlanadi", () => {
    expect(parseEmphasis('` One.`').text).toBe('One.')
  })

  it("oraliq chetida probel QOLMAYDI", () => {
    const { text, ranges } = parseEmphasis('A. ` B. C. ` D.')
    expect(text).toBe('A. B. C. D.')
    for (const range of ranges) {
      expect(text.charAt(range.start)).not.toBe(' ')
      expect(text.charAt(range.end - 1)).not.toBe(' ')
    }
    expect(ranges.map((r) => text.slice(r.start, r.end))).toEqual(['B. C.'])
  })

  it("belgisiz matn tozalashga umuman tushmaydi (aynan o'zi qaytadi)", () => {
    // Ombordagi eski darslar shu yo'ldan o'tadi — ular o'zgarmasligi SHART.
    const asIs = 'A.  B.  '
    expect(parseEmphasis(asIs)).toEqual({ text: asIs, ranges: [] })
  })
})

// ---------------------------------------------------------------------------
// Import quvuri: `normalize` -> `splitSentences` -> `parseEmphasis` (PLAN §2b')
// ---------------------------------------------------------------------------

/** Import ekrani gapga aynan shu tartibda ishlov beradi. */
function importPipeline(paste: string): { text: string; marked: string[] }[] {
  return splitSentences(normalize(paste).text).map((sentence) => {
    const { text, ranges } = parseEmphasis(sentence)
    return { text, marked: ranges.map((r) => text.slice(r.start, r.end)) }
  })
}

describe("import quvuri: `[...]` va `` `...` `` birga", () => {
  it("target BELGISIZ chiqadi va oraliqlar to'g'ri so'zga tushadi", () => {
    expect(importPipeline('He was `absolutely` certain. The end.')).toEqual([
      { text: 'He was absolutely certain.', marked: ['absolutely'] },
      { text: 'The end.', marked: [] },
    ])
  })

  it("guruh ichidagi ta'kidlash saqlanadi", () => {
    expect(importPipeline('[She knocked. `Nobody` answered.] The end.')).toEqual([
      { text: 'She knocked. Nobody answered.', marked: ['Nobody'] },
      { text: 'The end.', marked: [] },
    ])
  })

  // PLAN §2b': tirnoq bitta gap ichida yopilishi kerak. Guruh gaplarni BITTA
  // birlikka qo'shgani uchun gap chegarasidan oshgan ta'kidlash aynan shu yo'l
  // bilan ishlaydi.
  it("`[...]` ichida ta'kidlash ikki gapni qamrab olishi mumkin", () => {
    expect(importPipeline('[One. `Two. Three.`]')).toEqual([
      { text: 'One. Two. Three.', marked: ['Two. Three.'] },
    ])
  })

  // ⭐ Guruh bo'laklari PROBEL bilan ulanadi, ya'ni yopuvchi tirnoq alohida segment
  // boshiga tushsa uning oldida probel paydo bo'ladi. Tirnoq olingach o'sha probel
  // targetda qolib ketmasligi kerak — aks holda gap ko'zga tugagandek ko'rinib,
  // foydalanuvchidan ko'rinmas joyga probel bosish talab qilinardi.
  it("guruh + ta'kidlash targetda ORTIQCHA PROBEL qoldirmaydi", () => {
    for (const paste of ['[One. `Two. Three.`]', '[A. `B. C. ` D.]', '[One. `Two.` Three.]']) {
      for (const row of importPipeline(paste)) {
        expect(row.text).toBe(row.text.trim())
        expect(row.text).not.toContain('  ')
      }
    }
  })

  it("guruh + ta'kidlash matnni ham, oraliqni ham to'g'ri beradi", () => {
    expect(importPipeline('[A. `B. C. ` D.]')).toEqual([
      { text: 'A. B. C. D.', marked: ['B. C.'] },
    ])
  })

  // `]` gap OXIRIDA emas -> guruh yig'ilmaydi (§2b), tirnoqlar ham juftsiz qoladi.
  // Ikkala belgi ham matnda ko'rinib qoladi — muallif xatoni darrov ko'radi.
  it("guruh yig'ilmasa belgilarning HECH BIRI qo'llanmaydi", () => {
    expect(importPipeline('[One. `Two. Three.`] Four.')).toEqual([
      { text: '[One.', marked: [] },
      { text: '`Two.', marked: [] },
      { text: 'Three.', marked: [] },
      { text: '`] Four.', marked: [] },
    ])
  })

  it("guruhsiz esa gap chegarasidan oshgan tirnoq belgi BO'LMAY qoladi", () => {
    // Har ikkala gapda tirnoq yolg'iz qoladi -> ta'kidlash yo'q, tirnoq ko'rinadi.
    expect(importPipeline('One `two. Three` four.')).toEqual([
      { text: 'One `two.', marked: [] },
      { text: 'Three` four.', marked: [] },
    ])
  })

  it("hech bir target ichida teskari tirnoq qolmaydi", () => {
    const rows = importPipeline('`Never` say `never`. [A. `B` C.] `Done`.')
    for (const row of rows) {
      expect(row.text).not.toContain('`')
    }
    expect(rows.flatMap((row) => row.marked)).toEqual(['Never', 'never', 'B', 'Done'])
  })
})

describe('isEmphasized', () => {
  it("oraliq ichidagi pozitsiya -> true, tashqarisi -> false", () => {
    const { ranges } = parseEmphasis('He was `absolutely` certain.')
    expect(isEmphasized(ranges, 6)).toBe(false) // probel
    expect(isEmphasized(ranges, 7)).toBe(true) // 'a'
    expect(isEmphasized(ranges, 16)).toBe(true) // 'y'
    expect(isEmphasized(ranges, 17)).toBe(false) // probel
  })

  it("bo'sh ro'yxatda doim false", () => {
    expect(isEmphasized([], 0)).toBe(false)
  })

  it('chegaradan tashqaridagi pozitsiya false', () => {
    const { ranges } = parseEmphasis('`ab`')
    expect(isEmphasized(ranges, -1)).toBe(false)
    expect(isEmphasized(ranges, 99)).toBe(false)
  })

  it("bir nechta oraliqda ikkinchisiga ham tushadi", () => {
    const { text, ranges } = parseEmphasis('`ab` cd `ef`')
    expect(text).toBe('ab cd ef')
    expect(isEmphasized(ranges, 0)).toBe(true)
    expect(isEmphasized(ranges, 3)).toBe(false)
    expect(isEmphasized(ranges, 6)).toBe(true)
  })
})

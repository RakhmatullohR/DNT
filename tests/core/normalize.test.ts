import { describe, expect, it } from 'vitest'
import { normalize } from '../../src/core/normalize.ts'
import type { ChangeKind, NormalizeChange } from '../../src/core/normalize.ts'

// DIQQAT: bu faylda o'zbekcha matnlar QO'SHTIRNOQ ichida yoziladi.
// `'so\'z'` shaklidagi apostrof bir marta unutilsa butun fayl parse bo'lmaydi.
//
// Ko'rinmas belgilar (NBSP, BOM, ZWSP) ataylab `\u....` ko'rinishida yoziladi:
// tahrirlagichda ular oddiy probeldan farq qilmaydi va tasodifan yo'qolib ketishi mumkin.

/** PLAN §9: natijada faqat yozib bo'ladigan ASCII qolishi shart. */
const ASCII_ONLY_RE = /^[\x20-\x7E]*$/

function findChange(
  changes: NormalizeChange[],
  kind: ChangeKind,
  from: string,
): NormalizeChange | undefined {
  return changes.find((change) => change.kind === kind && change.from === from)
}

describe("normalize — PLAN §2a olti bosqichli jadval", () => {
  describe("1-bosqich: diakritikalar", () => {
    it("`café naïve` -> `cafe naive`", () => {
      const result = normalize('café naïve')

      expect(result.text).toBe('cafe naive')
      expect(result.removed).toEqual([])
      expect(result.changes).toEqual([
        { kind: 'diacritic', from: 'é', to: 'e', count: 1 },
        { kind: 'diacritic', from: 'ï', to: 'i', count: 1 },
      ])
    })

    it("bir nechta diakritikali so'z ham to'liq tozalanadi", () => {
      const result = normalize('résumé über Señor')

      expect(result.text).toBe('resume uber Senor')
      expect(result.removed).toEqual([])
      expect(findChange(result.changes, 'diacritic', 'é')?.count).toBe(2)
      expect(findChange(result.changes, 'diacritic', 'ü')?.count).toBe(1)
      expect(findChange(result.changes, 'diacritic', 'ñ')?.count).toBe(1)
    })

    it("allaqachon parchalangan kirish (`e` + U+0301) ham qo'llab-quvvatlanadi", () => {
      // Nusxalangan matnda `\u00E9` ikki xil kelishi mumkin: U+00E9 yoki `e` + U+0301.
      // Escape ATAYLAB yozilgan: tahrirlagich faylni NFC ga keltirib qo'ysa,
      // literal jimgina birinchi holatga aylanib, test ma'nosini yo'qotardi.
      const result = normalize('cafe\u0301')

      expect(result.text).toBe('cafe')
      expect(result.changes).toEqual([{ kind: 'diacritic', from: '\u0301', to: '', count: 1 }])
      expect(result.removed).toEqual([])
    })

    it("diakritikasiz ASCII harflarga tegilmaydi", () => {
      const result = normalize('The quick brown fox.')

      expect(result.text).toBe('The quick brown fox.')
      expect(result.changes).toEqual([])
      expect(result.removed).toEqual([])
    })

    it("diakritika olib tashlangach tokenizator uchun `[A-Za-z]` qoladi (PLAN §2a izohi)", () => {
      // Aks holda `naïve` -> `na`,`ve` bo'lib parchalanardi va `n` bosilganda `na` eshitilardi.
      const result = normalize('naïve')

      expect(/^[A-Za-z]+$/.test(result.text)).toBe(true)
    })
  })

  describe("2-bosqich: aqlli qo'shtirnoq va apostrof", () => {
    it("to'rtala qo'shtirnoq ASCII `\"` ga aylanadi", () => {
      const result = normalize('“a” „b‟')

      expect(result.text).toBe('"a" "b"')
      expect(result.removed).toEqual([])
    })

    it("to'rtala apostrof ASCII `'` ga aylanadi", () => {
      const result = normalize('‘a’ ‚b‛')

      expect(result.text).toBe("'a' 'b'")
      expect(result.removed).toEqual([])
    })

    it("bir xil belgi bir necha marta uchrasa `count` yig'iladi", () => {
      const result = normalize('“a” “b”')

      expect(result.text).toBe('"a" "b"')
      expect(result.changes).toEqual([
        { kind: 'quote', from: '“', to: '"', count: 2 },
        { kind: 'quote', from: '”', to: '"', count: 2 },
      ])
    })
  })

  describe("3-bosqich: tire va ko'p nuqta", () => {
    it("to'rt xil tire `-` ga aylanadi", () => {
      const result = normalize('a—b–c‒d−e')

      expect(result.text).toBe('a-b-c-d-e')
      expect(result.removed).toEqual([])
      expect(result.changes).toHaveLength(4)
    })

    it("`…` uchta nuqtaga yoyiladi", () => {
      const result = normalize('wait… what?')

      expect(result.text).toBe('wait... what?')
      expect(result.changes).toEqual([{ kind: 'dash', from: '…', to: '...', count: 1 }])
    })
  })

  describe("4-bosqich: bo'shliqlarni birxillashtirish", () => {
    it("NBSP va tor NBSP oddiy probelga aylanadi", () => {
      const result = normalize('a b c')

      expect(result.text).toBe('a b c')
      expect(result.removed).toEqual([])
      expect(result.changes).toEqual([
        { kind: 'space', from: ' ', to: ' ', count: 1 },
        { kind: 'space', from: ' ', to: ' ', count: 1 },
      ])
    })

    it("tab va satr ko'chirish ham probelga aylanadi", () => {
      const result = normalize('first\tsecond\nthird')

      expect(result.text).toBe('first second third')
      expect(findChange(result.changes, 'space', '\t')?.count).toBe(1)
      expect(findChange(result.changes, 'space', '\n')?.count).toBe(1)
    })

    it("PLAN §2b dagi `\\n segment ichida` muammosi shu yerda yopiladi", () => {
      const result = normalize('First line\nsecond line.')

      expect(result.text).toBe('First line second line.')
      expect(result.text).not.toContain('\n')
    })

    it("Windows `\\r\\n` bitta probelga yig'iladi", () => {
      const result = normalize('line one\r\nline two')

      expect(result.text).toBe('line one line two')
    })
  })

  describe("5-bosqich: siqish va trim", () => {
    it("ketma-ket probellar bittaga siqiladi", () => {
      const result = normalize('a    b')

      expect(result.text).toBe('a b')
      expect(result.changes).toEqual([{ kind: 'space', from: '  ', to: ' ', count: 1 }])
    })

    it("har bir siqilgan bo'shliq guruhi alohida sanaladi", () => {
      const result = normalize('a   b   c')

      expect(result.text).toBe('a b c')
      expect(findChange(result.changes, 'space', '  ')?.count).toBe(2)
    })

    it("bosh va oxirgi bo'shliqlar olib tashlanadi, soxta o'zgarish yozilmaydi", () => {
      const result = normalize('   hello world   ')

      expect(result.text).toBe('hello world')
      expect(result.changes).toEqual([])
    })

    it("aralash bo'shliqlar (probel + tab + `\\n`) bitta probelga yig'iladi", () => {
      const result = normalize('a  \t\n b')

      expect(result.text).toBe('a b')
    })
  })

  describe("6-bosqich: ASCII dan tashqari belgilarni olib tashlash", () => {
    it("emoji va kirill belgilar `removed` ga tushadi", () => {
      const result = normalize('ok \u{1F44D} Привет done')

      expect(result.text).toBe('ok done')
      expect(ASCII_ONLY_RE.test(result.text)).toBe(true)
      expect(result.removed).toEqual([
        '\u{1F44D}',
        'П',
        'р',
        'и',
        'в',
        'е',
        'т',
      ])
    })

    it("`removed` ro'yxati takrorlanmas, `changes` esa sonini saqlaydi", () => {
      const result = normalize('a © b © c ©')

      expect(result.removed).toEqual(['©'])
      expect(findChange(result.changes, 'removed', '©')).toEqual({
        kind: 'removed',
        from: '©',
        to: '',
        count: 3,
      })
    })

    it("belgi olib tashlangach yonma-yon qolgan probellar qayta siqiladi", () => {
      const result = normalize('a © b')

      expect(result.text).toBe('a b')
      expect(result.text).not.toContain('  ')
    })

    it("emoji surrogat jufti butunligicha BITTA element sifatida yoziladi", () => {
      const result = normalize('\u{1F600}')

      expect(result.text).toBe('')
      expect(result.removed).toEqual(['\u{1F600}'])
      expect(result.removed).toHaveLength(1)
    })

    it("nol enli belgilar so'zni BO'LMAYDI, olib tashlanadi (U+200B, U+FEFF)", () => {
      // Bu belgilar probelga aylantirilsa `ab` ikkita tokenga bo'linib ketardi.
      expect(normalize('a​b').text).toBe('ab')
      expect(normalize('a​b').removed).toEqual(['​'])
      expect(normalize('a﻿b').text).toBe('ab')
      expect(normalize('a﻿b').removed).toEqual(['﻿'])
    })

    it("boshidagi BOM tozalanadi", () => {
      const result = normalize('﻿Hello world')

      expect(result.text).toBe('Hello world')
    })
  })

  describe("PLAN §9 talablari", () => {
    it("`He said, “I don’t know—maybe.”` to'liq yoziladigan holga keladi", () => {
      const result = normalize('He said, “I don’t know—maybe.”')

      expect(result.text).toBe('He said, "I don\'t know-maybe."')
      expect(ASCII_ONLY_RE.test(result.text)).toBe(true)
      expect(result.removed).toEqual([])
    })

    it("o'zgargan belgilar ro'yxati to'g'ri qaytariladi", () => {
      const result = normalize('He said, “I don’t know—maybe.”')

      expect(result.changes).toEqual([
        { kind: 'quote', from: '“', to: '"', count: 1 },
        { kind: 'quote', from: '’', to: "'", count: 1 },
        { kind: 'quote', from: '”', to: '"', count: 1 },
        { kind: 'dash', from: '—', to: '-', count: 1 },
      ])
    })

    it("aralash `iflos` xatboshi ham butunlay ASCII bo'ladi", () => {
      const result = normalize('“Café” — naïve… he\tsaid \u{1F604}\nreally?')

      expect(result.text).toBe('"Cafe" - naive... he said really?')
      expect(ASCII_ONLY_RE.test(result.text)).toBe(true)
      expect(result.removed).toEqual(['\u{1F604}'])
    })

    it("`changes` PLAN §2a bosqichlari tartibida qaytariladi", () => {
      const result = normalize('“Café” — x\ty © z')

      expect(result.changes.map((change) => change.kind)).toEqual([
        'diacritic',
        'quote',
        'quote',
        'dash',
        'space',
        'space',
        'removed',
      ])
    })
  })

  describe("chegaraviy holatlar", () => {
    it("bo'sh satr", () => {
      const result = normalize('')

      expect(result).toEqual({ text: '', changes: [], removed: [] })
    })

    it("faqat probeldan iborat satr — o'zgarish yozilmaydi", () => {
      const result = normalize('     ')

      expect(result).toEqual({ text: '', changes: [], removed: [] })
    })

    it("faqat aralash bo'shliqlardan iborat satr", () => {
      const result = normalize(' \t\n  ')

      expect(result.text).toBe('')
      expect(result.removed).toEqual([])
    })

    it("apostrof va tire so'z ichida SAQLANADI (shared/filename.ts shunga tayanadi)", () => {
      const result = normalize("don't 3D-printed")

      expect(result.text).toBe("don't 3D-printed")
      expect(result.changes).toEqual([])
    })

    it("katta harfli qisqartmalar o'zgarmaydi (`@caps` qoidasi uchun)", () => {
      const result = normalize('The US and NASA.')

      expect(result.text).toBe('The US and NASA.')
      expect(result.changes).toEqual([])
    })

    it("raqamlar va tinish belgilariga tegilmaydi", () => {
      const dirty = 'Mr. Smith paid $1.50 (again) [x] {y} #1 50% a@b.com.'
      const result = normalize(dirty)

      expect(result.text).toBe(dirty)
      expect(result.changes).toEqual([])
    })

    it("idempotent: tozalangan matnni qayta tozalash hech narsani o'zgartirmaydi", () => {
      const dirty = '“Café” — naïve… \u{1F604}\ttest\n\n'
      const once = normalize(dirty)
      const twice = normalize(once.text)

      expect(twice.text).toBe(once.text)
      expect(twice.changes).toEqual([])
      expect(twice.removed).toEqual([])
    })

    it("hech narsa o'zgarmasa `changes` bo'sh massiv bo'ladi", () => {
      const result = normalize('Plain ASCII sentence, nothing to fix.')

      expect(result.changes).toEqual([])
      expect(result.changes).toHaveLength(0)
    })

    it("0x20–0x7E oralig'idagi HAR BIR belgi saqlanadi", () => {
      let printable = ''
      for (let code = 0x20; code <= 0x7e; code += 1) {
        printable += String.fromCharCode(code)
      }
      const result = normalize(printable)

      // Faqat bosh probel trim qilinadi — qolgan hamma narsa joyida.
      expect(result.text).toBe(printable.trim())
      expect(result.removed).toEqual([])
    })
  })
})

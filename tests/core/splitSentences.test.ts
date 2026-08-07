import { describe, expect, it } from 'vitest'
import { ABBREVIATIONS, splitSentences } from '../../src/core/splitSentences.ts'

describe('splitSentences', () => {
  it("bo'sh matn -> bo'sh massiv", () => {
    expect(splitSentences('')).toEqual([])
  })

  it("faqat bo'shliqdan iborat matn -> bo'sh massiv", () => {
    expect(splitSentences('   \n\t  ')).toEqual([])
  })

  it('oddiy ikki gapni ajratadi', () => {
    expect(splitSentences('The dog barked. The cat slept.')).toEqual([
      'The dog barked.',
      'The cat slept.',
    ])
  })

  // PLAN §9: `Intl.Segmenter` buni 3 ta segmentga bo'ladi ("Mr. " alohida chiqadi).
  it("'Mr. Smith paid $1.50. He left.' -> AYNAN 2 ta gap", () => {
    const sentences = splitSentences('Mr. Smith paid $1.50. He left.')
    expect(sentences).toHaveLength(2)
    expect(sentences).toEqual(['Mr. Smith paid $1.50.', 'He left.'])
  })

  // PLAN §9: `Intl.Segmenter` buni 4 ta segmentga bo'ladi
  // (["Dr. ", "Smith met Mr. ", "Jones. ", "They left."]).
  it("'Dr. Smith met Mr. Jones. They left.' -> 2 ta gap (ketma-ket qisqartmalar)", () => {
    const sentences = splitSentences('Dr. Smith met Mr. Jones. They left.')
    expect(sentences).toHaveLength(2)
    expect(sentences).toEqual(['Dr. Smith met Mr. Jones.', 'They left.'])
  })

  it("qator boshidagi ketma-ket ikkita qisqartma bitta gapda qoladi", () => {
    expect(splitSentences('Mr. Mrs. Brown arrived. We waited.')).toEqual([
      'Mr. Mrs. Brown arrived.',
      'We waited.',
    ])
  })

  it("hech bir segmentda bosh yoki oxirgi bo'shliq qolmaydi", () => {
    const sentences = splitSentences(
      '  The quick brown fox jumps over the lazy dog.   It barked twice.  ',
    )
    expect(sentences).toHaveLength(2)
    for (const sentence of sentences) {
      expect(sentence).toBe(sentence.trim())
      expect(sentence.startsWith(' ')).toBe(false)
      expect(sentence.endsWith(' ')).toBe(false)
    }
  })

  it("'First line\\nsecond line.' -> 2 ta gap, \\n siz", () => {
    const sentences = splitSentences('First line\nsecond line.')
    expect(sentences).toHaveLength(2)
    expect(sentences).toEqual(['First line', 'second line.'])
    for (const sentence of sentences) {
      expect(sentence).not.toContain('\n')
    }
  })

  it("ichki ketma-ket bo'shliqlar va tab bitta probelga siqiladi", () => {
    const sentences = splitSentences('The   dog\tbarked  loudly. It ran.')
    expect(sentences).toEqual(['The dog barked loudly.', 'It ran.'])
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\s{2,}/)
      expect(sentence).not.toMatch(/[\n\t]/)
    }
  })

  it("bo'sh qator alohida segment beradi, lekin u tashlab yuboriladi", () => {
    // `Intl.Segmenter` "The dog\n\nbarked." ni 3 ta segmentga bo'ladi va
    // o'rtadagisi faqat "\n" bo'ladi — u tozalangandan keyin bo'sh qoladi.
    expect(splitSentences('The dog\n\nbarked. It ran.')).toEqual([
      'The dog',
      'barked.',
      'It ran.',
    ])
  })

  it("nuqtasiz oxirgi bo'lak yo'qolmaydi", () => {
    expect(splitSentences('One. Two. Three')).toEqual(['One.', 'Two.', 'Three'])
  })

  it("nuqtasiz yagona bo'lak ham qaytariladi", () => {
    expect(splitSentences('Hello there')).toEqual(['Hello there'])
  })

  it("matn qisqartma bilan tugasa ham bo'lak yo'qolmaydi", () => {
    expect(splitSentences('We waited. Then came Dr.')).toEqual(['We waited.', 'Then came Dr.'])
  })

  it("boshqa qisqartmalar ham gapni bo'lmaydi", () => {
    expect(splitSentences('Meet me at 9 a.m. We start early.')).toEqual([
      'Meet me at 9 a.m. We start early.',
    ])
    expect(splitSentences('Bring apples, pears, etc. Then leave.')).toEqual([
      'Bring apples, pears, etc. Then leave.',
    ])
    expect(splitSentences('Use a tool, e.g. a hammer. It helps.')).toEqual([
      'Use a tool, e.g. a hammer.',
      'It helps.',
    ])
  })

  it("qisqartmaga o'xshab tugagan oddiy so'z gapni bo'lishga xalaqit bermaydi", () => {
    // `revs.` oxiri `vs.` qisqartmasiga mos tushadi, lekin oldidagi `e` — harf,
    // ya'ni bu butun so'zning bir bo'lagi. Chegara tekshiruvi aynan shuni ushlaydi.
    expect(splitSentences('The engine revs. It roars.')).toEqual([
      'The engine revs.',
      'It roars.',
    ])
    // `Est.` esa katta-kichik harf farqi bilan chetlab o'tiladi (`St.` != `st.`).
    expect(splitSentences('He passed the Est. It was closed.')).toEqual([
      'He passed the Est.',
      'It was closed.',
    ])
    // Haqiqiy `St.` qisqartmasi esa birlashtiriladi.
    expect(splitSentences('She lives on Main St. He does not.')).toEqual([
      'She lives on Main St. He does not.',
    ])
  })

  it("to'rtta ketma-ket qisqartma ham bitta gapda qoladi", () => {
    expect(splitSentences('Mr. Mrs. Dr. Prof. Brown arrived. We waited.')).toEqual([
      'Mr. Mrs. Dr. Prof. Brown arrived.',
      'We waited.',
    ])
  })

  it("matn faqat qisqartmadan iborat bo'lsa ham yo'qolmaydi", () => {
    expect(splitSentences('Mr.')).toEqual(['Mr.'])
  })

  it("savol va undov belgilari bo'yicha ham bo'linadi", () => {
    expect(splitSentences('Who is there? Nobody! Go home.')).toEqual([
      'Who is there?',
      'Nobody!',
      'Go home.',
    ])
  })

  // --- Qo'lda guruhlash: `[...]` (PLAN §2b) ---

  it("`[...]` ichidagi ikki gap bitta birlik bo'lib qoladi, qavslar tushadi", () => {
    expect(splitSentences('[He knocked. Nobody answered.] She left.')).toEqual([
      'He knocked. Nobody answered.',
      'She left.',
    ])
  })

  it("guruh matn o'rtasida ham ishlaydi", () => {
    expect(splitSentences('Zero. [One. Two. Three.] Four.')).toEqual([
      'Zero.',
      'One. Two. Three.',
      'Four.',
    ])
  })

  it('guruh ichidagi qisqartma birlashtirish ham buzilmaydi', () => {
    expect(splitSentences('[Dr. Smith met Mr. Jones. They left.] We stayed.')).toEqual([
      'Dr. Smith met Mr. Jones. They left.',
      'We stayed.',
    ])
  })

  it("bitta gapli guruhdan faqat qavslar olib tashlanadi", () => {
    expect(splitSentences('[Only one sentence.]')).toEqual(['Only one sentence.'])
  })

  it("ketma-ket ikki guruh aralashib ketmaydi", () => {
    expect(splitSentences('[One. Two.] [Three. Four.]')).toEqual([
      'One. Two.',
      'Three. Four.',
    ])
  })

  it("qavs ichidagi ortiqcha probel guruhdan keyin ham qolmaydi", () => {
    expect(splitSentences('[ One.   Two. ]')).toEqual(['One. Two.'])
  })

  it("bo'sh guruh natijaga tushmaydi", () => {
    expect(splitSentences('[]')).toEqual([])
  })

  // `[] Next.` bitta segment bo'lib chiqadi va `]` uning oxirida emas — demak
  // guruh emas. Qavslar ko'rinib qoladi, muallif ularni o'zi olib tashlaydi.
  it("gap boshidagi bo'sh qavs guruh emas", () => {
    expect(splitSentences('[] Next.')).toEqual(['[] Next.'])
  })

  // Guruh butun gaplarni qamrashi kerak: `]` gap OXIRIDA emas -> guruh emas.
  it("gap ichidagi `[sic]` guruh deb hisoblanmaydi", () => {
    expect(splitSentences('He said [sic] loudly. Next.')).toEqual([
      'He said [sic] loudly.',
      'Next.',
    ])
  })

  it("gap `[sic]` bilan boshlansa ham qavslar tegilmaydi", () => {
    expect(splitSentences('[sic] he said. Next.')).toEqual(['[sic] he said.', 'Next.'])
  })

  it("qavsdan keyin dum qolsa guruh birlashtirilmaydi", () => {
    expect(splitSentences('[One. Two.] and more. Next.')).toEqual([
      '[One.',
      'Two.] and more.',
      'Next.',
    ])
  })

  it("yopilmagan `[` qolgan gaplarni yutib yubormaydi", () => {
    expect(splitSentences('Zero. [One. Two. Three.')).toEqual([
      'Zero.',
      '[One.',
      'Two.',
      'Three.',
    ])
  })

  it("ortiqcha `]` guruh sifatida qabul qilinmaydi", () => {
    expect(splitSentences('[One. Two.]] Next.')).toEqual(['[One.', 'Two.]]', 'Next.'])
  })

  it("ichma-ich qavsda faqat tashqi juft olib tashlanadi", () => {
    expect(splitSentences('[A. [B. C.] D.] E.')).toEqual(['A. [B. C.] D.', 'E.'])
  })

  it('ABBREVIATIONS PLAN §2b dagi ro\'yxatga mos', () => {
    expect(ABBREVIATIONS).toEqual([
      'Mr.',
      'Mrs.',
      'Ms.',
      'Dr.',
      'Prof.',
      'St.',
      'Jr.',
      'Sr.',
      'vs.',
      'etc.',
      'e.g.',
      'i.e.',
      'a.m.',
      'p.m.',
      'No.',
    ])
  })
})

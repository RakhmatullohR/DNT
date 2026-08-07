// Matnni gaplarga bo'lish (PLAN §2b).
//
// `Intl.Segmenter` gap chegaralari uchun yaxshi asos, lekin unda QISQARTMALAR
// RO'YXATI YO'Q. Node v24.15.0 da amalda tekshirilgan natijalar:
//
//   "Mr. Smith paid $1.50. He left."
//     -> ["Mr. ", "Smith paid $1.50. ", "He left."]   <- 2 emas, 3 ta
//   "Dr. Smith met Mr. Jones. They left."
//     -> ["Dr. ", "Smith met Mr. ", "Jones. ", "They left."]   <- 4 ta
//   "First line\nsecond line."
//     -> ["First line\n", "second line."]             <- \n segment ICHIDA
//
// Shuning uchun to'rt qadam bajariladi:
//   1) `Intl.Segmenter` bilan bo'linadi,
//   2) qisqartma bilan tugagan segment keyingisi bilan QO'SHILADI
//      (ketma-ket bir nechta qisqartma ham to'g'ri ishlashi uchun tsikl ichida),
//   3) har segment `\s+ -> ' '` va `trim()` bilan tozalanadi, bo'shlari tashlanadi,
//   4) `[...]` ichidagi gaplar BITTA birlikka birlashtiriladi, qavslar olib tashlanadi.
//
// 3-qadam shart: oxiridagi ko'rinmas probel qolsa, gap ko'zga tugagandek
// ko'rinadi, lekin `finished` ishlamaydi va foydalanuvchidan yo'q joyga
// probel bosish talab qilinadi.
//
// 4-qadam qo'lda guruhlash uchun: ba'zi gaplar bir-birini to'ldiradi va alohida
// mashq qilinsa ma'nosi yo'qoladi. Avtomatik bo'luvchi buni bila olmaydi, shuning
// uchun qaror MATN MUALLIFIDA qoldirilgan — u guruhni `[` va `]` bilan belgilaydi.

/**
 * Nuqta bilan tugasa ham gapni TUGATMAYDIGAN qisqartmalar.
 * Ro'yxat PLAN §2b dan aynan olingan; solishtirish katta-kichik harfga sezgir.
 */
export const ABBREVIATIONS: readonly string[] = [
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
]

/** Gap bo'luvchi bir marta yaratiladi — har chaqiruvda yangisi qimmatga tushadi. */
const SENTENCE_SEGMENTER = new Intl.Segmenter('en', { granularity: 'sentence' })

const LETTER_RE = /[A-Za-z]/

/**
 * Matn oxiri qisqartma bilan tugaganini tekshiradi.
 * Qisqartmadan oldingi belgi harf BO'LMASLIGI shart — aks holda `revs.` oxiridagi
 * `vs.` qisqartma deb hisoblanib, keyingi gap unga yopishib ketardi.
 */
function endsWithAbbreviation(trimmed: string): boolean {
  for (const abbr of ABBREVIATIONS) {
    if (!trimmed.endsWith(abbr)) continue
    // `charAt` chegaradan tashqarida bo'sh satr qaytaradi — bu matn boshi degani.
    const before = trimmed.charAt(trimmed.length - abbr.length - 1)
    if (before === '' || !LETTER_RE.test(before)) return true
  }
  return false
}

const GROUP_OPEN = '['
const GROUP_CLOSE = ']'

/** Bo'lakdagi qavslar balansi: `[` uchun +1, `]` uchun -1. */
function bracketDelta(text: string): number {
  let delta = 0
  for (const ch of text) {
    if (ch === GROUP_OPEN) delta += 1
    else if (ch === GROUP_CLOSE) delta -= 1
  }
  return delta
}

/**
 * Birinchi `[` va uni YOPADIGAN `]` ni olib tashlaydi; ichkaridagi qavslar
 * tegilmaydi. Ichki qavs — matn muallifining xatosi, uni jimgina yeb qo'yishdan
 * ko'ra gaplar ro'yxatida ko'rinib turgani yaxshi.
 */
function stripOuterBrackets(text: string): string {
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i)
    if (ch === GROUP_OPEN) {
      depth += 1
      continue
    }
    if (ch !== GROUP_CLOSE) continue
    depth -= 1
    if (depth === 0) return `${text.slice(1, i)}${text.slice(i + 1)}`
  }
  return text
}

/**
 * 4-qadam: `[` bilan BOSHLANIB `]` bilan TUGAGAN gaplar ketma-ketligini bitta
 * birlikka yig'adi va tashqi qavs juftini olib tashlaydi.
 *
 * Ikkala shart ham qat'iy — guruh butun gaplarni qamrashi kerak. Faqat
 * "`[` bilan boshlanadi" deb qarasak, `[sic] he said.` guruh deb hisoblanib,
 * qavslar matn ichidan olib tashlanardi. Faqat balansga qarasak esa
 * `[One. Two.] and more.` da qavsdan keyingi dum ham guruhga qo'shilib ketardi.
 * Shart bajarilmasa gaplar TEGILMAYDI: qavs matnda ko'rinib qoladi va muallif
 * uni o'zi tuzatadi — jimgina noto'g'ri birlashtirishdan ko'ra shu ma'qul.
 */
function mergeGroups(sentences: readonly string[]): string[] {
  const merged: string[] = []
  /** Ochilgan, lekin hali yopilmagan guruh bo'laklari. */
  let pending: string[] = []
  let depth = 0

  for (const sentence of sentences) {
    if (depth === 0 && !sentence.startsWith(GROUP_OPEN)) {
      merged.push(sentence)
      continue
    }
    pending.push(sentence)
    depth += bracketDelta(sentence)
    if (depth > 0) continue

    if (depth === 0 && sentence.endsWith(GROUP_CLOSE)) {
      // Qavslar olib tashlangach `[ One.` -> ` One.` bo'lib, bosh probel qolishi
      // mumkin — 3-qadamdagi tozalash shu sababli TAKRORLANADI.
      const clean = stripOuterBrackets(pending.join(' ')).replace(/\s+/g, ' ').trim()
      if (clean !== '') merged.push(clean)
    } else {
      // Balans manfiyga ketdi (`[A.]]`) yoki `]` gap oxirida emas — guruh emas.
      for (const part of pending) merged.push(part)
    }
    pending = []
    depth = 0
  }

  // Yopilmagan `[`: qolgan gaplar birlashtirilmaydi, aks holda bitta tasodifiy
  // qavs butun darsni bitta ulkan gapga aylantirib qo'yardi.
  for (const part of pending) merged.push(part)
  return merged
}

/**
 * Matnni gaplarga bo'ladi.
 * Qaytgan har bir gapda bo'shliqlar bittaga siqilgan, bosh/oxirgi probel yo'q,
 * `\n` va `\t` oddiy probelga aylangan. Bo'sh matn -> bo'sh massiv.
 *
 * `[` bilan boshlanib `]` bilan tugagan bo'lak — nechta gapdan iborat bo'lsa ham —
 * BITTA gap sifatida qaytadi, qavslarsiz.
 */
export function splitSentences(text: string): string[] {
  if (text.length === 0) return []

  // 1-qadam: `Intl.Segmenter`. Segmentlar XOM holda yig'iladi — qo'shishdan
  // oldin trim qilinsa `"Mr. "` + `"Smith"` -> `"Mr.Smith"` bo'lib qolardi.
  const rawSegments: string[] = []
  for (const part of SENTENCE_SEGMENTER.segment(text)) {
    rawSegments.push(part.segment)
  }

  // 2-qadam: qisqartma birlashtirish. Bufer qisqartma bilan tugab turgan ekan,
  // keyingi segmentlar unga qo'shilaveradi — `Dr. ... Mr. ...` kabi ketma-ket
  // holatlar ham shu tufayli to'g'ri yig'iladi.
  const merged: string[] = []
  let buffer = ''
  for (const segment of rawSegments) {
    buffer += segment
    if (endsWithAbbreviation(buffer.trim())) continue
    merged.push(buffer)
    buffer = ''
  }
  // Matn qisqartma bilan tugagan bo'lsa bufer to'lib qoladi — u yo'qolmasligi kerak.
  if (buffer !== '') merged.push(buffer)

  // 3-qadam: tozalash.
  const sentences: string[] = []
  for (const sentence of merged) {
    const clean = sentence.replace(/\s+/g, ' ').trim()
    if (clean !== '') sentences.push(clean)
  }

  // 4-qadam: qo'lda guruhlash.
  return mergeGroups(sentences)
}

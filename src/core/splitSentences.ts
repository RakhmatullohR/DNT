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
// Shuning uchun uch qadam bajariladi:
//   1) `Intl.Segmenter` bilan bo'linadi,
//   2) qisqartma bilan tugagan segment keyingisi bilan QO'SHILADI
//      (ketma-ket bir nechta qisqartma ham to'g'ri ishlashi uchun tsikl ichida),
//   3) har segment `\s+ -> ' '` va `trim()` bilan tozalanadi, bo'shlari tashlanadi.
//
// 3-qadam shart: oxiridagi ko'rinmas probel qolsa, gap ko'zga tugagandek
// ko'rinadi, lekin `finished` ishlamaydi va foydalanuvchidan yo'q joyga
// probel bosish talab qilinadi.

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

/**
 * Matnni gaplarga bo'ladi.
 * Qaytgan har bir gapda bo'shliqlar bittaga siqilgan, bosh/oxirgi probel yo'q,
 * `\n` va `\t` oddiy probelga aylangan. Bo'sh matn -> bo'sh massiv.
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
  return sentences
}

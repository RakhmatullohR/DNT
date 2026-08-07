// Qo'lda ta'kidlash: `` `so'z` `` -> o'sha bo'lak Practice ekranida QALIN chiziladi.
//
// Belgilar matn muallifiniki, mashq targetiniki EMAS: teskari tirnoqlar targetdan
// olib tashlanadi va foydalanuvchi ularni HECH QACHON termaydi. Bu §2a bilan bir
// mantiq — target faqat klaviaturada teriladigan belgilardan iborat bo'lishi kerak,
// aks holda kursor terib bo'lmaydigan belgida qotib qolardi.
//
// Ta'kidlash matn MAZMUNIGA ta'sir qilmaydi: tokenizatsiya, audio, xato hisobi va
// statistika tozalangan matn ustida ishlaydi va oraliqlar haqida umuman bilmaydi.
// Ya'ni bu modul chizishdan boshqa hech narsaga tegmaydi.
//
// Gap chegarasi bilan aloqasi: parser HAR GAPGA alohida qo'llanadi (gaplarga
// bo'lingandan KEYIN). Ya'ni ochilgan tirnoq gap oxirida yopilmasa, u belgi emas —
// matnda ko'rinib qoladi. Bir nechta gapni birga ta'kidlash kerak bo'lsa, ularni
// avval `[...]` bilan bitta birlikka birlashtirish kerak (`splitSentences.ts`).

/** Tozalangan matndagi qalin bo'lak: `[start, end)`. */
export type EmphasisRange = { start: number; end: number }

export type ParsedEmphasis = {
  /** Belgilarsiz matn — aynan shu teriladi. */
  text: string
  /** `text` indekslaridagi qalin oraliqlar: kesishmaydi va o'sish tartibida. */
  ranges: EmphasisRange[]
}

const MARK = '`'

/**
 * Teskari tirnoq juftlarini olib tashlaydi va ular qamragan oraliqlarni qaytaradi.
 *
 * Juft HISOBLANMAYDIGAN (ya'ni belgilar matnda ko'rinib qoladigan) ikki holat:
 * - yopilmagan tirnoq — juftisiz qolgan belgi;
 * - ichi bo'sh yoki faqat probeldan iborat juft — u hech narsani ta'kidlamaydi.
 *
 * Ikkalasida ham tirnoq JIMGINA YO'QOTILMAYDI. Sabab `[...]` guruhlash bilan bir xil:
 * ko'rinib turgan belgi — muallif uchun xatoni ko'rsatuvchi signal, jimgina "tuzatish"
 * esa matnni bildirmasdan o'zgartirib yuborardi. Yon ta'siri ham foydali: shunday
 * gapda tirnoq targetga tushadi va uni terish kerak bo'ladi — xato darrov seziladi.
 */
export function parseEmphasis(raw: string): ParsedEmphasis {
  // Tez yo'l: belgisi yo'q matn (matnlarning aksariyati) umuman ko'chirilmaydi.
  // Bu shuningdek kafolat beradi: belgisi yo'q gap AYNAN o'zi bo'lib qaytadi.
  if (!raw.includes(MARK)) return { text: raw, ranges: [] }

  let text = ''
  const ranges: EmphasisRange[] = []
  let i = 0

  while (i < raw.length) {
    if (raw.charAt(i) !== MARK) {
      text += raw.charAt(i)
      i += 1
      continue
    }

    const close = raw.indexOf(MARK, i + 1)
    if (close === -1) {
      // Yopilmagan: qolgan hamma narsa oddiy matn, boshqa tirnoq ham yo'q.
      text += raw.slice(i)
      break
    }

    // `close` eng yaqin tirnoq bo'lgani uchun ichida boshqa tirnoq bo'lishi mumkin emas.
    const content = raw.slice(i + 1, close)
    if (content.trim() === '') {
      // Bo'sh juft — belgi emas, ikkala tirnoq ham matnda qoladi.
      text += raw.slice(i, close + 1)
      i = close + 1
      continue
    }

    ranges.push({ start: text.length, end: text.length + content.length })
    text += content
    i = close + 1
  }

  return tidy(text, ranges)
}

/**
 * ⭐ Belgilar olib tashlangach qolgan ORTIQCHA BO'SHLIQNI tozalaydi va oraliqlarni
 * yangi indekslarga suradi.
 *
 * Nega kerak: `splitSentences` guruh bo'laklarini probel bilan ULAB qo'yadi, ya'ni
 * `[One. `Two. Three.`]` da yopuvchi tirnoq alohida segment boshiga tushib, uning
 * oldiga probel qo'shiladi. Tirnoq olingach o'sha probel targetning OXIRIDA qolardi —
 * bu aynan `splitSentences` oldini olish uchun yaratilgan nuqson: gap ko'zga tugagandek
 * ko'rinadi, lekin foydalanuvchidan ko'rinmas joyga probel bosish talab qilinadi.
 * O'rtada esa ikkilangan probel paydo bo'lishi mumkin edi.
 *
 * Oraliq chetidagi probel oraliqdan CHIQARILADI (matnda qolsa ham): "qalin probel"
 * ko'rinmaydigan, lekin tanlashda seziladigan g'alati chekka yasardi.
 */
function tidy(text: string, ranges: readonly EmphasisRange[]): ParsedEmphasis {
  // Kirish `normalize.ts` dan o'tgani uchun yagona bo'shliq belgisi — oddiy probel.
  const SPACE = ' '

  // Eski indeks -> yangi indeks; tashlangan belgi uchun `-1`.
  const moved: number[] = []
  let out = ''
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i)
    // Bosh probel va takroriy probel tashlanadi.
    if (ch === SPACE && (out === '' || out.endsWith(SPACE))) {
      moved.push(-1)
      continue
    }
    moved.push(out.length)
    out += ch
  }
  // Oxirgi probel: yuqoridagi tsikl uni tasholmaydi (keyingi belgi yo'q).
  if (out.endsWith(SPACE)) {
    out = out.slice(0, -1)
    for (let i = moved.length - 1; i >= 0; i -= 1) {
      if (moved[i] === out.length) moved[i] = -1
      else if (moved[i] !== -1) break
    }
  }

  const shifted: EmphasisRange[] = []
  for (const range of ranges) {
    // Chetlardagi probelni oraliqdan chiqaramiz.
    let start = range.start
    let end = range.end
    while (start < end && text.charAt(start) === SPACE) start += 1
    while (end > start && text.charAt(end - 1) === SPACE) end -= 1

    // Qolgan bo'lakning saqlanib qolgan birinchi va oxirgi belgisi.
    let first = -1
    let last = -1
    for (let i = start; i < end; i += 1) {
      const next = moved[i]
      if (next === undefined || next === -1) continue
      if (first === -1) first = next
      last = next
    }
    if (first === -1) continue // butun bo'lak tozalashda yo'qoldi
    shifted.push({ start: first, end: last + 1 })
  }

  return { text: out, ranges: shifted }
}

/**
 * `pos` qalin oraliqqa tushadimi. Chizuvchi har belgi uchun chaqiradi, shuning uchun
 * oraliqlar soni kichik bo'lishiga tayanadi — bitta gapda ular birdan sanoqli.
 */
export function isEmphasized(ranges: readonly EmphasisRange[], pos: number): boolean {
  for (const range of ranges) {
    if (pos < range.start) return false // oraliqlar tartiblangan — oldinga qarash keraksiz
    if (pos < range.end) return true
  }
  return false
}

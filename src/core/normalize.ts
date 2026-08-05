// Import quvurining 1-bosqichi (PLAN §2a) — matnni klaviaturada YOZIB BO'LADIGAN ASCII ga keltiradi.
//
// Muammo: kitobdan yoki saytdan nusxalangan matnda klaviaturada terib bo'lmaydigan belgilar bor.
// `He said, "I don't know—maybe."` ichida `“ ’ — ”` bor. `block` rejimida kursor birinchi
// shunday belgida qotib qoladi, `Tab` ham xuddi shu holatga qaytaradi — gap hech qachon tugamaydi.
//
// Yechim: matn import paytida BIR MARTA tozalanadi va aynan tozalangan matn mashq targeti
// sifatida saqlanadi. Buning yon foydasi: tokenizator `[A-Za-z]` bo'lib qolaveradi, chunki
// kirish ASCII ekani kafolatlangan. Aks holda `naïve` -> `na`,`ve` bo'lib parchalanardi va
// `n` bosilganda `"na"` eshitilardi.
//
// Bu modul SOF: DOM, audio, tarmoq va tasodifiylik yo'q — kirish bir xil bo'lsa chiqish ham bir xil.

/** Almashtirish turi — import ekranidagi diff shu bo'yicha guruhlanadi. */
export type ChangeKind = 'diacritic' | 'quote' | 'dash' | 'space' | 'removed'

/**
 * Bir turdagi almashtirishlarning yig'ilgan hisobi.
 * `from` -> `to` juftligi bo'yicha guruhlanadi, `count` — necha marta uchraganini bildiradi.
 * Belgi butunlay olib tashlangan bo'lsa `to` bo'sh satr bo'ladi.
 */
export type NormalizeChange = {
  kind: ChangeKind
  from: string
  to: string
  count: number
}

export type NormalizeResult = {
  /** Tozalangan matn: barcha belgilar `0x20`–`0x7E` oralig'ida. */
  text: string
  /**
   * Foydalanuvchiga ko'rsatiladigan diff, PLAN §2a bosqichlari tartibida
   * (`diacritic` -> `quote` -> `dash` -> `space` -> `removed`), har turi ichida esa
   * birinchi uchrash tartibida. Hech narsa o'zgarmagan bo'lsa — bo'sh massiv.
   */
  changes: NormalizeChange[]
  /** Olib tashlangan belgilarning TAKRORLANMAS ro'yxati, birinchi uchrash tartibida. */
  removed: string[]
}

/**
 * 5-bosqichda siqilgan bo'shliqlar uchun `from` qiymati.
 * Ketma-ket bo'shliqlar uzunligi har xil bo'lgani uchun ular bitta guruhga yig'iladi —
 * "ikki yoki undan ortiq probel bittaga siqildi" degan ma'noni beradi.
 */
const COLLAPSED_SPACES = '  '

/** 1-bosqich: NFD dan keyin olib tashlanadigan birikuvchi diakritikalar oralig'i. */
const COMBINING_MARKS_RE = /[\u0300-\u036F]/g

/**
 * 4-bosqich: probel deb hisoblanadigan har qanday Unicode belgi.
 *
 * Ataylab `\s` emas, `\p{White_Space}`: JS ning `\s` sinfiga `U+FEFF` (nol enli BOM) ham kiradi,
 * u esa ENI YO'Q belgi. Uni probelga aylantirish `a﻿b` ni `a b` ga — ya'ni bitta so'zni
 * IKKITA tokenga bo'lib yuborardi. `U+FEFF` va `U+200B` kabi nol enli belgilar 6-bosqichda
 * olib tashlanadi va foydalanuvchiga `removed` ro'yxatida ko'rinadi. `\p{White_Space}` esa
 * `U+0085` (NEL) ni ham qamrab oladi, `\s` uni tashlab ketardi.
 *
 * `\n` ham shu yerda oddiy probelga aylanadi — gapga bo'lish keyin normallashtirilgan
 * matndan borgani uchun satr ko'chirish maxsus ma'noga ega emas (PLAN §2b).
 */
const WHITESPACE_RE = /\p{White_Space}/u

/** 5-bosqich: ikki va undan ortiq ketma-ket probel. */
const MULTI_SPACE_RE = / {2,}/g

const ASCII_MIN = 0x20
const ASCII_MAX = 0x7e

type Replacement = { to: string; kind: ChangeKind }

/** 2-bosqich: aqlli qo'shtirnoq va apostroflar -> ASCII. */
const QUOTE_MAP: ReadonlyMap<string, Replacement> = new Map([
  ['\u201C', { to: '"', kind: 'quote' }], // “
  ['\u201D', { to: '"', kind: 'quote' }], // ”
  ['\u201E', { to: '"', kind: 'quote' }], // „
  ['\u201F', { to: '"', kind: 'quote' }], // ‟
  ['\u2018', { to: "'", kind: 'quote' }], // ‘
  ['\u2019', { to: "'", kind: 'quote' }], // ’
  ['\u201A', { to: "'", kind: 'quote' }], // ‚
  ['\u201B', { to: "'", kind: 'quote' }], // ‛
])

/** 3-bosqich: tire va ko'p nuqta -> ASCII. */
const DASH_MAP: ReadonlyMap<string, Replacement> = new Map([
  ['\u2014', { to: '-', kind: 'dash' }], // —
  ['\u2013', { to: '-', kind: 'dash' }], // –
  ['\u2012', { to: '-', kind: 'dash' }], // ‒
  ['\u2212', { to: '-', kind: 'dash' }], // −
  ['\u2026', { to: '...', kind: 'dash' }], // …
])

/**
 * Guruhlangan o'zgarishlar jamlanmasi.
 * Kalit — `kind` + `from` + `to`; ajratgich sifatida matnda uchramaydigan `U+0000` ishlatiladi.
 */
type ChangeLog = Map<string, NormalizeChange>

/**
 * `changes` PLAN §2a jadvalidagi bosqich tartibida qaytariladi.
 * Tartib kerak, chunki 6-bosqichdagi olib tashlashdan keyin bo'shliqlar QAYTA siqiladi —
 * usiz "probel siqildi" yozuvi "belgi olib tashlandi" dan keyin tushib qolardi va
 * import ekranidagi ro'yxat tartibi kirish matniga qarab sakrab turardi.
 */
const KIND_ORDER = {
  diacritic: 0,
  quote: 1,
  dash: 2,
  space: 3,
  removed: 4,
} as const

function record(log: ChangeLog, kind: ChangeKind, from: string, to: string): void {
  const key = `${kind}\u0000${from}\u0000${to}`
  const existing = log.get(key)
  if (existing === undefined) {
    log.set(key, { kind, from, to, count: 1 })
    return
  }
  existing.count += 1
}

/**
 * 1-bosqich: NFD -> `U+0300`–`U+036F` birikuvchi diakritikalarini olib tashlash -> NFC.
 * `café` -> `cafe`, `naïve` -> `naive`.
 *
 * Diff uchun aynan qaysi belgi qaysi belgiga aylanganini bilish kerak, shuning uchun
 * butun satr emas, HAR BIR kod nuqtasi alohida normallashtiriladi. Yon foyda: kirish
 * allaqachon parchalangan holatda kelsa (`e` + `U+0301`), yolg'iz diakritika `''` ga
 * aylanadi va bu ham o'zgarish sifatida yoziladi.
 */
function stripDiacritics(input: string, log: ChangeLog): string {
  let out = ''
  for (const ch of input) {
    const folded = ch.normalize('NFD').replace(COMBINING_MARKS_RE, '').normalize('NFC')
    if (folded !== ch) {
      record(log, 'diacritic', ch, folded)
    }
    out += folded
  }
  return out
}

/** 2- va 3-bosqichlar uchun umumiy yurgizgich: jadvalda bor belgini almashtiradi. */
function replaceMapped(input: string, map: ReadonlyMap<string, Replacement>, log: ChangeLog): string {
  let out = ''
  for (const ch of input) {
    const replacement = map.get(ch)
    if (replacement === undefined) {
      out += ch
      continue
    }
    record(log, replacement.kind, ch, replacement.to)
    out += replacement.to
  }
  return out
}

/** 4-bosqich: NBSP, tor NBSP, tab, `\n` va boshqa Unicode bo'shliqlar -> oddiy probel. */
function unifySpaces(input: string, log: ChangeLog): string {
  let out = ''
  for (const ch of input) {
    if (ch !== ' ' && WHITESPACE_RE.test(ch)) {
      record(log, 'space', ch, ' ')
      out += ' '
      continue
    }
    out += ch
  }
  return out
}

/**
 * 5-bosqich: ketma-ket bo'shliqlarni bittaga siqish va `trim()`.
 *
 * `trim()` ataylab siqishdan OLDIN bajariladi — natija ayni o'sha, lekin faqat
 * bo'shliqdan iborat satr uchun "bo'shliq siqildi" degan soxta o'zgarish yozilmaydi.
 */
function collapseSpaces(input: string, log: ChangeLog): string {
  return input.trim().replace(MULTI_SPACE_RE, () => {
    record(log, 'space', COLLAPSED_SPACES, ' ')
    return ' '
  })
}

/** 6-bosqich: `0x20`–`0x7E` dan tashqari har qanday belgi olib tashlanadi va ro'yxatga yoziladi. */
function stripNonAscii(input: string, log: ChangeLog, removed: string[]): string {
  let out = ''
  for (const ch of input) {
    const code = ch.codePointAt(0)
    if (code !== undefined && code >= ASCII_MIN && code <= ASCII_MAX) {
      out += ch
      continue
    }
    record(log, 'removed', ch, '')
    if (!removed.includes(ch)) {
      removed.push(ch)
    }
  }
  return out
}

/**
 * Matnni mashq targeti sifatida ishlatsa bo'ladigan holatga keltiradi.
 *
 * Kafolatlar:
 * - `text` dagi har bir belgi `0x20`–`0x7E` oralig'ida;
 * - ketma-ket bo'shliq yo'q, bosh va oxirgi bo'shliq yo'q;
 * - funksiya idempotent: `normalize(normalize(x).text).changes` doim bo'sh.
 */
export function normalize(input: string): NormalizeResult {
  const log: ChangeLog = new Map()
  const removed: string[] = []

  let text = stripDiacritics(input, log) // 1
  text = replaceMapped(text, QUOTE_MAP, log) // 2
  text = replaceMapped(text, DASH_MAP, log) // 3
  text = unifySpaces(text, log) // 4
  text = collapseSpaces(text, log) // 5

  const kept = stripNonAscii(text, log, removed) // 6
  if (kept !== text) {
    // Olib tashlangan belgi ikki probel orasida turgan bo'lsa (`a © b`), ular endi
    // yopishib qoladi. Shuning uchun 5-bosqich siqishi qayta qo'llanadi — aks holda
    // target ichida ko'rinmas ikkilangan probel qolib, uni terish talab qilinardi.
    text = collapseSpaces(kept, log)
  }

  // `sort` ES2019 dan beri BARQAROR, shuning uchun bir xil `kind` ichida
  // birinchi uchrash tartibi saqlanadi.
  const changes = [...log.values()].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])

  return { text, changes, removed }
}

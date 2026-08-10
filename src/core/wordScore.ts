// So'z reytingi: so'nuvchi hisoblagichlar va empirik Bayes shrinkage
// (docs/stats-longterm.md §5 va §6).
//
// Sof funksiyalar: DOM, tarmoq, `localStorage` va `Date.now()` bilan ishlamaydi.
// Vaqt DOIM argument sifatida kiradi ("bugun" qaysi kun ekanini chaqiruvchi
// qatlam hal qiladi) — shu sababli har bir hisob testda aynan takrorlanadi va
// so'nish natijasi hisoblash PAYTIGA emas, faqat berilgan kunga bog'liq bo'ladi.

/** Bir sutkadagi millisekundlar — kun raqamiga o'tishda ishlatiladi. */
const MS_PER_DAY = 86_400_000

/**
 * So'nuvchi hisoblagichlarning yarim yemirilish davri, kunlarda.
 *
 * ⚠️ Bu MVP SODDALASHTIRISHI, "sanoat standarti" EMAS (§5.1). Nashr etilgan
 * tizimlarning hech biri yagona global yarim yemirilishdan foydalanmaydi:
 * Duolingo HLR yarim yemirilishni har element uchun `2^(Θ·x)` bilan hisoblaydi,
 * FSRS esa har karta uchun Stability saqlaydi — ya'ni ular buni O'RGANADI,
 * biz esa qo'lda qo'yamiz. Almashuv ongli: nol parametr, cold-start yo'q va
 * tuzatish shu konstantani o'zgartirishdan iborat.
 *
 * 90 kun: 3 oy oldingi xato bugungisining yarmiga, bir yil oldingisi ~1/16 ga teng.
 */
export const HALF_LIFE_DAYS = 90

/**
 * Shrinkage kuchi — priorning "effektiv ta'sirlanishlar soni" (§6.1).
 *
 * `m = 20` ATAYIN tanlangan, `m = 10` emas: `1/1` va `10/50` tartibi buzilmasligi
 * uchun `m > 40 / (9 − 49g)` shart. `m = 10` da zaxira `g = 0.102` da tugaydi,
 * `m = 20` da esa `g = 0.143` gacha cho'ziladi (§6.2). Bu qiymat qo'lda tanlangan;
 * uni ma'lumotdan tekshirish uchun `estimateBeta` bor.
 */
export const SHRINKAGE_M = 20

/**
 * Global xato ulushi (`g = Σdx / Σde`) hisoblab bo'lmaganda ishlatiladigan zaxira.
 *
 * Bo'sh bazada `Σde === 0` bo'ladi va `g` nolga bo'linishdan `NaN` chiqardi.
 * 0.08 — §6 jadvalidagi ish qiymati; u tanlanganda hamma so'z bir xil ball oladi,
 * ya'ni reyting "noma'lum" holatda tartibsiz emas, shunchaki neytral bo'ladi.
 */
export const DEFAULT_G = 0.08

/** `estimateBeta` ishonchli baho berishi uchun kerakli minimal qatorlar soni (§6.3). */
const MIN_RATE_ROWS = 30

/**
 * LOKAL kalendar kunining tartib raqami; 1970-01-01 (lokal) = 0.
 *
 * Sana komponentlari LOKAL vaqtda olinadi, so'ng ular UTC sifatida QAYTA
 * yig'iladi. Shuning uchun natijaga na mintaqa ofseti, na DST siljishi ta'sir
 * qiladi: har bir lokal kalendar kuni aynan bitta butun songa tushadi va
 * qo'shni kunlar DOIM 1 ga farq qiladi.
 *
 * `Math.floor((ms - offset) / 86_400_000)` varianti ATAYIN rad etildi — lekin
 * sabab "DST kunida sutka 23/25 soat" EMAS. Brute-force tekshirildi (2 yil ×
 * 15 daqiqa × 4 mintaqa): agar `offset` HAR LAHZA uchun alohida olinsa
 * (`new Date(ms).getTimezoneOffset()`), o'sha variant ham aynan shu natijani
 * beradi — nol farq. Klassik nuqson faqat ofset BIR MARTA olinib keshlanganda
 * chiqadi (masalan `const off = new Date().getTimezoneOffset()` modul yuklanish
 * paytida): shunda DST o'tishidan keyingi lahzalar noto'g'ri ofset bilan
 * siljiydi va bitta kun raqami tashlab ketiladi yoki ikkita lokal kun bitta
 * raqamga tushadi. Bu yerdagi usul ofsetni umuman ISHLATMAYDI, ya'ni uni
 * keshlash imkoniyatining o'zi yo'q — shuning uchun tanlangan.
 *
 * Chekli bo'lmagan kirish (`NaN`, `±Infinity`) uchun `NaN` qaytariladi.
 * Sabab: `dayNumber` ikki xil yo'lda ishlatiladi — SOLISHTIRISHDA (`statsCompact`
 * dagi retention filtri) va KALIT yasashda (`dayKeyOf`). `NaN` solishtiruvda
 * zararsiz (har qanday taqqoslash `false` beradi, qator eskirgan deb qaraladi),
 * yozuvda esa `dayNumberToKey` uni QAT'IY rad etadi. Shu sababli tekshiruv
 * shu yerda "portlamaydi", buzuq kalit esa hech qachon YOZILMAYDI.
 */
export function dayNumber(ms: number): number {
  if (!Number.isFinite(ms)) return Number.NaN
  const d = new Date(ms)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY)
}

/**
 * Kun raqamini `'YYYY-MM-DD'` kalitiga aylantiradi (§4.2 dagi `days` do'koni kaliti).
 *
 * `getUTC*` ishlatiladi, `getFullYear` emas: `dayNumber` sanani UTC sifatida
 * qayta yiqqan, demak teskari yo'l ham UTC bo'lishi SHART. Lokal getter bu yerda
 * mintaqa ofsetini ikkinchi marta qo'llab, kalitni bir kunga siljitardi.
 *
 * Chekli bo'lmagan `day` uchun `RangeError` TASHLANADI, `'0NaN-NaN-NaN'` kabi
 * kalit qaytarilmaydi. Tekshiruv ilgari ASSIMETRIK edi: `dayKeyToNumber` buzuq
 * kalitni o'qishda `null` bilan rad etardi, lekin yozishga hech narsa
 * to'sqinlik qilmasdi — natijada hech qachon qayta o'qib bo'lmaydigan qatorlar
 * jimgina yig'ilardi. Tashlash ataylab tanlandi: bu YOZUV yo'li, va bu yerda
 * "jimgina noto'g'ri kalit" eng yomon natija. Qaytarish tipi `string` bo'lgani
 * uchun `null` bilan rad etish ham imkonsiz.
 */
export function dayNumberToKey(day: number): string {
  if (!Number.isFinite(day)) {
    throw new RangeError(`dayNumberToKey: kun raqami chekli son bo'lishi shart, keldi: ${day}`)
  }

  const d = new Date(day * MS_PER_DAY)
  const year = String(d.getUTCFullYear()).padStart(4, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const date = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${date}`
}

/** `'YYYY-MM-DD'` shakli: uzunliklar qat'iy, aks holda `'2024-1-5'` ham o'tib ketardi. */
const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * `'YYYY-MM-DD'` kalitini kun raqamiga qaytaradi; `dayNumberToKey` ga teskari mos.
 * `dayKeyToNumber('1970-01-01') === 0`.
 *
 * Yaroqsiz kalit uchun `null`. "Yaroqsiz" faqat shakl buzilishi emas: `Date.UTC`
 * mavjud bo'lmagan sanani JIMGINA to'g'rilaydi (`'2024-02-31'` -> 2-mart), shuning
 * uchun natija qayta o'qib solishtiriladi. Bu tekshiruvsiz buzuq eksport fayli
 * yaroqli kunga aylanib, statistikani sezdirmasdan surib yuborardi.
 */
export function dayKeyToNumber(key: string): number | null {
  const match = DAY_KEY_RE.exec(key)
  if (match === null) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const date = Number(match[3])

  const ms = Date.UTC(year, month - 1, date)
  const d = new Date(ms)
  // Normallashtirish sodir bo'lgan bo'lsa — sana yo'q edi.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== date) {
    return null
  }

  return Math.floor(ms / MS_PER_DAY)
}

/**
 * `dtDays` kun ichida so'nuvchi hisoblagich necha marta kamayishi.
 * 90 kun -> 0.5, 180 kun -> 0.25, 0 kun -> 1.
 *
 * `dtDays <= 0` uchun aynan `1`: `Math.pow` manfiy darajada 1 dan KATTA son
 * qaytaradi va bu hisoblagichni SHISHIRARDI. Kelajakdagi sana hech narsani
 * "qaytarib bermasligi" kerak.
 */
export function decayFactor(dtDays: number): number {
  if (!(dtDays > 0)) return 1
  return Math.pow(0.5, dtDays / HALF_LIFE_DAYS)
}

/**
 * Qatorning so'nuvchi hisoblagichlarini `today` kuniga keltiradi (§5).
 *
 * `dt = Math.max(0, today - row.l)` — `max(0, …)` SHART: foydalanuvchi tizim
 * soatini orqaga sursa yoki mintaqani almashtirsa `today < row.l` bo'lib qoladi
 * va so'nish koeffitsienti 1 dan oshib, xato hisoblagichi o'z-o'zidan shishardi.
 *
 * Funksiya SOF: kiruvchi obyekt o'zgartirilmaydi, yangi `{de, dx}` qaytariladi.
 * `l` ataylab qaytarilmaydi — uni yangilash yozuv qatlamining ishi
 * (`row.l = Math.max(row.l, today)`), bu yerda esa faqat o'qish uchun qiymat kerak.
 *
 * Eksponensial funksiya multiplikativ, shuning uchun bu "dangasa" hisoblash har
 * kuni so'ndirish bilan matematik jihatdan AYNAN teng.
 */
export function decayed(
  row: { de: number; dx: number; l: number },
  today: number,
): { de: number; dx: number } {
  const factor = decayFactor(Math.max(0, today - row.l))
  return { de: row.de * factor, dx: row.dx * factor }
}

/**
 * Empirik Bayes shrinkage bilan so'z ballini hisoblaydi (§6.1):
 * `score = (dx + m·g) / (de + m)`. Ball qanchalik YUQORI bo'lsa, so'z shunchalik qiyin.
 *
 * `dx` — so'nuvchi xatolar, `de` — so'nuvchi ta'sirlanishlar, `g` — global xato
 * ulushi (`Σdx / Σde`). Prior kuzatilgan BAZAVIY DARAJAGA o'rnatiladi, shuning
 * uchun "bu so'z haqida ma'lumot yo'q" degani "u o'rtacha" degani bo'ladi —
 * `(dx + 0.5)/(de + 2)` kabi nomzodlar esa noma'lum so'zni yuqoriga tortardi.
 *
 * Wilson pastki chegarasi ATAYIN olinmadi (§6.6): u `1/1` ni `10/50` dan yuqori
 * qo'yishda davom etadi, ustiga u baho emas — ishonch chegarasi, va uning
 * qamrov kafolati butun sonlarni nazarda tutadi, hisoblagichlarimiz esa kasr.
 */
export function shrunkScore(dx: number, de: number, g: number, m = SHRINKAGE_M): number {
  return (dx + m * g) / (de + m)
}

/**
 * Berilgan `m` uchun `1/1` va `10/50` tartibi ag'dariladigan `g` qiymati (§6.2):
 * `g = (9 − 40/m) / 49`.
 *
 * Bundan YUQORI `g` da bitta marta ko'rilib bitta xato qilingan so'z 50 ta
 * ta'sirlanishdan 10 ta xatoli so'zdan yuqori chiqadi — ya'ni reyting ishonchsiz
 * kuzatuvni birinchi o'ringa qo'yadi. `m` ni oshirish chegarani ko'taradi, lekin
 * `m → ∞` da u `9/49 ≈ 0.184` ga to'yinadi: HECH QANDAY `m` `g ≥ 9/49` da
 * yordam bermaydi. Shuning uchun haqiqiy himoya formulada emas, minimal
 * ta'sirlanish to'sig'ida.
 *
 * ⚠️ Chekka kirishlar QO'RIQLANMAGAN, va bu ONGLI qaror: `m <= 40/9 ≈ 4.44` da
 * natija manfiy, `m = 0` da `−Infinity`. Ikkalasi ham matematik jihatdan ROST
 * javob ("bunday `m` da hech qanday `g` tartibni saqlamaydi"), chunki bu funksiya
 * — algebraik teskari ifoda, tekshiruvchi emas. Guard qo'shilsa u ROST javobni
 * `null`/`0` bilan yashirar, ustiga hech qachon bajarilmaydigan shox qo'shardi:
 * funksiya faqat `SHRINKAGE_M = 20` konstantasi bilan chaqiriladi. Agar kelajakda
 * u foydalanuvchi kiritgan `m` bilan chaqiriladigan bo'lsa, tekshiruv CHAQIRUV
 * joyida bo'lishi kerak, bu yerda emas.
 */
export function orderFlipG(m: number): number {
  return (9 - 40 / m) / 49
}

/**
 * `g` va `m` ni so'zlar populyatsiyasidan BETA-BINOMIAL momentlar usuli bilan
 * baholaydi (§6.3, §15 dagi "Method of moments for beta-binomial").
 *
 * So'zlar bo'yicha kuzatilgan xato ulushlari `p_i = errors_i / exposures_i` uchun
 * o'rtacha `μ̄` va NAMUNAVIY dispersiya `s²ₚ` (n−1 bilan; n bilan bo'lganda `m̂`
 * tizimli ravishda katta chiqardi) olinadi. Lekin `s²ₚ` — `θ` ning dispersiyasi
 * EMAS: har bir `p_i` ning o'zi `n_i` ta sinovdan olingan binomial baho, ya'ni
 *
 *     Var(p_i) = Var(θ) + E[θ(1 − θ)]·E[1/n_i]
 *
 * Ikkinchi had SOF NAMUNA OLISH shovqini. U ayrilmasa `s²ₚ` shishadi va
 * `m̂ = μ̄(1 − μ̄)/s² − 1` shuncha PASAYADI. Farq halokatli emas, FALOKATLI:
 * Beta(2, 23) dan (haqiqiy `g = 0.08`, `m = 25`) simulyatsiya qilinganda
 * ayirmasiz baho `exposures = 2000` da 25 ni to'g'ri topadi, lekin HAQIQIY so'z
 * jadvalida (`exposures` 1..20) `m̂ ≈ 3.8` beradi — §6.2 ning `g = 0.08` uchun
 * talab qilgan `m > 7.9` chegarasidan PAST. Ya'ni M4 da "konstantani ma'lumot
 * bilan tekshirib turish" bajarilsa, buzuq baho `m = 20` ni "juda katta" deb
 * ko'rsatib, uni pasaytirishga undardi — va reyting aynan §6.2 ogohlantirgan
 * tarzda ag'darilardi. Shuning uchun binomial had ayriladi:
 *
 *     μ̄     = mean(p_i)
 *     s²ₜ   = s²ₚ − μ̄(1 − μ̄)·mean(1/n_i)     // θ ning HAQIQIY dispersiyasi
 *     ĝ     = μ̄                              // α / (α + β)
 *     m̂     = μ̄(1 − μ̄) / s²ₜ − 1             // α + β
 *
 * `null` qaytariladi va bu ODATIY natija, xato emas: kam ma'lumotda `m̂` beqaror,
 * beqaror bahoni ko'rsatish esa uni ishonchli deb ko'rsatishdan YOMONROQ. Shartlar:
 * - qatorlar soni `MIN_RATE_ROWS` dan kam;
 * - hamma nisbat AYNAN bir xil (pastdagi izohga qarang);
 * - `μ̄` 0 yoki 1 — Beta prior bunday chekkada aniqlanmagan;
 * - `s²ₜ <= 0` — kuzatilgan tarqoqlikni SOF binomial shovqin tushuntirib beradi,
 *   ya'ni so'zlar orasida haqiqiy farq borligini isbotlab bo'lmaydi. Kichik
 *   `n_i` larda bu ODATIY natija, xato emas — va aynan shu holatda `m̂` ni
 *   ko'rsatish eng zararli bo'lardi: u sof shovqindan yasalgan son bo'lardi;
 * - `m̂` chekli-musbat emas (buzuq qatorlardan kelgan `NaN` ham shu yerda
 *   ushlanadi).
 */
export function estimateBeta(
  rates: Array<{ errors: number; exposures: number }>,
): { g: number; m: number } | null {
  const n = rates.length
  if (n < MIN_RATE_ROWS) return null

  const ratios = rates.map((r) => r.errors / r.exposures)

  let sum = 0
  for (const p of ratios) sum += p
  const mean = sum / n

  // Chekka holatlar: Beta prior faqat (0, 1) ochiq oralig'ida ma'noga ega.
  // Bu tekshiruv `NaN` ni ham ushlaydi (buzuq `exposures: 0` qatori).
  if (!(mean > 0 && mean < 1)) return null

  // Hamma nisbat bir xil bo'lsa dispersiya AYNAN nol — lekin suzuvchi nuqta
  // arifmetikasi buni ko'rsatmaydi: 40 ta `0.08` ning o'rtachasi
  // 0.080000000000000043 chiqadi va qoldiq shovqin `s² ≈ 2e-33` beradi, undan esa
  // `m̂ ≈ 4e31` — chekli, musbat va butunlay ma'nosiz. Shuning uchun bir xillik
  // dispersiya orqali emas, to'g'ridan-to'g'ri solishtirish bilan tekshiriladi:
  // epsilon tanlash shart emas, natija determinik.
  const first = ratios[0]
  if (ratios.every((p) => p === first)) return null

  let squaredDiff = 0
  for (const p of ratios) squaredDiff += (p - mean) * (p - mean)
  const observedVariance = squaredDiff / (n - 1)

  // `mean(1/n_i)`: buzuq `exposures: 0` qatori bu yerda `Infinity` beradi va
  // `trueVariance` `−Infinity` bo'lib pastdagi qorovulga tushadi (yuqoridagi
  // `mean` tekshiruvi allaqachon ushlagan bo'lsa ham, ikkinchi to'siq zarar qilmaydi).
  let inverseSum = 0
  for (const r of rates) inverseSum += 1 / r.exposures
  const meanInverseExposures = inverseSum / n

  const binomialNoise = mean * (1 - mean) * meanInverseExposures
  const trueVariance = observedVariance - binomialNoise

  if (!(trueVariance > 0)) return null

  const m = (mean * (1 - mean)) / trueVariance - 1
  if (!Number.isFinite(m) || m <= 0) return null

  return { g: mean, m }
}

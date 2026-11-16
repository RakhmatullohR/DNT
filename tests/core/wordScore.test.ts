import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_G,
  HALF_LIFE_DAYS,
  SHRINKAGE_M,
  dayKeyToNumber,
  dayNumber,
  dayNumberToKey,
  decayFactor,
  decayed,
  estimateBeta,
  orderFlipG,
  shrunkScore,
} from '../../src/core/wordScore.ts'

// ---------------------------------------------------------------------------
// §6 — reyting formulasi
// ---------------------------------------------------------------------------

describe('shrunkScore', () => {
  // docs/stats-longterm.md §6.1 dagi namunaviy tartib, raqamma-raqam.
  // Bu jadval hujjatning yagona SONLI shartnomasi: konstanta yoki formula
  // beixtiyor o'zgarsa, aynan shu yerda yiqiladi.
  const G = 0.08
  const M = 20

  it('5/10 (eng qiyin) -> 0.2200', () => {
    expect(shrunkScore(5, 10, G, M)).toBeCloseTo(0.22, 4)
  })

  it('3/3 -> 0.2000', () => {
    expect(shrunkScore(3, 3, G, M)).toBeCloseTo(0.2, 4)
  })

  it('10/50 -> 0.1657', () => {
    expect(shrunkScore(10, 50, G, M)).toBeCloseTo(0.1657, 4)
  })

  it('2/3 -> 0.1565', () => {
    expect(shrunkScore(2, 3, G, M)).toBeCloseTo(0.1565, 4)
  })

  it('1/1 -> 0.1238', () => {
    expect(shrunkScore(1, 1, G, M)).toBeCloseTo(0.1238, 4)
  })

  it('20/200 -> 0.0982', () => {
    expect(shrunkScore(20, 200, G, M)).toBeCloseTo(0.0982, 4)
  })

  it('0/20 (eng oson) -> 0.0400', () => {
    expect(shrunkScore(0, 20, G, M)).toBeCloseTo(0.04, 4)
  })

  it("⭐ 1/1 so'z 10/50 dan PASTROQ turadi", () => {
    // Formulaning butun mavjud bo'lish sababi shu bitta taqqoslashda.
    // Xom nisbat buni 1.000 va 0.200 bilan buzardi, Wilson pastki chegarasi esa
    // 0.207 va 0.112 bilan — ya'ni ikkalasi ham bir marta ko'rilgan so'zni
    // birinchi o'ringa chiqarardi (§6 jadvali).
    expect(shrunkScore(1, 1, G, M)).toBeLessThan(shrunkScore(10, 50, G, M))

    // Xom nisbat esa aynan teskari tartib beradi — farq shu yerda ko'rinadi.
    expect(1 / 1).toBeGreaterThan(10 / 50)
  })

  it("jadvalning to'liq tartibi kutilgan ketma-ketlikda chiqadi", () => {
    const rows: Array<[string, number, number]> = [
      ['5/10', 5, 10],
      ['3/3', 3, 3],
      ['10/50', 10, 50],
      ['2/3', 2, 3],
      ['1/1', 1, 1],
      ['20/200', 20, 200],
      ['0/20', 0, 20],
    ]

    const sorted = [...rows]
      .sort((a, b) => shrunkScore(b[1], b[2], G, M) - shrunkScore(a[1], a[2], G, M))
      .map(([label]) => label)

    expect(sorted).toEqual(['5/10', '3/3', '10/50', '2/3', '1/1', '20/200', '0/20'])
  })

  it('`m` berilmasa SHRINKAGE_M ishlatiladi', () => {
    expect(shrunkScore(1, 1, G)).toBe(shrunkScore(1, 1, G, SHRINKAGE_M))
    expect(SHRINKAGE_M).toBe(20)
  })

  it("ma'lumot yo'q bo'lgan so'z aynan `g` ni oladi — ne yuqori, ne past", () => {
    // Prior kuzatilgan bazaviy darajaga o'rnatilgani shundan ko'rinadi:
    // 0/0 so'z uchun ball (0 + m·g) / (0 + m) = g.
    expect(shrunkScore(0, 0, DEFAULT_G)).toBeCloseTo(DEFAULT_G, 12)
  })

  it("ta'sirlanish o'sgani sari ball xom nisbatga yaqinlashadi", () => {
    // Shrinkage ma'lumot ko'paygach o'z ta'sirini yo'qotishi kerak: `m` sobit,
    // `de` esa o'sib boradi, ya'ni prior ulushi 0 ga intiladi.
    const gap = (dx: number, de: number) => Math.abs(shrunkScore(dx, de, G, M) - dx / de)

    expect(gap(5, 10)).toBeGreaterThan(gap(50, 100))
    expect(gap(50, 100)).toBeGreaterThan(gap(5000, 10_000))
    expect(shrunkScore(5000, 10_000, G, M)).toBeCloseTo(0.5, 2)
    expect(shrunkScore(50_000, 100_000, G, M)).toBeCloseTo(0.5, 3)
  })
})

describe('orderFlipG', () => {
  it('m=10 -> 0.102', () => {
    expect(orderFlipG(10)).toBeCloseTo(0.102, 3)
  })

  it('m=20 -> 0.1429 (tanlangan qiymatning haqiqiy zaxirasi)', () => {
    expect(orderFlipG(20)).toBeCloseTo(0.1429, 4)
  })

  it("m -> ∞ limiti 9/49 ≈ 0.1837 — nazariy chegara", () => {
    expect(orderFlipG(1e12)).toBeCloseTo(9 / 49, 10)
    expect(9 / 49).toBeCloseTo(0.1837, 4)
  })

  it("`m` ni oshirish zaxirani kengaytiradi, lekin 9/49 dan oshirmaydi", () => {
    expect(orderFlipG(20)).toBeGreaterThan(orderFlipG(10))
    for (const m of [10, 20, 50, 1000, 1e9]) {
      expect(orderFlipG(m)).toBeLessThan(9 / 49)
    }
  })

  it("chegaradan yuqori `g` da tartib haqiqatan ag'dariladi", () => {
    const m = 20
    const flip = orderFlipG(m)

    // Chegaradan sal past: tartib hali to'g'ri.
    expect(shrunkScore(1, 1, flip - 0.01, m)).toBeLessThan(shrunkScore(10, 50, flip - 0.01, m))
    // Chegaradan sal yuqori: 1/1 so'z 10/50 dan yuqori chiqib ketadi.
    expect(shrunkScore(1, 1, flip + 0.01, m)).toBeGreaterThan(shrunkScore(10, 50, flip + 0.01, m))
    // Va HECH QANDAY `m` `g >= 9/49` da yordam bermaydi.
    for (const bigM of [20, 100, 10_000]) {
      expect(shrunkScore(1, 1, 9 / 49, bigM)).toBeGreaterThan(shrunkScore(10, 50, 9 / 49, bigM))
    }
  })
})

// ---------------------------------------------------------------------------
// §5 — so'nish
// ---------------------------------------------------------------------------

describe('decayFactor', () => {
  it('90 kun (yarim yemirilish) -> aynan 0.5', () => {
    expect(decayFactor(HALF_LIFE_DAYS)).toBe(0.5)
    expect(decayFactor(90)).toBe(0.5)
  })

  it('180 kun -> aynan 0.25', () => {
    expect(decayFactor(180)).toBe(0.25)
  })

  it("bir yil -> ~1/16 (hujjatdagi da'vo)", () => {
    // 360 kun = aynan 4 ta yarim yemirilish -> 1/16.
    expect(decayFactor(360)).toBeCloseTo(1 / 16, 12)
    expect(decayFactor(365)).toBeCloseTo(0.0601, 4)
    expect(decayFactor(365)).toBeLessThan(1 / 16)
  })

  it('0 kun -> 1', () => {
    expect(decayFactor(0)).toBe(1)
  })

  it("manfiy kun -> 1, 1 dan KATTA emas (hisoblagich shishmasin)", () => {
    expect(decayFactor(-5)).toBe(1)
    expect(decayFactor(-1000)).toBe(1)
  })

  it("multiplikativ: 30 + 60 kun = bir yo'la 90 kun", () => {
    // §5 dagi "dangasa hisoblash aniq natija beradi" da'vosining o'zi.
    expect(decayFactor(30) * decayFactor(60)).toBeCloseTo(decayFactor(90), 12)
    expect(decayFactor(7) * decayFactor(7) * decayFactor(7)).toBeCloseTo(decayFactor(21), 12)
  })
})

describe('decayed', () => {
  it("bosqichma-bosqich so'ndirish bir yo'la so'ndirish bilan AYNAN teng", () => {
    // 30 kun so'ndirib, so'ng yana 60 kun so'ndirish = bir yo'la 90 kun.
    const start = { de: 40, dx: 6, l: 0 }

    const afterThirty = decayed(start, 30)
    const stepwise = decayed({ ...afterThirty, l: 30 }, 90)
    const oneShot = decayed(start, 90)

    expect(stepwise.de).toBeCloseTo(oneShot.de, 12)
    expect(stepwise.dx).toBeCloseTo(oneShot.dx, 12)
    expect(oneShot.de).toBeCloseTo(20, 12) // 40 * 0.5
    expect(oneShot.dx).toBeCloseTo(3, 12) // 6 * 0.5
  })

  it("bugun `l` ga teng bo'lsa qiymat o'zgarmaydi", () => {
    const out = decayed({ de: 12, dx: 3, l: 100 }, 100)
    expect(out.de).toBe(12)
    expect(out.dx).toBe(3)
  })

  it("today < row.l bo'lsa qiymat SHISHMAYDI (soat orqaga ketgan holat)", () => {
    // Foydalanuvchi tizim soatini orqaga sursa yoki mintaqani almashtirsa
    // `dt` manfiy bo'lardi va `Math.pow(0.5, manfiy)` hisoblagichni oshirardi.
    const out = decayed({ de: 12, dx: 3, l: 100 }, 40)
    expect(out.de).toBe(12)
    expect(out.dx).toBe(3)
    expect(out.de).not.toBeGreaterThan(12)
    expect(out.dx).not.toBeGreaterThan(3)
  })

  it("SOF: kiruvchi obyektni o'zgartirmaydi", () => {
    const row = { de: 40, dx: 6, l: 0 }
    decayed(row, 90)
    expect(row).toEqual({ de: 40, dx: 6, l: 0 })
  })

  it("nol hisoblagichlar nol bo'lib qoladi", () => {
    const out = decayed({ de: 0, dx: 0, l: 0 }, 5000)
    expect(out.de).toBe(0)
    expect(out.dx).toBe(0)
  })

  it("nisbat so'nishdan keyin saqlanadi — faqat og'irlik kamayadi", () => {
    const out = decayed({ de: 50, dx: 10, l: 0 }, 90)
    expect(out.dx / out.de).toBeCloseTo(10 / 50, 12)
    expect(out.de).toBeLessThan(50)
  })
})

// ---------------------------------------------------------------------------
// Kun raqamlari va `'YYYY-MM-DD'` kalitlari (§4.2)
// ---------------------------------------------------------------------------

describe('dayNumber', () => {
  it('1970-01-01 (lokal) -> 0', () => {
    expect(dayNumber(new Date(1970, 0, 1, 12, 0, 0).getTime())).toBe(0)
  })

  it("bir kun ichidagi har qanday vaqt bir xil raqam beradi", () => {
    const early = dayNumber(new Date(2024, 5, 15, 0, 0, 1).getTime())
    const noon = dayNumber(new Date(2024, 5, 15, 12, 30, 0).getTime())
    const late = dayNumber(new Date(2024, 5, 15, 23, 59, 59).getTime())

    expect(noon).toBe(early)
    expect(late).toBe(early)
  })

  it("qo'shni kunlar aynan 1 ga farq qiladi", () => {
    const a = dayNumber(new Date(2024, 5, 15, 23, 59, 59).getTime())
    const b = dayNumber(new Date(2024, 5, 16, 0, 0, 0).getTime())
    expect(b - a).toBe(1)
  })

  it("butun yil davomida qo'shni kunlar farqi DOIM 1 (DST kunlari ham)", () => {
    // Bu tekshiruv mintaqadan mustaqil: agar mashina DST'li mintaqada bo'lsa,
    // bahor va kuz o'tish kunlari shu siklga tushadi. `(ms - offset) / 86400000`
    // uslubidagi hisob aynan shu yerda bir kunni tashlab ketardi.
    let previous = dayNumber(new Date(2024, 0, 1, 12, 0, 0).getTime())
    for (let i = 1; i <= 365; i += 1) {
      // Lokal konstruktor oy chegarasini o'zi normallashtiradi.
      const current = dayNumber(new Date(2024, 0, 1 + i, 12, 0, 0).getTime())
      expect(current - previous).toBe(1)
      previous = current
    }
  })

  it("kun raqami monoton o'sadi", () => {
    expect(dayNumber(new Date(2024, 0, 1, 12).getTime())).toBeLessThan(
      dayNumber(new Date(2025, 0, 1, 12).getTime()),
    )
    expect(dayNumber(new Date(1969, 11, 31, 12).getTime())).toBe(-1)
  })
})

describe('dayNumber — majburiy DST mintaqasida', () => {
  const originalTz = process.env.TZ

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ
    else process.env.TZ = originalTz
  })

  it("bahorgi 23 soatlik sutkada ham qo'shni kunlar 1 ga farq qiladi", () => {
    // 2024-03-10, America/New_York: soat 02:00 dan 03:00 ga sakraydi.
    process.env.TZ = 'America/New_York'

    // ⚠️ `process.env.TZ` mutatsiyasi HAQIQATAN qo'llanganini tasdiqlaymiz.
    // Bu qatorsiz, TZ mutatsiyasi ishlamay qolsa (Node yoki vitest worker pool
    // xulqi o'zgarsa) pastdagi tasdiqlar UTC mintaqasida ham o'tib ketardi va
    // test JIMGINA bo'sh bo'lib qolardi. 2024-03-10 tushida NY = EDT = UTC−4.
    expect(new Date(2024, 2, 10, 12).getTimezoneOffset()).toBe(240)
    // O'tishdan oldingi kun esa hali EST = UTC−5 — ya'ni sutka haqiqatan 23 soat.
    expect(new Date(2024, 2, 9, 12).getTimezoneOffset()).toBe(300)

    const before = dayNumber(new Date(2024, 2, 9, 12, 0, 0).getTime())
    const dstDay = dayNumber(new Date(2024, 2, 10, 12, 0, 0).getTime())
    const after = dayNumber(new Date(2024, 2, 11, 12, 0, 0).getTime())

    expect(dstDay - before).toBe(1)
    expect(after - dstDay).toBe(1)
    expect(dayNumberToKey(dstDay)).toBe('2024-03-10')
  })

  it("kuzgi 25 soatlik sutkada ikkita lokal kun bitta raqamga tushmaydi", () => {
    // 2024-11-03, America/New_York: 01:00–02:00 ikki marta takrorlanadi.
    process.env.TZ = 'America/New_York'

    // TZ haqiqatan qo'llangani (yuqoridagi izohga qarang): 2024-11-02 tushida
    // NY = EDT = UTC−4, 2024-11-03 tushida esa allaqachon EST = UTC−5.
    expect(new Date(2024, 10, 2, 12).getTimezoneOffset()).toBe(240)
    expect(new Date(2024, 10, 3, 12).getTimezoneOffset()).toBe(300)

    const before = dayNumber(new Date(2024, 10, 2, 12, 0, 0).getTime())
    const dstDay = dayNumber(new Date(2024, 10, 3, 12, 0, 0).getTime())
    const after = dayNumber(new Date(2024, 10, 4, 12, 0, 0).getTime())

    expect(dstDay - before).toBe(1)
    expect(after - dstDay).toBe(1)
    expect(dayNumberToKey(dstDay)).toBe('2024-11-03')
  })

  it("chekka mintaqalarda kalit UTC lahzaga EMAS, lokal sanaga bog'lanadi", () => {
    // ⚠️ Bu test ilgari `new Date(2024, 6, 4, ...)` dan kalit yasab, uni
    // `'2024-07-04'` bilan solishtirardi. U SOXTA edi: sana LOKAL komponentlardan
    // qurilib, `dayNumber` o'sha LOKAL komponentlarni qaytadan o'qigani uchun
    // natija HAR QANDAY mintaqada bir xil chiqardi — `process.env.TZ` bezak edi.
    //
    // Haqiqiy farqni faqat UTC bilan TAQQOSLASH ko'rsatadi: sodda
    // `Math.floor(ms / 86_400_000)` varianti aynan shu ikki lahzada BOSHQA kun
    // beradi, va farqning ishorasi mintaqaga qarab teskari bo'ladi.
    const utcDay = (ms: number) => Math.floor(ms / 86_400_000)

    process.env.TZ = 'Pacific/Kiritimati' // UTC+14
    const eastMs = new Date(2024, 6, 4, 1, 0, 0).getTime()
    // TZ qo'llangani: lokal 04-iyul 01:00 = UTC 03-iyul 11:00.
    expect(new Date(eastMs).getUTCDate()).toBe(3)
    expect(dayNumberToKey(dayNumber(eastMs))).toBe('2024-07-04')
    // Sodda UTC hisobi bu yerda bir kun ORQADA qolardi.
    expect(utcDay(eastMs)).toBe(dayNumber(eastMs) - 1)

    process.env.TZ = 'Pacific/Midway' // UTC−11
    const westMs = new Date(2024, 6, 4, 23, 0, 0).getTime()
    // TZ qo'llangani: lokal 04-iyul 23:00 = UTC 05-iyul 10:00.
    expect(new Date(westMs).getUTCDate()).toBe(5)
    expect(dayNumberToKey(dayNumber(westMs))).toBe('2024-07-04')
    // Bu yerda esa sodda UTC hisobi bir kun OLDINDA ketardi — ya'ni xato
    // mintaqaga qarab ikkala tomonga ham og'adi, doimiy siljish emas.
    expect(utcDay(westMs)).toBe(dayNumber(westMs) + 1)
  })
})

describe('dayNumber / dayNumberToKey — chekli bo\'lmagan kirish', () => {
  it("dayNumber chekli bo'lmagan kirishda NaN qaytaradi", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(Number.isNaN(dayNumber(bad))).toBe(true)
    }
  })

  it("NaN kun raqami SOLISHTIRUVDA zararsiz — filtr qatorni o'tkazib yubormaydi", () => {
    // `statsCompact` dagi `dayNumber(row.endedAt) >= cutoffDay` shakli:
    // `NaN` bilan har qanday taqqoslash `false`, ya'ni qator "yangi" deb
    // hisoblanmaydi va jimgina abadiy saqlanib qolmaydi.
    expect(dayNumber(Number.NaN) >= 0).toBe(false)
    expect(dayNumber(Number.NaN) < 0).toBe(false)
  })

  it("⭐ buzuq kun raqamidan KALIT YOZILMAYDI — dayNumberToKey tashlaydi", () => {
    // Tekshiruv ilgari ASSIMETRIK edi: `dayNumberToKey(dayNumber(NaN))`
    // `'0NaN-NaN-NaN'` kalitini QAYTARARDI, `dayKeyToNumber` esa uni o'qishda
    // `null` bilan rad etardi — ya'ni hech qachon qayta o'qib bo'lmaydigan
    // qatorlar jimgina yig'ilardi.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => dayNumberToKey(bad)).toThrow(RangeError)
    }
    expect(() => dayNumberToKey(dayNumber(Number.NaN))).toThrow(RangeError)

    // Va simmetriya tiklandi: eski buzuq kalit o'qishda ham rad etilar edi,
    // endi u umuman YASALMAYDI.
    expect(dayKeyToNumber('0NaN-NaN-NaN')).toBeNull()
  })

  it("chekli kirishda hech narsa o'zgarmagan", () => {
    expect(dayNumberToKey(0)).toBe('1970-01-01')
    expect(() => dayNumberToKey(19_782)).not.toThrow()
  })
})

describe('dayNumberToKey / dayKeyToNumber', () => {
  it("'1970-01-01' <-> 0", () => {
    expect(dayKeyToNumber('1970-01-01')).toBe(0)
    expect(dayNumberToKey(0)).toBe('1970-01-01')
  })

  it("ma'lum sanalar to'g'ri kalit beradi", () => {
    expect(dayNumberToKey(1)).toBe('1970-01-02')
    expect(dayNumberToKey(-1)).toBe('1969-12-31')
    expect(dayKeyToNumber('2024-02-29')).toBe(19_782)
    expect(dayNumberToKey(19_782)).toBe('2024-02-29')
  })

  it('teskari moslik: raqam -> kalit -> raqam', () => {
    for (const day of [-3650, -1, 0, 1, 19_000, 19_782, 25_000]) {
      expect(dayKeyToNumber(dayNumberToKey(day))).toBe(day)
    }
  })

  it("teskari moslik: kalit -> raqam -> kalit", () => {
    for (const key of ['1970-01-01', '1999-12-31', '2000-02-29', '2024-11-03', '2100-03-01']) {
      const day = dayKeyToNumber(key)
      expect(day).not.toBeNull()
      expect(dayNumberToKey(day as number)).toBe(key)
    }
  })

  it("`dayNumber` bilan mos: bugungi lahza -> kalit -> o'sha kun raqami", () => {
    const day = dayNumber(new Date(2024, 10, 3, 18, 45, 0).getTime())
    expect(dayKeyToNumber(dayNumberToKey(day))).toBe(day)
  })

  it("yaroqsiz shakl -> null", () => {
    for (const key of ['', '2024-1-5', '2024/01/05', '20240105', 'salom', '2024-01-05T00:00:00']) {
      expect(dayKeyToNumber(key)).toBeNull()
    }
  })

  it("mavjud bo'lmagan sana -> null (jimgina to'g'rilanmaydi)", () => {
    // `Date.UTC` '2024-02-31' ni 2-martga surib yuborardi va buzuq eksport
    // fayli yaroqli kunga aylanib qolardi.
    expect(dayKeyToNumber('2024-02-31')).toBeNull()
    expect(dayKeyToNumber('2023-02-29')).toBeNull() // 2023 kabisa emas
    expect(dayKeyToNumber('2024-13-01')).toBeNull()
    expect(dayKeyToNumber('2024-00-10')).toBeNull()
    expect(dayKeyToNumber('2024-04-31')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// §6.3 — `m` ni ma'lumotdan baholash
// ---------------------------------------------------------------------------

/** Determinik LCG: test hech qachon "ba'zan" yiqilmasligi uchun global `Math.random` ishlatilmaydi. */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 4_294_967_296
  }
}

/**
 * Beta(α, β) dan namuna — butun α, β uchun bu `α + β − 1` ta tekis sonning
 * α-tartibli statistikasi. Kutubxonasiz va aynan taqsimotdan.
 */
function betaSample(rand: () => number, alpha: number, beta: number): number {
  const uniforms = Array.from({ length: alpha + beta - 1 }, rand).sort((a, b) => a - b)
  return uniforms[alpha - 1] as number
}

/**
 * Beta(2, 23) dan olingan sintetik qatorlar: haqiqiy `g = 2/25 = 0.08`, `m = 25`.
 *
 * `exposures` ataylab KATTA olingan: shunda `errors / exposures` amalda Beta
 * qiymatining o'zi bo'ladi va binomial shovqin dispersiyani shishirmaydi.
 * Bu — CHEGARAVIY holat: binomial tuzatish hadi bu yerda deyarli nol
 * (`mean(1/n) = 5e-4`), ya'ni test sof momentlar bahosini tekshiradi.
 * Haqiqiy so'z jadvali rejimi uchun `binomialRows` ga qarang.
 */
function betaRows(count: number, seed: number): Array<{ errors: number; exposures: number }> {
  const rand = makeLcg(seed)
  const exposures = 2000
  return Array.from({ length: count }, () => ({
    errors: Math.round(betaSample(rand, 2, 23) * exposures),
    exposures,
  }))
}

/**
 * ⭐ HAQIQIY rejim: `θ_i ~ Beta(2, 23)` (`g = 0.08`, `m = 25`), `exposures` 1..20
 * oralig'ida, `errors ~ Binomial(exposures, θ_i)`.
 *
 * Bu — so'z jadvalining rostgo'y modeli: ko'pchilik so'z bir necha marta ko'rilgan,
 * yuzlab marta emas. Aynan shu rejimda `p_i = errors_i / exposures_i` ning
 * dispersiyasi `Var(θ)` dan KATTA bo'ladi (binomial namuna olish shovqini
 * qo'shiladi) va tuzatilmagan momentlar usuli `m̂` ni pastga tortadi.
 *
 * Hammasi DETERMINIK: `Math.random()` ishlatilmaydi, faqat `makeLcg` seed'i.
 */
function binomialRows(
  count: number,
  seed: number,
): Array<{ errors: number; exposures: number }> {
  const rand = makeLcg(seed)
  return Array.from({ length: count }, () => {
    const theta = betaSample(rand, 2, 23)
    const exposures = 1 + Math.floor(rand() * 20) // 1..20
    let errors = 0
    for (let i = 0; i < exposures; i += 1) if (rand() < theta) errors += 1
    return { errors, exposures }
  })
}

/** Tuzatilmagan (ESKI) baho — regressiya qorovuli sifatida testda takrorlangan. */
function naiveM(rows: Array<{ errors: number; exposures: number }>): number {
  const n = rows.length
  const ratios = rows.map((r) => r.errors / r.exposures)
  const mean = ratios.reduce((a, b) => a + b, 0) / n
  const variance = ratios.reduce((a, p) => a + (p - mean) * (p - mean), 0) / (n - 1)
  return (mean * (1 - mean)) / variance - 1
}

describe('estimateBeta', () => {
  it("ma'lum Beta(2, 23) dan olingan ma'lumotda g va m kutilgan oraliqda", () => {
    // Haqiqiy qiymatlar: g = 2/25 = 0.08, m = 2 + 23 = 25.
    const out = estimateBeta(betaRows(400, 12_345))

    expect(out).not.toBeNull()
    const { g, m } = out as { g: number; m: number }

    expect(g).toBeGreaterThan(0.06)
    expect(g).toBeLessThan(0.1)
    expect(g).toBeCloseTo(0.08, 2)

    expect(m).toBeGreaterThan(15)
    expect(m).toBeLessThan(40)
  })

  it("baholangan m qo'lda tanlangan SHRINKAGE_M bilan BIR XIL xulosaga olib keladi", () => {
    // §6.3 ning maqsadi: konstantani ma'lumot bilan tekshirib turish. Ma'noli
    // tasdiq — ikkalasi ham §6.2 talabining BIR XIL tomonida ekani, ya'ni
    // ma'lumot `m = 20` ni RAD ETMAYDI.
    //
    // ⚠️ Bu yerda ilgari `Math.abs(m − 20) < 20` turardi, ya'ni amalda `0 < m < 40` —
    // yuqoridagi test allaqachon `15 < m < 40` ni tasdiqlagani uchun u QAT'IY
    // zaifroq va hech qanday yangi ma'lumot bermasdi.
    const out = estimateBeta(betaRows(400, 12_345))
    expect(out).not.toBeNull()
    const { g, m } = out as { g: number; m: number }

    // §6.2: `1/1` va `10/50` tartibi saqlanishi uchun `m > 40 / (9 − 49g)`.
    const required = 40 / (9 - 49 * g)
    expect(required).toBeLessThan(SHRINKAGE_M) // qo'lda tanlangan qiymat yetarli
    expect(required).toBeLessThan(m) // ma'lumotdan chiqqan baho ham yetarli

    // Va baho konstantadan ikki barobardan ortiq chetlashmaydi — M4 da
    // "konstantani qayta ko'rib chiqish kerak" signalining haqiqiy chegarasi.
    expect(m).toBeGreaterThan(SHRINKAGE_M / 2)
    expect(m).toBeLessThan(SHRINKAGE_M * 2)
  })

  it("30 tadan kam qator -> null (beqaror bahoni ko'rsatgandan ko'ra hech narsa yaxshi)", () => {
    expect(estimateBeta(betaRows(29, 12_345))).toBeNull()
    expect(estimateBeta(betaRows(1, 12_345))).toBeNull()
    expect(estimateBeta([])).toBeNull()
  })

  it("aynan 30 qator -> baho beriladi (chegara qamrab olingan)", () => {
    expect(estimateBeta(betaRows(30, 12_345))).not.toBeNull()
  })

  it("hamma qator bir xil nisbatda (s² = 0) -> null", () => {
    const flat = Array.from({ length: 40 }, () => ({ errors: 2, exposures: 25 }))
    expect(estimateBeta(flat)).toBeNull()
  })

  it("hamma qatorda xato yo'q (μ̄ = 0) -> null", () => {
    const clean = Array.from({ length: 40 }, () => ({ errors: 0, exposures: 10 }))
    expect(estimateBeta(clean)).toBeNull()
  })

  it("hamma qator butunlay xato (μ̄ = 1) -> null", () => {
    const broken = Array.from({ length: 40 }, () => ({ errors: 10, exposures: 10 }))
    expect(estimateBeta(broken)).toBeNull()
  })

  it("dispersiya juda katta bo'lsa (m̂ <= 0) -> null", () => {
    // Yarmi 0%, yarmi 100%: s²ₚ = 0.256 > μ̄(1 − μ̄) = 0.25, ya'ni m̂ manfiy.
    //
    // `exposures` KATTA olingan: 1000 ta ta'sirlanishda binomial shovqin hadi
    // 0.25·(1/1000) = 0.00025, ya'ni s²ₜ hamon 0.25 dan yuqori va m̂ manfiy.
    // (`exposures = 10` da tuzatish hadi 0.025 bo'lib, s²ₜ ni 0.25 dan pastga
    // tushirar va m̂ ≈ +0.08 chiqardi — ya'ni test o'z niyatini yo'qotardi.)
    const polar = Array.from({ length: 40 }, (_, i) => ({
      errors: i % 2 === 0 ? 0 : 1000,
      exposures: 1000,
    }))
    expect(estimateBeta(polar)).toBeNull()
  })

  it("⭐ tarqoqlikni SOF binomial shovqin tushuntirsa (s²ₜ <= 0) -> null", () => {
    // 40 ta so'z, har biri 4 marta ko'rilgan; 10 tasida bitta xato, 30 tasida yo'q.
    // μ̄ = 0.0625, s²ₚ = 0.01202, binomial had = 0.0625·0.9375·0.25 = 0.01465.
    // s²ₜ = −0.0026 < 0: bu tarqoqlikni BITTA umumiy `θ` dan olingan binomial
    // namuna ham chiqarardi, ya'ni so'zlar orasida haqiqiy farq borligini
    // isbotlab bo'lmaydi. Kichik `n_i` larda bu ODATIY natija, xato emas.
    const pureBinomial = [
      ...Array.from({ length: 10 }, () => ({ errors: 1, exposures: 4 })),
      ...Array.from({ length: 30 }, () => ({ errors: 0, exposures: 4 })),
    ]

    // Tuzatishsiz bu ma'lumot "chekli, musbat" m̂ bergan bo'lardi — ya'ni sof
    // shovqindan yasalgan sonni ishonchli baho sifatida ko'rsatardi.
    expect(naiveM(pureBinomial)).toBeGreaterThan(0)
    expect(estimateBeta(pureBinomial)).toBeNull()
  })

  it("buzuq qator (exposures = 0) natijani NaN qilib chiqarmaydi -> null", () => {
    const rows = betaRows(40, 7)
    rows[0] = { errors: 3, exposures: 0 }
    expect(estimateBeta(rows)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// §6.3 — HAQIQIY rejim: kichik `exposures` da binomial shovqin
// ---------------------------------------------------------------------------

describe('estimateBeta — binomial shovqin tuzatilgani (§6.3)', () => {
  // Haqiqiy qiymatlar: Beta(2, 23) -> g = 0.08, m = 25.
  const TRUE_M = 25

  it("⭐ exposures 1..20 (haqiqiy so'z jadvali) da m̂ 25 ga YAQIN chiqadi", () => {
    const out = estimateBeta(binomialRows(2000, 12_345))

    expect(out).not.toBeNull()
    const { g, m } = out as { g: number; m: number }

    expect(g).toBeCloseTo(0.08, 2)

    // Baho binomial tuzatishdan keyin ham SHOVQINLI (s²ₜ ikkita yaqin sonning
    // ayirmasi), shuning uchun nuqta emas, ORALIQ tasdiqlanadi. Muhimi — u
    // haqiqiy 25 atrofida, tuzatishsizdagi ~3.8 da emas.
    expect(m).toBeGreaterThan(12)
    expect(m).toBeLessThan(60)
    expect(Math.abs(m - TRUE_M)).toBeLessThan(TRUE_M)
  })

  it("⭐ REGRESSIYA: aynan shu ma'lumotda m̂ §6.2 chegarasidan (7.9) YUQORI", () => {
    // §6.2: `g = 0.08` da tartib saqlanishi uchun `m > 40/(9 − 49·0.08) = 7.9`.
    // Tuzatilmagan baho bu chegaradan PAST chiqadi va M4 dagi "konstantani
    // ma'lumot bilan tekshirish" qadami `m = 20` ni "juda katta" deb ko'rsatib,
    // uni pasaytirishga undardi — reyting §6.2 ogohlantirgan tarzda ag'darilardi.
    //
    // Bitta seed'ga tayanmaslik uchun panel: alohida olti xil ma'lumot to'plami.
    const seeds = [12_345, 13_345, 14_345, 15_345, 16_345, 17_345]

    for (const seed of seeds) {
      const rows = binomialRows(2000, seed)
      const out = estimateBeta(rows)

      expect(out).not.toBeNull()
      const { m } = out as { m: number }

      // Tuzatilgan baho — chegaradan yuqori.
      expect(m).toBeGreaterThan(8)
      // Tuzatilmagan baho — aynan shu ma'lumotda chegaradan PAST.
      expect(naiveM(rows)).toBeLessThan(8)
    }
  })

  it("exposures kattalashgani sari tuzatish hadi ahamiyatsizlashadi", () => {
    // Ikki baho bir-biriga yaqinlashishi kerak: `exposures = 2000` da binomial
    // had `mean(1/n) = 5e-4` bilan ko'payadi, ya'ni amalda nol.
    const rows = betaRows(400, 12_345)
    const corrected = (estimateBeta(rows) as { m: number }).m

    expect(corrected).toBeCloseTo(naiveM(rows), 0)
    expect(Math.abs(corrected - naiveM(rows))).toBeLessThan(1)
  })
})

// ---------------------------------------------------------------------------
// Konstantalar — qiymati o'zgarsa hujjat ham yangilanishi kerak
// ---------------------------------------------------------------------------

describe('konstantalar', () => {
  it('hujjatdagi qiymatlarga mos', () => {
    expect(HALF_LIFE_DAYS).toBe(90)
    expect(SHRINKAGE_M).toBe(20)
    expect(DEFAULT_G).toBe(0.08)
  })

  it("DEFAULT_G tanlangan SHRINKAGE_M uchun xavfsiz zonada", () => {
    // §6.2: `g` `orderFlipG(m)` dan past turgancha `1/1` va `10/50` tartibi saqlanadi.
    expect(DEFAULT_G).toBeLessThan(orderFlipG(SHRINKAGE_M))
  })
})

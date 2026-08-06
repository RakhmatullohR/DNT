import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RATE,
  DEFAULT_VOICE,
  RATES,
  VOICES,
  audioFilename,
  isCapsWord,
  isValidWord,
  sanitizeRate,
  sanitizeVoice,
  synthTextFor,
} from '../../shared/filename.ts'
import { OVERRIDES } from '../../shared/overrides.ts'

// Standartdan farq qiladigan ovoz — yorliq mantiqini tekshirish uchun.
const OTHER_VOICE = 'en-GB-SoniaNeural'

describe('konstantalar', () => {
  it('DEFAULT_VOICE ruxsat etilgan ovozlar ro\'yxati ichida', () => {
    expect(VOICES).toContain(DEFAULT_VOICE)
  })

  it('barcha ovozlar en-US yoki en-GB neural', () => {
    for (const voice of VOICES) {
      expect(voice).toMatch(/^en-(US|GB)-[A-Za-z]+Neural$/)
    }
  })

  it('ovozlar takrorlanmaydi', () => {
    expect(new Set(VOICES).size).toBe(VOICES.length)
  })

  it('RATES aynan [0, -10, -25]', () => {
    expect([...RATES]).toEqual([0, -10, -25])
    expect(DEFAULT_RATE).toBe(0)
    expect(RATES).toContain(DEFAULT_RATE)
  })
})

describe('isCapsWord', () => {
  it('uzunligi >= 2 bo\'lgan butunlay katta harfli so\'z uchun true', () => {
    expect(isCapsWord('US')).toBe(true)
    expect(isCapsWord('NASA')).toBe(true)
    expect(isCapsWord('CIA')).toBe(true)
  })

  it('bitta harf qisqartma emas', () => {
    expect(isCapsWord('I')).toBe(false)
    expect(isCapsWord('A')).toBe(false)
  })

  it('aralash yoki kichik harflar uchun false', () => {
    expect(isCapsWord('The')).toBe(false)
    expect(isCapsWord('us')).toBe(false)
    expect(isCapsWord('iPhone')).toBe(false)
    expect(isCapsWord('')).toBe(false)
  })

  it('apostrof yoki tire bo\'lsa qisqartma hisoblanmaydi', () => {
    expect(isCapsWord("DON'T")).toBe(false)
    expect(isCapsWord('E-MAIL')).toBe(false)
  })
})

describe('isValidWord', () => {
  it('oddiy so\'z, apostrofli va tireli so\'z uchun true', () => {
    expect(isValidWord('the')).toBe(true)
    expect(isValidWord('The')).toBe(true)
    expect(isValidWord('US')).toBe(true)
    expect(isValidWord("don't")).toBe(true)
    expect(isValidWord('don-t')).toBe(true)
    expect(isValidWord("o'clock")).toBe(true)
    expect(isValidWord('mother-in-law')).toBe(true)
    expect(isValidWord('a')).toBe(true)
  })

  it('bo\'sh satr, raqam va probel uchun false', () => {
    expect(isValidWord('')).toBe(false)
    expect(isValidWord('3D')).toBe(false)
    expect(isValidWord('2024')).toBe(false)
    expect(isValidWord('two words')).toBe(false)
  })

  it('apostrof/tire chetda yoki ketma-ket kelsa false', () => {
    expect(isValidWord("'the")).toBe(false)
    expect(isValidWord("the'")).toBe(false)
    expect(isValidWord('-the')).toBe(false)
    expect(isValidWord('the-')).toBe(false)
    expect(isValidWord("don''t")).toBe(false)
    expect(isValidWord('don--t')).toBe(false)
  })

  it('yo\'l ajratuvchi va nuqta bo\'lgan har qanday satr uchun false', () => {
    expect(isValidWord('..')).toBe(false)
    expect(isValidWord('.')).toBe(false)
    expect(isValidWord('a/b')).toBe(false)
    expect(isValidWord('a\\b')).toBe(false)
    expect(isValidWord('../../etc/passwd')).toBe(false)
    expect(isValidWord('the.mp3')).toBe(false)
  })
})

describe('audioFilename — asosiy qoidalar (PLAN §9)', () => {
  it("`The` -> `the.mp3` (bosh harf fayl nomiga ta'sir qilmaydi)", () => {
    expect(audioFilename('The')).toBe('the.mp3')
    expect(audioFilename('the')).toBe('the.mp3')
    expect(audioFilename('The')).toBe(audioFilename('the'))
  })

  it('`US` -> `us@caps.mp3`', () => {
    expect(audioFilename('US')).toBe('us@caps.mp3')
    expect(audioFilename('NASA')).toBe('nasa@caps.mp3')
  })

  it("`don't` va `don-t` — TURLI fayllar", () => {
    expect(audioFilename("don't")).toBe("don't.mp3")
    expect(audioFilename('don-t')).toBe('don-t.mp3')
    expect(audioFilename("don't")).not.toBe(audioFilename('don-t'))
  })

  it('bir harfli so\'z ham oddiy qoida bo\'yicha', () => {
    expect(audioFilename('a')).toBe('a.mp3')
    expect(audioFilename('I')).toBe('i.mp3')
  })

  it('standart ovoz/tezlik aniq berilsa ham yorliq qo\'shilmaydi', () => {
    expect(audioFilename('the', DEFAULT_VOICE, DEFAULT_RATE)).toBe('the.mp3')
  })
})

describe('audioFilename — ovoz va tezlik yorlig\'i', () => {
  it('`-25%` tezlik `@` yorlig\'ini beradi (PLAN §9)', () => {
    expect(audioFilename('The', DEFAULT_VOICE, -25)).toBe('the@en-US-AvaNeural@-25.mp3')
    expect(audioFilename('the', DEFAULT_VOICE, -25)).toContain('@')
  })

  it('-10 tezlik uchun ham yorliq', () => {
    expect(audioFilename('the', DEFAULT_VOICE, -10)).toBe('the@en-US-AvaNeural@-10.mp3')
  })

  it('boshqa ovoz standart tezlikda ham yorliq beradi', () => {
    expect(audioFilename('the', OTHER_VOICE)).toBe('the@en-GB-SoniaNeural@0.mp3')
    expect(audioFilename('the', OTHER_VOICE, DEFAULT_RATE)).toBe('the@en-GB-SoniaNeural@0.mp3')
  })

  it('ovoz va tezlik birgalikda o\'zgarsa', () => {
    expect(audioFilename('the', OTHER_VOICE, -25)).toBe('the@en-GB-SoniaNeural@-25.mp3')
  })

  it('caps va ovoz/tezlik BIRGA — `@caps` avval keladi', () => {
    expect(audioFilename('US', DEFAULT_VOICE, -25)).toBe('us@caps@en-US-AvaNeural@-25.mp3')
    expect(audioFilename('US', OTHER_VOICE, -10)).toBe('us@caps@en-GB-SoniaNeural@-10.mp3')
    expect(audioFilename('NASA', OTHER_VOICE)).toBe('nasa@caps@en-GB-SoniaNeural@0.mp3')
  })

  it('har bir ovoz/tezlik kombinatsiyasi UNIKAL nom beradi', () => {
    const names = new Set<string>()
    for (const voice of VOICES) {
      for (const rate of RATES) {
        names.add(audioFilename('read', voice, rate))
        names.add(audioFilename('US', voice, rate))
      }
    }
    // 2 ta so'z * (ovoz, tezlik) juftliklari; standart juftlik yorliqsiz nom beradi.
    expect(names.size).toBe(2 * VOICES.length * RATES.length)
  })
})

describe('audioFilename — yo\'l ajratuvchidan himoya', () => {
  const yomonSozlar = [
    '',
    '..',
    '.',
    '../../etc/passwd',
    'a/b',
    'a\\b',
    'the.mp3',
    'two words',
    '2024',
    '../the',
    'the/../../x',
    // Boshqaruv belgisi ataylab escape bilan yozilgan: xom NUL bayti faylni ikkilik
    // deb ko'rsatib, uni matn bo'yicha qidiruvdan (grep, git grep) chiqarib yuborardi.
    '\u0000the',
  ]

  it('noto\'g\'ri so\'z uchun XATO tashlaydi', () => {
    for (const word of yomonSozlar) {
      expect(() => audioFilename(word), `so'z: ${JSON.stringify(word)}`).toThrow()
    }
  })

  it('noma\'lum ovoz uchun XATO tashlaydi', () => {
    expect(() => audioFilename('the', '../../../.config/x')).toThrow()
    expect(() => audioFilename('the', 'en-US-AvaNeural/../x')).toThrow()
    expect(() => audioFilename('the', 'ru-RU-SvetlanaNeural')).toThrow()
    expect(() => audioFilename('the', '')).toThrow()
  })

  it('ruxsat etilmagan tezlik uchun XATO tashlaydi', () => {
    expect(() => audioFilename('the', DEFAULT_VOICE, -500)).toThrow()
    expect(() => audioFilename('the', DEFAULT_VOICE, 50)).toThrow()
    expect(() => audioFilename('the', DEFAULT_VOICE, -11)).toThrow()
    expect(() => audioFilename('the', DEFAULT_VOICE, Number.NaN)).toThrow()
  })

  it('qaytarilgan nomda `/`, `\\`, `..` HECH QACHON bo\'lmaydi', () => {
    const yaxshiSozlar = ['the', 'The', 'US', 'NASA', "don't", 'don-t', 'a', 'I', 'mother-in-law']
    for (const word of yaxshiSozlar) {
      for (const voice of VOICES) {
        for (const rate of RATES) {
          const name = audioFilename(word, voice, rate)
          expect(name).not.toContain('/')
          expect(name).not.toContain('\\')
          expect(name).not.toContain('..')
          expect(name.endsWith('.mp3')).toBe(true)
          // `path.basename` bilan bir xil qolishi kerak — pastki papka yaratilmaydi.
          expect(name.split('/').length).toBe(1)
        }
      }
    }
  })
})

describe('sanitizeVoice', () => {
  it('bo\'sh satr standart ovozga tushadi (eski dars yozuvi aynan shunday o\'qiladi)', () => {
    expect(sanitizeVoice('')).toBe(DEFAULT_VOICE)
  })

  it('ro\'yxatda yo\'q ovoz standart ovozga tushadi', () => {
    expect(sanitizeVoice('ru-RU-SvetlanaNeural')).toBe(DEFAULT_VOICE)
    expect(sanitizeVoice('en-US-AvaNeural/../x')).toBe(DEFAULT_VOICE)
    expect(sanitizeVoice('../../../.config/x')).toBe(DEFAULT_VOICE)
    expect(sanitizeVoice('EN-US-AVANEURAL')).toBe(DEFAULT_VOICE)
  })

  it('ruxsat etilgan har bir ovoz O\'ZGARMASDAN qaytadi', () => {
    for (const voice of VOICES) {
      expect(sanitizeVoice(voice), `ovoz: ${voice}`).toBe(voice)
    }
  })

  it('satr bo\'lmagan qiymat ham standart ovozga tushadi', () => {
    expect(sanitizeVoice(undefined)).toBe(DEFAULT_VOICE)
    expect(sanitizeVoice(null)).toBe(DEFAULT_VOICE)
    expect(sanitizeVoice(0)).toBe(DEFAULT_VOICE)
    expect(sanitizeVoice({ voice: DEFAULT_VOICE })).toBe(DEFAULT_VOICE)
  })
})

describe('sanitizeRate', () => {
  it('ruxsat etilmagan tezlik standart tezlikka tushadi', () => {
    expect(sanitizeRate(-500)).toBe(DEFAULT_RATE)
    expect(sanitizeRate(50)).toBe(DEFAULT_RATE)
    expect(sanitizeRate(-11)).toBe(DEFAULT_RATE)
    expect(sanitizeRate(Number.POSITIVE_INFINITY)).toBe(DEFAULT_RATE)
  })

  it('ruxsat etilgan har bir tezlik O\'ZGARMASDAN qaytadi', () => {
    for (const rate of RATES) {
      expect(sanitizeRate(rate), `tezlik: ${String(rate)}`).toBe(rate)
    }
  })

  it('NaN standart tezlikka tushadi', () => {
    expect(sanitizeRate(Number.NaN)).toBe(DEFAULT_RATE)
    expect(Number.isNaN(sanitizeRate(Number.NaN))).toBe(false)
  })

  it('son bo\'lmagan qiymat ham standart tezlikka tushadi', () => {
    expect(sanitizeRate(undefined)).toBe(DEFAULT_RATE)
    expect(sanitizeRate(null)).toBe(DEFAULT_RATE)
    expect(sanitizeRate('-25')).toBe(DEFAULT_RATE)
    expect(sanitizeRate([-25])).toBe(DEFAULT_RATE)
  })
})

describe('tozalangan ovoz/tezlik server va fayl nomi uchun DOIM yaroqli', () => {
  // Tozalashning butun maqsadi shu: xom qiymat `audioFilename` da XATO tashlaydi
  // va serverda 400 beradi, tozalangani esa hech qachon.
  const yomonQiymatlar: unknown[] = ['', 'ru-RU-SvetlanaNeural', undefined, null, 42]
  const yomonTezliklar: unknown[] = [-500, 50, Number.NaN, undefined, '-25']

  it('har qanday xom juftlikdan `audioFilename` uchun yaroqli juftlik chiqadi', () => {
    for (const rawVoice of yomonQiymatlar) {
      for (const rawRate of yomonTezliklar) {
        const voice = sanitizeVoice(rawVoice)
        const rate = sanitizeRate(rawRate)
        expect(VOICES).toContain(voice)
        expect(RATES).toContain(rate)
        expect(() => audioFilename('the', voice, rate)).not.toThrow()
      }
    }
  })

  it('bir xil xom qiymat DOIM bir xil natija beradi — bitta dars ikki ovozda qolmaydi', () => {
    expect(sanitizeVoice('')).toBe(sanitizeVoice(''))
    expect(audioFilename('the', sanitizeVoice(''), sanitizeRate(0))).toBe(
      audioFilename('the', sanitizeVoice(undefined), sanitizeRate(Number.NaN)),
    )
  })
})

describe('synthTextFor', () => {
  it('qisqartma uchun ASL katta harfli shakl (`US` /ʌs/ deb o\'qilmasin)', () => {
    expect(synthTextFor('US')).toBe('US')
    expect(synthTextFor('NASA')).toBe('NASA')
  })

  it('overrides jadvali qo\'llanadi (kalit — kichik harfli so\'z)', () => {
    expect(synthTextFor('read')).toBe('reed')
    expect(synthTextFor('Read')).toBe('reed')
    expect(synthTextFor('lead')).toBe('leed')
    expect(synthTextFor('close')).toBe('klohss')
  })

  it('jadvalda yo\'q so\'z o\'zgarmaydi', () => {
    expect(synthTextFor('the')).toBe('the')
    expect(synthTextFor('The')).toBe('The')
    expect(synthTextFor("don't")).toBe("don't")
  })

  it('qisqartma tekshiruvi overrides\'dan OLDIN ishlaydi', () => {
    // `READ` — qisqartma, shuning uchun `reed` emas, asl shakli qaytariladi.
    expect(synthTextFor('READ')).toBe('READ')
  })

  it('sintez matni fayl nomiga ta\'sir qilmaydi', () => {
    expect(audioFilename('read')).toBe('read.mp3')
    expect(synthTextFor('read')).toBe('reed')
  })
})

describe('OVERRIDES jadvali — TO\'LIQ qoplama (PLAN §3, §10)', () => {
  // PLAN §3 "to'qqiz kalit" deb da'vo qiladi — ro'yxat shu yerda ANIQ yozilgan,
  // shunda kalit tushib qolsa yoki nomi o'zgarsa test qizaradi.
  const KUTILGAN_KALITLAR = ['read', 'lead', 'live', 'wind', 'tear', 'row', 'bow', 'sow', 'close']

  it('kutilgan to\'qqiz kalitning hammasi jadvalda bor', () => {
    for (const kalit of KUTILGAN_KALITLAR) {
      expect(Object.keys(OVERRIDES), `kalit: ${kalit}`).toContain(kalit)
    }
    expect(Object.keys(OVERRIDES)).toHaveLength(KUTILGAN_KALITLAR.length)
  })

  it('HAR BIR kalit uchun `synthTextFor` jadvaldagi qiymatni qaytaradi', () => {
    // Jadval bo'ylab aylanamiz — yangi kalit qo'shilsa ham avtomatik qoplanadi.
    for (const [kalit, qiymat] of Object.entries(OVERRIDES)) {
      expect(synthTextFor(kalit), `kalit: ${kalit}`).toBe(qiymat)
    }
  })

  it('jadval kalitlari DOIM kichik harfli', () => {
    // Qisqartma tekshiruvi overrides'dan OLDIN turadi, ya'ni katta harfli kalitga
    // hech qachon yetib borilmasdi (PLAN §3).
    for (const kalit of Object.keys(OVERRIDES)) {
      expect(kalit, `kalit: ${kalit}`).toBe(kalit.toLowerCase())
    }
  })

  it('bosh harfli shakl ham jadvalga tushadi', () => {
    for (const [kalit, qiymat] of Object.entries(OVERRIDES)) {
      const boshHarfli = kalit[0]!.toUpperCase() + kalit.slice(1)
      expect(synthTextFor(boshHarfli), `so'z: ${boshHarfli}`).toBe(qiymat)
    }
  })
})

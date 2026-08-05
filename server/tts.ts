// Edge TTS ustidagi yupqa o'ram: bitta so'zni sintez qilib MP3 buferini qaytaradi.
//
// PLAN.md §5a — `@andresaya/edge-tts@1.8.0` manbasi (`dist/services/EdgeTTS.js`)
// o'qib tasdiqlandi. Shu faylda kutubxonaning UCHTA kritik xatosi yopiladi:
//
//   1) INSTANCE HOLATI (`:173` `this.audio_stream = []`, `:176` `this.ws = new WebSocket(...)`,
//      `:388` `this.ws?.close()`) — bitta obyekt parallel chaqiruvlarda audiolarni
//      aralashtiradi va BOSHQA so'zning socketini yopadi.
//      -> Har chaqiruvga `new EdgeTTS()`. Instance HECH QACHON qayta ishlatilmaydi.
//
//   2) BO'SH AUDIODA HAM MUVAFFAQIYAT (`:214-219` — `ws.on('close')` da `audio_stream`
//      tekshirilmasdan `resolve()`). Sintez "muvaffaqiyatli" tugaydi, xato esa faqat
//      `toBuffer()` da chiqadi (`:486` "No audio data available").
//      -> `synthesize()` VA `toBuffer()` BITTA `try` ichida. Retry `synthesize()`
//         atrofidagina bo'lsa hech qachon ishlamaydi.
//         `buf.length < MIN_AUDIO_BYTES` ham retry sababi: bir necha baytli "audio"
//         ham kutubxona uchun muvaffaqiyat hisoblanadi.
//
//   3) ULANISH TAYMERI YO'Q (`:187-196` — 30 soniyalik faolsizlik taymeri FAQAT
//      `ws.on('open')` ichida yoqiladi, `handshakeTimeout` esa berilmagan `:176-179`).
//      Socket ochilmay osilsa — abadiy kutiladi va parallellik slotlari band bo'lib qoladi.
//      -> `Promise.race([synthesize(...), rejectAfter(SYNTH_TIMEOUT_MS)])`.
//
// Qo'shimcha manba faktlari:
//   - `validateRate` (`:140-154`) da DIAPAZON tekshiruvi yo'q — noto'g'ri qiymat buzuq
//     SSML, u esa bo'sh audio beradi. Diapazonni o'zimiz tekshiramiz.
//   - `synthesize(text, voice = 'en-US-AnaNeural', options)` (`:170`) — kutubxona defaulti
//     `AnaNeural`, bizniki `AvaNeural`. Shuning uchun ovoz DOIM aniq beriladi.
//   - `toFile()` (`:470-478`) yo'lga kengaytmani YANA qo'shadi (`quick.mp3` -> `quick.mp3.mp3`),
//     shuning uchun u ISHLATILMAYDI: `toBuffer()` natijasi `store.ts` dagi atomik yozuvga beriladi.
//   - `toRaw()` (`:479-481`) Buffer emas, base64 SATR qaytaradi — bizga `toBuffer()` kerak.

import { EdgeTTS } from '@andresaya/edge-tts'

export type SynthOptions = {
  /** To'liq ovoz nomi, masalan `en-US-AvaNeural`. Bo'sh bo'lishi mumkin emas. */
  voice: string
  /** Tezlik foizda, butun son: `0`, `-10`, `-25`. */
  rate: number
}

/** Bitta urinish uchun eng ko'p kutish vaqti. Kutubxonada ulanish taymeri yo'q. */
export const SYNTH_TIMEOUT_MS = 20_000

/** Birinchi urinishdan keyingi QAYTA urinishlar soni. Jami urinish = `MAX_RETRIES + 1`. */
export const MAX_RETRIES = 2

/** Retry oldidan kutish (ms). Uzunligi `MAX_RETRIES` ga teng. */
const BACKOFF_MS = [300, 800] as const

/** Bundan kichik bufer buzuq audio hisoblanadi va retry sababi bo'ladi. */
const MIN_AUDIO_BYTES = 1024

/** Ruxsat etilgan tezlik diapazoni (kutubxona buni tekshirmaydi). */
const RATE_MIN = -100
const RATE_MAX = 100

/**
 * Kutubxona `ws` ni private saqlaydi, uzish uchun ochiq API bermaydi.
 * Timeout yoki xatodan keyin osilib qolgan socketni "eng yaxshi harakat" tariqasida
 * yopamiz — aks holda ochilmagan ulanish jarayonda abadiy qolib ketadi.
 */
function abortSocket(tts: EdgeTTS): void {
  const holder = tts as unknown as { ws?: { close?: () => void } }
  try {
    holder.ws?.close?.()
  } catch {
    // Yopish urinishi muvaffaqiyatsiz bo'lsa ham asosiy xatoni yashirmaymiz.
  }
}

/** `0` -> `'+0%'`, `-25` -> `'-25%'`. SSML `prosody rate` shu shaklni kutadi. */
function ratePercent(rate: number): string {
  if (!Number.isInteger(rate)) {
    throw new Error(`tts: rate butun son bo'lishi kerak, kelgani: ${String(rate)}`)
  }
  if (rate < RATE_MIN || rate > RATE_MAX) {
    throw new Error(`tts: rate ${RATE_MIN}..${RATE_MAX} oralig'ida bo'lishi kerak, kelgani: ${rate}`)
  }
  return rate >= 0 ? `+${rate}%` : `${rate}%`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * `work` berilgan vaqt ichida tugamasa — rad etadi.
 * `work` yutganda taymer albatta tozalanadi, aks holda jarayon 20 soniya ushlab turiladi.
 */
async function withTimeout<T>(work: Promise<T>, ms: number, word: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`tts: "${word}" uchun ${ms} ms kutish vaqti tugadi`))
    }, ms)
  })
  try {
    return await Promise.race([work, guard])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Bitta so'zni sintez qiladi va MP3 buferini qaytaradi.
 *
 * `text` — SINTEZ matni (`overrides.json` almashtirgan shakl bo'lishi mumkin),
 * fayl nomi undan emas, asl imlodan olinadi — buni chaqiruvchi hal qiladi.
 *
 * Muvaffaqiyatsizlikda `MAX_RETRIES + 1` urinishdan keyin xato tashlanadi.
 */
export async function synthesizeWord(text: string, opts: SynthOptions): Promise<Buffer> {
  const word = text.trim()
  if (word.length === 0) {
    throw new Error('tts: sintez matni bo\'sh')
  }

  const voice = opts.voice.trim()
  if (voice.length === 0) {
    // Kutubxona defaulti `AnaNeural` — jimgina noto'g'ri ovozga tushib qolmaymiz.
    throw new Error('tts: voice majburiy, kutubxona defaultiga tayanilmaydi')
  }

  const rate = ratePercent(opts.rate)

  let lastError: unknown

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    // 1-XATO: har urinishga toza instance. Hech qachon qayta ishlatilmaydi.
    const tts = new EdgeTTS()
    try {
      // 3-XATO: ulanish taymeri yo'q -> o'zimiz qo'yamiz.
      await withTimeout(tts.synthesize(word, voice, { rate }), SYNTH_TIMEOUT_MS, word)

      // 2-XATO: bo'sh audioda ham `resolve()` bo'ladi, xato AYNAN shu yerda chiqadi —
      // shuning uchun `toBuffer()` o'sha `try` ichida turishi SHART.
      const buf = tts.toBuffer()
      if (buf.length < MIN_AUDIO_BYTES) {
        throw new Error(
          `tts: "${word}" uchun audio juda kichik (${buf.length} bayt, kamida ${MIN_AUDIO_BYTES})`,
        )
      }
      return buf
    } catch (err) {
      lastError = err
      abortSocket(tts)
      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_MS[attempt] ?? 0)
      }
    }
  }

  throw new Error(
    `tts: "${word}" sintez qilinmadi (${MAX_RETRIES + 1} urinish): ${errorText(lastError)}`,
    { cause: lastError },
  )
}

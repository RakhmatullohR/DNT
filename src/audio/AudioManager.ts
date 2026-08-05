// So'z audiosining butun quvuri: prefetch -> dekod -> jimlikni kesish -> guard'li navbat -> fade.
//
// PLAN §5b dagi har bir band shu yerda amalga oshirilgan. Eng muhim shart:
// `onStarted` FAQAT ovoz haqiqatan chiqa boshlaganda chaqiriladi, boshqa har qanday
// natijada `onFailed` chaqiriladi. Jimlik hech qachon "eshitilgan" deb hisoblanmaydi —
// aks holda `typing.ts` o'sha so'zni "bir marta o'qilgan" deb abadiy o'chirib qo'yardi.

import {
  DEFAULT_RATE,
  DEFAULT_VOICE,
  RATES,
  VOICES,
  audioFilename,
  isValidWord,
} from '../../shared/filename.ts'
import { audioUrl, requestBatch, serverAvailable } from './ttsClient.ts'
import { cancelSpeech, speakWord, speechAvailable, warmUp } from './webSpeech.ts'

/** Qisqa so'z shu vaqt ichida uzilmaydi (PLAN §5b). */
export const GUARD_MS = 250

/** Guard tufayli to'planishi mumkin bo'lgan maksimal kechikish. */
export const MAX_LAG_MS = 300

/** Fade uchun `setTargetAtTime` doimiysi — yalang'och `stop()` "chirs" etadi. */
const FADE_TAU_S = 0.005

/** Fade boshlangach necha soniyadan keyin node butunlay to'xtaydi. */
const FADE_STOP_S = 0.02

/** Boshidagi jimlikni kesishda "ovoz bor" deb hisoblanadigan chegara. */
const SILENCE_THRESHOLD = 0.01

/** Kesilgan joydan bir oz orqaga chekinish — so'zning birinchi tovushi yo'qolmasin. */
const TRIM_SAFETY_S = 0.02

/** Bundan kichik javob MP3 emas (yarim yozilgan yoki xato sahifasi). */
const MIN_MP3_BYTES = 1024

/** Prefetch da bir vaqtda nechta fayl yuklab olinadi va dekodlanadi. */
const DECODE_POOL = 6

export type AudioCallbacks = {
  onStarted: (tokenIndex: number) => void
  onFailed: (tokenIndex: number) => void
}

/** Dekodlangan bufer va uning "ovoz boshlanadigan" nuqtasi (soniyada). */
type CachedAudio = { buffer: AudioBuffer; offset: number }

type PlayMode = 'buffer' | 'speech'

// ---------------------------------------------------------------------------
// AudioContext — MODUL DARAJASIDAGI singleton.
// React effekti ichida yaratilsa StrictMode uni ikki marta ochardi va ikkita
// mustaqil kontekst bir-birining ovozini bosardi.
// ---------------------------------------------------------------------------

type AudioContextCtor = new () => AudioContext

let sharedContext: AudioContext | null = null

function getContext(): AudioContext | null {
  if (sharedContext) return sharedContext
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor
    webkitAudioContext?: AudioContextCtor
  }
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext
  if (!Ctor) return null
  try {
    sharedContext = new Ctor()
  } catch {
    return null
  }
  return sharedContext
}

/**
 * Audio ni foydalanuvchi harakatida ochadi.
 *
 * Faqat `pointerdown` ga bog'lansa, mashqni Enter bilan boshlagan foydalanuvchining
 * birinchi so'zi yo'qolardi — shuning uchun `keydown` ham hisobga olinadi (pastdagi
 * modul darajasidagi tinglovchilarga qarang).
 */
export async function unlockAudio(): Promise<void> {
  const ctx = getContext()
  if (ctx && ctx.state !== 'running') {
    try {
      await ctx.resume()
    } catch {
      // Foydalanuvchi harakati hisoblanmagan bo'lsa keyingi bosishda yana urinamiz.
    }
  }
  // Brauzer sintezi ham aynan foydalanuvchi harakatida isitilishi kerak.
  await warmUp()
}

if (typeof window !== 'undefined') {
  const onUserGesture = (): void => {
    void unlockAudio()
  }
  // Tinglovchilar o'chirilmaydi: tab fonga o'tganda kontekst yana `suspended`
  // bo'lishi mumkin, keyingi bosish uni qayta tiklaydi. Tekshiruv juda arzon.
  window.addEventListener('pointerdown', onUserGesture, { passive: true })
  window.addEventListener('keydown', onUserGesture, { passive: true })
}

/**
 * Dekoddan keyin ovoz boshlanadigan nuqtani topadi.
 * MP3 kodlovchi kechikishi + Microsoft padding ~100-200 ms jimlik qoldiradi;
 * usiz `a` kabi qisqa so'z faqat jimlik bo'lib eshitilardi.
 *
 * Butunlay jim bufer uchun `null` qaytaradi — bunday fayl ijro qilinmaydi,
 * chunki jimlik "eshitildi" deb belgilanmasligi kerak.
 */
function findSoundStart(buffer: AudioBuffer): number | null {
  if (buffer.numberOfChannels === 0 || buffer.length === 0) return null
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    const sample = data[i] ?? 0
    if (Math.abs(sample) > SILENCE_THRESHOLD) {
      const seconds = i / buffer.sampleRate
      const start = Math.max(0, seconds - TRIM_SAFETY_S)
      return Math.min(start, Math.max(0, buffer.duration - 0.01))
    }
  }
  return null
}

/** Cheklangan parallellik bilan ishlov berish (prefetch tarmoqni ko'mib tashlamasin). */
async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0
  const runner = async (): Promise<void> => {
    while (index < items.length) {
      const item = items[index]
      index += 1
      if (item === undefined) continue
      await worker(item)
    }
  }
  const runners: Array<Promise<void>> = []
  for (let i = 0; i < Math.min(limit, items.length); i++) runners.push(runner())
  await Promise.all(runners)
}

export class AudioManager {
  private voice: string = DEFAULT_VOICE
  private rate: number = DEFAULT_RATE
  private enabled = true
  private _serverOk = false

  private callbacks: AudioCallbacks = {
    onStarted: () => {},
    onFailed: () => {},
  }

  /** Fayl nomi -> DEKODLANGAN bufer. `ArrayBuffer` saqlanmaydi: `decodeAudioData` uni detach qiladi. */
  private cache = new Map<string, CachedAudio>()
  /** Ayni paytda yuklanayotgan fayllar — bir so'z ikki marta yuklab olinmasin. */
  private inflight = new Map<string, Promise<CachedAudio>>()
  /** Buzuq yoki butunlay jim fayllar — ular uchun darhol zaxiraga o'tiladi. */
  private deadFiles = new Set<string>()

  /** Joriy ijro. "Bitta kanal" = shu o'zgaruvchilar, qayta ishlatiladigan node EMAS. */
  private currentSource: AudioBufferSourceNode | null = null
  private currentGain: GainNode | null = null
  private currentMode: PlayMode | null = null
  /** Ovoz haqiqatan chiqa boshlagan payt; hali chiqmagan bo'lsa `null`. */
  private currentStartedAt: number | null = null

  /** Kutish slotida AYNAN BITTA so'z turadi. */
  private pendingItem: { word: string; tokenIndex: number } | null = null
  private pendingTimer: ReturnType<typeof setTimeout> | null = null

  /** Guard tufayli to'plangan kechikish. */
  private lagMs = 0

  /** Har bir ijro urinishining nomeri — eskirgan async davomlar shu bilan bekor qilinadi. */
  private generation = 0

  setVoice(voice: string, rate: number): void {
    // `audioFilename` noma'lum ovoz/tezlikda XATO TASHLAYDI, shuning uchun
    // yaroqsiz qiymat bu yerda to'xtatiladi — joriy sozlama saqlanib qoladi.
    if (!VOICES.includes(voice) || !RATES.includes(rate)) return
    if (voice === this.voice && rate === this.rate) return
    this.voice = voice
    this.rate = rate
    // Fayl nomi ovoz va tezlikka bog'liq — eski buferlar endi noto'g'ri so'zni beradi.
    this.cache.clear()
    this.inflight.clear()
    this.deadFiles.clear()
    this.stopAll()
  }

  setCallbacks(cb: AudioCallbacks): void {
    this.callbacks = cb
  }

  /**
   * So'zlarni serverda sintez qildiradi va dekodlangan holda keshga soladi.
   * Xatolar yutiladi: prefetch muvaffaqiyatsiz bo'lsa ijro paytida zaxira zanjiri ishlaydi.
   */
  async prefetch(words: string[]): Promise<void> {
    if (!this.enabled) return

    const wanted: string[] = []
    const seen = new Set<string>()
    for (const word of words) {
      if (!isValidWord(word)) continue
      const file = this.fileFor(word)
      if (file === null || seen.has(file) || this.cache.has(file)) continue
      seen.add(file)
      wanted.push(word)
    }
    if (wanted.length === 0) return

    this._serverOk = await serverAvailable()
    if (!this._serverOk) return

    const result = await requestBatch(wanted, this.voice, this.rate)
    await runPool(result.ok, DECODE_POOL, async (item) => {
      try {
        await this.loadBuffer(item.word)
      } catch {
        // Bitta fayl yuklanmasa qolganlari to'xtamaydi.
      }
    })
  }

  /**
   * So'zni o'qiydi. Chaqiruv sinxron — natija esa callback orqali keladi.
   *
   * Guard qoidasi (PLAN §5b): joriy ijro `GUARD_MS` dan kam davom etgan bo'lsa va
   * to'plangan kechikish `MAX_LAG_MS` dan oshmasa — yangi so'z kutish slotiga
   * qo'yiladi; aks holda joriy ijro fade bilan so'ndirilib, yangisi darhol boshlanadi.
   */
  playWord(word: string, tokenIndex: number): void {
    if (!this.enabled || word.length === 0) {
      // Ovozsiz rejim ham "eshitildi" degani emas.
      this.callbacks.onFailed(tokenIndex)
      return
    }

    const startedAt = this.currentStartedAt
    if (startedAt !== null && this.currentMode !== null) {
      const elapsed = performance.now() - startedAt
      if (elapsed < GUARD_MS) {
        const delay = GUARD_MS - elapsed
        if (this.lagMs + delay <= MAX_LAG_MS) {
          this.schedule(word, tokenIndex, delay)
          return
        }
      }
    }

    // Kechikish to'planmadi (yoki chegaradan oshdi) — hisob noldan boshlanadi.
    this.lagMs = 0
    this.startNow(word, tokenIndex)
  }

  stopAll(): void {
    // Nomerni oshirish barcha davom etayotgan async ijrolarni bekor qiladi.
    this.generation += 1
    this.clearPending(true)
    this.stopCurrent()
    this.lagMs = 0
  }

  /** Ovozsiz rejim — PLAN §8 dagi "audio yoqiq / o'chiq" tekshiruvi uchun. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    if (!enabled) this.stopAll()
  }

  isEnabled(): boolean {
    return this.enabled
  }

  get serverOk(): boolean {
    return this._serverOk
  }

  /** TTS serveri holatini yangilaydi (UI dagi "TTS server ulanmadi" ogohlantirishi uchun). */
  async checkServer(): Promise<boolean> {
    this._serverOk = await serverAvailable()
    return this._serverOk
  }

  // -------------------------------------------------------------------------
  // Ichki qism
  // -------------------------------------------------------------------------

  /**
   * So'zning fayl nomi. `audioFilename` yaroqsiz so'zda xato tashlaydi —
   * bu yerda u `null` ga aylantiriladi va chaqiruvchi zaxira zanjiriga o'tadi.
   */
  private fileFor(word: string): string | null {
    try {
      return audioFilename(word, this.voice, this.rate)
    } catch {
      return null
    }
  }

  private schedule(word: string, tokenIndex: number, delay: number): void {
    // Slotda faqat bitta so'z turadi: eskisi tashlanadi. U eshitilmagani uchun
    // `onFailed` bilan xabar qilinadi — `playedWords` ga tushib qolmaydi.
    this.clearPending(true)
    this.lagMs += delay
    this.pendingItem = { word, tokenIndex }
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null
      const item = this.pendingItem
      this.pendingItem = null
      if (item) this.startNow(item.word, item.tokenIndex)
    }, delay)
  }

  private clearPending(report: boolean): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
    const item = this.pendingItem
    this.pendingItem = null
    if (item && report) this.callbacks.onFailed(item.tokenIndex)
  }

  private startNow(word: string, tokenIndex: number): void {
    this.clearPending(true)
    this.generation += 1
    const gen = this.generation
    this.stopCurrent()
    void this.playInternal(word, tokenIndex, gen)
  }

  /** Zaxira zanjiri: kesh/server MP3 -> `speechSynthesis` -> `onFailed`. */
  private async playInternal(word: string, tokenIndex: number, gen: number): Promise<void> {
    const ctx = getContext()
    const file = this.fileFor(word)

    if (ctx && file !== null) {
      let entry = this.cache.get(file)
      if (!entry && !this.deadFiles.has(file)) {
        try {
          entry = await this.loadBuffer(word)
        } catch {
          entry = undefined
        }
      }
      // Yuklash davomida yangi so'z kelgan bo'lsa, bu ijro endi keraksiz.
      if (gen !== this.generation) {
        this.callbacks.onFailed(tokenIndex)
        return
      }
      if (entry && this.startBuffer(ctx, entry, tokenIndex)) return
    }

    if (gen !== this.generation) {
      this.callbacks.onFailed(tokenIndex)
      return
    }

    if (speechAvailable()) {
      let started = false
      this.currentMode = 'speech'
      this.currentStartedAt = null
      try {
        await speakWord(word, () => {
          if (gen !== this.generation) return
          started = true
          this.currentStartedAt = performance.now()
          this.callbacks.onStarted(tokenIndex)
        })
      } catch {
        // Pastda `onFailed` chaqiriladi.
      }
      if (gen === this.generation && this.currentMode === 'speech') {
        this.currentMode = null
        this.currentStartedAt = null
      }
      if (started) return
    }

    this.callbacks.onFailed(tokenIndex)
  }

  /**
   * Buferni ijro qiladi. HAR ijroga YANGI `AudioBufferSourceNode` yaratiladi:
   * node bir martalik, ikkinchi `start()` `InvalidStateError` beradi va
   * butun seans ovozi o'lardi.
   *
   * `true` qaytsa — ovoz chiqdi va `onStarted` chaqirildi.
   */
  private startBuffer(ctx: AudioContext, entry: CachedAudio, tokenIndex: number): boolean {
    if (ctx.state !== 'running') {
      // Kontekst uxlab yotibdi: ovoz chiqmaydi, demak muvaffaqiyat emas.
      void ctx.resume().catch(() => {})
      return false
    }

    let src: AudioBufferSourceNode
    let gain: GainNode
    try {
      src = ctx.createBufferSource()
      src.buffer = entry.buffer
      gain = ctx.createGain()
      gain.gain.setValueAtTime(1, ctx.currentTime)
      src.connect(gain)
      gain.connect(ctx.destination)
      // Boshidagi jimlik kesib tashlanadi.
      src.start(0, entry.offset)
    } catch {
      return false
    }

    if (ctx.state !== 'running') {
      try {
        src.stop()
      } catch {
        // Allaqachon to'xtagan bo'lishi mumkin.
      }
      return false
    }

    this.currentSource = src
    this.currentGain = gain
    this.currentMode = 'buffer'
    this.currentStartedAt = performance.now()

    src.onended = () => {
      try {
        src.disconnect()
        gain.disconnect()
      } catch {
        // Uzilgan node ni qayta uzish xavfsiz emas — e'tiborsiz qoldiriladi.
      }
      if (this.currentSource === src) {
        this.currentSource = null
        this.currentGain = null
        this.currentMode = null
        this.currentStartedAt = null
      }
    }

    this.callbacks.onStarted(tokenIndex)
    return true
  }

  /** Joriy ijroni fade bilan so'ndiradi. Uzish bu yerda odatiy yo'l, chekka holat emas. */
  private stopCurrent(): void {
    const ctx = sharedContext
    const src = this.currentSource
    const gain = this.currentGain

    if (ctx && src && gain) {
      const now = ctx.currentTime
      try {
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(gain.gain.value, now)
        gain.gain.setTargetAtTime(0, now, FADE_TAU_S)
      } catch {
        // Fade qo'yib bo'lmasa ham node baribir to'xtatiladi.
      }
      try {
        src.stop(now + FADE_STOP_S)
      } catch {
        // Hali `start()` qilinmagan yoki allaqachon to'xtagan.
      }
    }

    if (this.currentMode === 'speech') cancelSpeech()

    this.currentSource = null
    this.currentGain = null
    this.currentMode = null
    this.currentStartedAt = null
  }

  /** Bir fayl uchun bitta yuklash: parallel chaqiruvlar bitta promise'ni bo'lishadi. */
  private loadBuffer(word: string): Promise<CachedAudio> {
    const file = this.fileFor(word)
    if (file === null) return Promise.reject(new Error("fayl nomiga yaroqsiz so'z"))
    const hit = this.cache.get(file)
    if (hit) return Promise.resolve(hit)
    const running = this.inflight.get(file)
    if (running) return running

    const task = this.fetchAndDecode(word, file).finally(() => {
      this.inflight.delete(file)
    })
    this.inflight.set(file, task)
    return task
  }

  private async fetchAndDecode(word: string, file: string): Promise<CachedAudio> {
    const ctx = getContext()
    if (!ctx) throw new Error('AudioContext mavjud emas')
    if (this.deadFiles.has(file)) throw new Error('fayl yaroqsiz deb belgilangan')

    let bytes = await this.fetchBytes(file)
    if (bytes === null) {
      // Fayl hali sintez qilinmagan YOKI diskda buzuq (0 bayt, yarim yozilgan) yotibdi.
      // Ikkala holatda ham bitta so'zlik batch so'raymiz: server buzuq faylni kesh
      // urishi deb hisoblamaydi va ustiga yangisini yozadi (PLAN §9, E2E 6-band).
      const batch = await requestBatch([word], this.voice, this.rate)
      const first = batch.ok[0]
      if (!first) throw new Error('sintez muvaffaqiyatsiz')
      this._serverOk = true
      bytes = await this.fetchBytes(first.file)
      if (bytes === null) {
        this.deadFiles.add(file)
        throw new Error('MP3 qayta sintezdan keyin ham yaroqsiz')
      }
    }

    // Dekodlangan bufer keshlanadi: `decodeAudioData` kirish buferini detach qiladi,
    // shuning uchun baytlarni saqlab qayta dekodlash jimlik berardi.
    let buffer: AudioBuffer
    try {
      buffer = await ctx.decodeAudioData(bytes)
    } catch {
      // Buzuq MP3. Belgilab qo'yamiz: aks holda har bosishda qayta yuklab, qayta
      // yiqilardi va har safar zaxiraga o'tish kechikardi.
      this.deadFiles.add(file)
      throw new Error('MP3 dekodlanmadi')
    }

    const offset = findSoundStart(buffer)
    if (offset === null) {
      this.deadFiles.add(file)
      throw new Error('bufer butunlay jim')
    }

    const entry: CachedAudio = { buffer, offset }
    this.cache.set(file, entry)
    this._serverOk = true
    return entry
  }

  /**
   * MP3 baytlari. Fayl yo'q, tarmoq uzilgan yoki javob ishonchsiz kichik bo'lsa `null`.
   * `null` — "qayta sintez qilib ko'r" degani, istisno emas.
   */
  private async fetchBytes(file: string): Promise<ArrayBuffer | null> {
    let res: Response
    try {
      res = await fetch(audioUrl(file))
    } catch {
      return null
    }
    if (!res.ok) return null
    try {
      const bytes = await res.arrayBuffer()
      return bytes.byteLength >= MIN_MP3_BYTES ? bytes : null
    } catch {
      return null
    }
  }
}

export const audioManager = new AudioManager()

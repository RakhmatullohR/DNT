// `AudioManager` ning navbat mantiqi (PLAN §5b): guard, kutish sloti, kechikish
// byudjeti va "jimlik hech qachon eshitilgan hisoblanmaydi" sharti.
//
// NEGA BU TESTLAR BOR. Audit paytida aniqlandiki, rejaning eng vaqtga-sezgir
// qismi — qisqa so'z guard'i — umuman testsiz edi, ya'ni `GUARD_MS`/`MAX_LAG_MS`
// o'zgarsa yoki `lagMs` hisobi buzilsa hech kim sezmasdi. Quyidagi testlar
// mavjud xatti-harakatni QOTIRIB QO'YADI: ular "shunday bo'lishi kerak" degan
// ideal emas, "hozir aynan shunday" degan hujjat. Parametrlarni o'zgartirsangiz,
// aynan qaysi holat o'zgarganini shu testlar ko'rsatadi.
//
// `jsdom` ishlatilmaydi (PLAN §1: ortiqcha paket yo'q) — kerak bo'lgan ikkita
// brauzer API'si shu yerda qo'lda qo'yiladi.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AudioManager as AudioManagerType } from '../../src/audio/AudioManager.ts'

// Tarmoq qatlami butunlay o'rnini bosuvchi bilan almashtiriladi: bu test
// navbat mantiqini tekshiradi, HTTP ni emas.
vi.mock('../../src/audio/ttsClient.ts', () => ({
  audioUrl: (file: string) => 'http://test.invalid/api/audio/' + file,
  requestBatch: vi.fn(async (words: string[]) => ({
    ok: words.map((word) => ({ word, file: word + '.mp3' })),
    failed: [] as Array<{ word: string; error: string }>,
  })),
  serverAvailable: vi.fn(async () => true),
}))

const SAMPLE_RATE = 1000

/** Birinchi sempldan boshlab "ovozli" bufer — `findSoundStart` 0 qaytaradi. */
function fakeBuffer(): AudioBuffer {
  const data = new Float32Array(SAMPLE_RATE)
  data[0] = 0.5
  return {
    numberOfChannels: 1,
    length: data.length,
    sampleRate: SAMPLE_RATE,
    duration: 1,
    getChannelData: () => data,
  } as unknown as AudioBuffer
}

class FakeAudioContext {
  state = 'running'
  currentTime = 0
  destination = {}

  createBufferSource(): AudioBufferSourceNode {
    return {
      buffer: null,
      onended: null,
      connect: () => {},
      disconnect: () => {},
      start: () => {},
      stop: () => {},
    } as unknown as AudioBufferSourceNode
  }

  createGain(): GainNode {
    return {
      gain: {
        value: 1,
        setValueAtTime: () => {},
        setTargetAtTime: () => {},
        cancelScheduledValues: () => {},
      },
      connect: () => {},
      disconnect: () => {},
    } as unknown as GainNode
  }

  async resume(): Promise<void> {
    this.state = 'running'
  }

  async decodeAudioData(): Promise<AudioBuffer> {
    return fakeBuffer()
  }
}

/**
 * `speechSynthesis` ATAYIN qo'yilmaydi: zaxira zanjiri yopiq bo'lsa,
 * bufer ijrosi muvaffaqiyatsiz bo'lgan har qanday holat `onFailed` bilan
 * tugaydi va "jimlik eshitilgan hisoblanmaydi" sharti to'g'ridan-to'g'ri
 * tekshiriladi.
 */
function installBrowserGlobals(): void {
  ;(globalThis as unknown as { window: unknown }).window = {
    AudioContext: FakeAudioContext,
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  globalThis.fetch = (async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(2048),
  })) as unknown as typeof fetch
}

function removeBrowserGlobals(): void {
  delete (globalThis as unknown as { window?: unknown }).window
}

describe('AudioManager — guard va kutish sloti (PLAN §5b)', () => {
  let manager: AudioManagerType
  let onStarted: ReturnType<typeof vi.fn<(tokenIndex: number) => void>>
  let onFailed: ReturnType<typeof vi.fn<(tokenIndex: number) => void>>
  let GUARD_MS: number
  let MAX_LAG_MS: number

  beforeEach(async () => {
    // `performance` ham soxta: guard `performance.now()` ga tayanadi, ya'ni
    // uni soxtalashtirmasdan vaqt o'tishini boshqarib bo'lmaydi.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    installBrowserGlobals()

    // Modul darajasidagi `sharedContext` singleton'i har testda toza bo'lishi
    // uchun modul qaytadan yuklanadi.
    vi.resetModules()
    const mod = await import('../../src/audio/AudioManager.ts')
    GUARD_MS = mod.GUARD_MS
    MAX_LAG_MS = mod.MAX_LAG_MS

    manager = new mod.AudioManager()
    onStarted = vi.fn<(tokenIndex: number) => void>()
    onFailed = vi.fn<(tokenIndex: number) => void>()
    manager.setCallbacks({ onStarted, onFailed })

    // Kesh oldindan to'ldiriladi: shunda `playWord` ijroni SINXRON boshlaydi
    // va navbat mantiqi `await` larsiz, aniq vaqtlarda tekshiriladi.
    await manager.prefetch(['one', 'two', 'three', 'four'])
  })

  afterEach(() => {
    vi.useRealTimers()
    removeBrowserGlobals()
    vi.restoreAllMocks()
  })

  it('birinchi so‘z darhol boshlanadi', () => {
    manager.playWord('one', 0)

    expect(onStarted).toHaveBeenCalledWith(0)
    expect(onFailed).not.toHaveBeenCalled()
  })

  it('guard oynasi ichida kelgan so‘z kutish slotiga qo‘yiladi va keyin o‘qiladi', () => {
    manager.playWord('one', 0)
    vi.advanceTimersByTime(50)

    manager.playWord('two', 1)
    // Hali navbatda: 1-so'z o'zining GUARD_MS oynasini oxirigacha oladi.
    expect(onStarted).not.toHaveBeenCalledWith(1)

    vi.advanceTimersByTime(GUARD_MS - 50)
    expect(onStarted).toHaveBeenCalledWith(1)
    expect(onFailed).not.toHaveBeenCalled()
  })

  it('slotdagi so‘z yangisi bilan siqib chiqarilsa `onFailed` oladi — u eshitilmadi', () => {
    manager.playWord('one', 0)
    vi.advanceTimersByTime(50)
    manager.playWord('two', 1) // slotga tushdi, lagMs = 200

    vi.advanceTimersByTime(50) // t = 100
    // 200 + (250-100) = 350 > MAX_LAG_MS -> byudjet tugadi: joriy ijro kesiladi,
    // slotdagi `two` esa umuman eshitilmaydi.
    manager.playWord('three', 2)

    expect(onFailed).toHaveBeenCalledWith(1)
    expect(onStarted).toHaveBeenCalledWith(2)
    expect(onStarted).not.toHaveBeenCalledWith(1)
  })

  // Bu test AUDIT topilmasini hujjatlashtiradi. `lagMs` rejalashtirilgan so'z
  // haqiqatan boshlanganda nolga qaytmaydi (`startNow` uni tegmaydi), shuning
  // uchun byudjet bir burst ichida bittagina to'liq kechikishga yetadi.
  // Natija: ketma-ket qisqa so'zlarda HAR IKKINCHI so'z o'z GUARD_MS oynasini
  // to'liq olmaydi. Bu PLAN §5b dagi yozma qoidaning to'g'ri bajarilishi
  // ("aks holda joriy ijro so'ndiriladi"), lekin §Context dagi "qisqa so'z
  // audiosi kesilmaydi" sarlavhasidan kuchsizroq kafolat.
  it('to‘plangan kechikish byudjeti tugaganda joriy so‘z oynasini to‘lmay kesiladi', () => {
    manager.playWord('one', 0) // t=0 boshlandi
    vi.advanceTimersByTime(50)
    manager.playWord('two', 1) // rejalashtirildi, lagMs = 200

    vi.advanceTimersByTime(GUARD_MS - 50) // t=250: `two` boshlandi
    expect(onStarted).toHaveBeenCalledWith(1)

    vi.advanceTimersByTime(50) // t=300: `two` atigi 50 ms o'qildi
    manager.playWord('three', 2)

    // lagMs (200) hali ham hisobda -> 200 + 200 = 400 > 300 -> `two` kesiladi.
    expect(onStarted).toHaveBeenCalledWith(2)
    // `three` KUTMADI, ya'ni darhol boshlandi:
    expect(onStarted).toHaveBeenLastCalledWith(2)
    expect(MAX_LAG_MS).toBeLessThan(2 * GUARD_MS)
  })

  it('`stopAll` kechikish hisobini nolga qaytaradi', () => {
    manager.playWord('one', 0)
    vi.advanceTimersByTime(50)
    manager.playWord('two', 1) // slotda, lagMs = 200

    manager.stopAll()
    expect(onFailed).toHaveBeenCalledWith(1) // slotdagi so'z eshitilmadi

    // Hisob tozalangani uchun keyingi so'z yana to'liq guard oynasini oladi.
    manager.playWord('three', 2)
    expect(onStarted).toHaveBeenCalledWith(2)

    vi.advanceTimersByTime(50)
    manager.playWord('four', 3)
    expect(onStarted).not.toHaveBeenCalledWith(3) // rejalashtirildi, kesilmadi
    vi.advanceTimersByTime(GUARD_MS - 50)
    expect(onStarted).toHaveBeenCalledWith(3)
  })

  it('guard oynasidan keyin kelgan so‘z kutmaydi', () => {
    manager.playWord('one', 0)
    vi.advanceTimersByTime(GUARD_MS + 10)

    manager.playWord('two', 1)
    expect(onStarted).toHaveBeenCalledWith(1)
  })
})

describe('AudioManager — jimlik hech qachon "eshitilgan" emas (PLAN §4, §5b)', () => {
  let manager: AudioManagerType
  let onStarted: ReturnType<typeof vi.fn<(tokenIndex: number) => void>>
  let onFailed: ReturnType<typeof vi.fn<(tokenIndex: number) => void>>

  beforeEach(async () => {
    installBrowserGlobals()
    vi.resetModules()
    const mod = await import('../../src/audio/AudioManager.ts')
    manager = new mod.AudioManager()
    onStarted = vi.fn<(tokenIndex: number) => void>()
    onFailed = vi.fn<(tokenIndex: number) => void>()
    manager.setCallbacks({ onStarted, onFailed })
  })

  afterEach(() => {
    removeBrowserGlobals()
    vi.restoreAllMocks()
  })

  it('ovozsiz rejimda `onFailed` chaqiriladi — so‘z "o‘qilgan" deb belgilanmaydi', () => {
    manager.setEnabled(false)
    manager.playWord('one', 0)

    expect(onFailed).toHaveBeenCalledWith(0)
    expect(onStarted).not.toHaveBeenCalled()
  })

  it('bo‘sh so‘z `onFailed` bilan tugaydi', () => {
    manager.playWord('', 7)

    expect(onFailed).toHaveBeenCalledWith(7)
    expect(onStarted).not.toHaveBeenCalled()
  })

  it('MP3 ham, brauzer sintezi ham ishlamasa `onFailed` chaqiriladi', async () => {
    // Fayl yo'q va qayta sintez ham natija bermaydi.
    globalThis.fetch = (async () => ({
      ok: false,
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch
    const { requestBatch } = await import('../../src/audio/ttsClient.ts')
    vi.mocked(requestBatch).mockResolvedValueOnce({ ok: [], failed: [] })

    manager.playWord('one', 3)
    await vi.waitFor(() => {
      expect(onFailed).toHaveBeenCalledWith(3)
    })
    expect(onStarted).not.toHaveBeenCalled()
  })
})

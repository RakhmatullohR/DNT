// `server/tts.ts` testlari — TARMOQSIZ.
// `@andresaya/edge-tts` to'liq soxta sinf bilan almashtiriladi, shuning uchun
// hech qanday WebSocket ochilmaydi va testlar Microsoft endpointiga bog'liq emas.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_RETRIES, SYNTH_TIMEOUT_MS, synthesizeWord } from '../../server/tts.ts'

/** Soxta instance navbatdagi urinishda o'zini qanday tutishi. */
type Step =
  | { kind: 'ok'; bytes: number }
  /** `MIN_AUDIO_BYTES` dan kichik bufer — buzuq audio. */
  | { kind: 'small'; bytes: number }
  /** `synthesize()` resolve bo'ladi, `toBuffer()` esa yiqiladi (kutubxonaning 2-xatosi). */
  | { kind: 'empty' }
  /** Socket ochilmay osilib qoladi — promise hech qachon settle bo'lmaydi (3-xato). */
  | { kind: 'hang' }
  | { kind: 'reject'; message: string }

const mock = vi.hoisted(() => {
  const state = {
    /** Nechta `new EdgeTTS()` chaqirilgani — 1-xatoning asosiy o'lchovi. */
    constructed: 0,
    /** Nechta marta socket yopishga urinilgani. */
    closed: 0,
    calls: [] as { text: string; voice: string | undefined; rate: unknown }[],
    steps: [] as Step[],
  }

  class FakeEdgeTTS {
    #step: Step
    #text = ''

    ws = {
      close: () => {
        state.closed += 1
      },
    }

    constructor() {
      this.#step = state.steps[state.constructed] ?? { kind: 'ok', bytes: 4096 }
      state.constructed += 1
    }

    async synthesize(
      text: string,
      voice?: string,
      options?: { rate?: string | number },
    ): Promise<void> {
      this.#text = text
      state.calls.push({ text, voice, rate: options?.rate })
      const step = this.#step
      if (step.kind === 'hang') {
        // Kutubxonada ulanish taymeri yo'q: bu promise hech qachon settle bo'lmaydi.
        await new Promise<void>(() => {})
      }
      if (step.kind === 'reject') {
        throw new Error(step.message)
      }
    }

    toBuffer(): Buffer {
      const step = this.#step
      if (step.kind !== 'ok' && step.kind !== 'small') {
        // Manbadagi haqiqiy matn (`EdgeTTS.js:486`).
        throw new Error('No audio data available. Did you run synthesize() first?')
      }
      // Bufer AYNAN shu instance sintez qilgan matndan yasaladi:
      // instance qayta ishlatilsa, so'zlarning aralashgani darhol ko'rinadi.
      return Buffer.alloc(step.bytes, this.#text.charCodeAt(0))
    }
  }

  return { state, FakeEdgeTTS }
})

vi.mock('@andresaya/edge-tts', () => ({ EdgeTTS: mock.FakeEdgeTTS }))

const VOICE = 'en-US-AvaNeural'

function plan(...steps: Step[]): void {
  mock.state.steps.push(...steps)
}

beforeEach(() => {
  vi.useFakeTimers()
  mock.state.constructed = 0
  mock.state.closed = 0
  mock.state.calls.length = 0
  mock.state.steps.length = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('synthesizeWord', () => {
  it('muvaffaqiyatli holatda MP3 buferini qaytaradi', async () => {
    plan({ kind: 'ok', bytes: 2048 })

    const buf = await synthesizeWord('quick', { voice: VOICE, rate: 0 })

    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBe(2048)
    expect(mock.state.constructed).toBe(1)
  })

  it('voice va rate kutubxonaga aynan uzatiladi (rate foizga aylantiriladi)', async () => {
    plan({ kind: 'ok', bytes: 2048 }, { kind: 'ok', bytes: 2048 }, { kind: 'ok', bytes: 2048 })

    await synthesizeWord('quick', { voice: VOICE, rate: 0 })
    await synthesizeWord('quick', { voice: 'en-GB-SoniaNeural', rate: -25 })
    await synthesizeWord('quick', { voice: VOICE, rate: -10 })

    expect(mock.state.calls).toEqual([
      { text: 'quick', voice: 'en-US-AvaNeural', rate: '+0%' },
      { text: 'quick', voice: 'en-GB-SoniaNeural', rate: '-25%' },
      { text: 'quick', voice: 'en-US-AvaNeural', rate: '-10%' },
    ])
  })

  it('har chaqiruvda YANGI EdgeTTS instance yaratiladi (parallel chaqiruvlar aralashmaydi)', async () => {
    plan({ kind: 'ok', bytes: 2048 }, { kind: 'ok', bytes: 2048 })

    const [a, b] = await Promise.all([
      synthesizeWord('alpha', { voice: VOICE, rate: 0 }),
      synthesizeWord('bravo', { voice: VOICE, rate: 0 }),
    ])

    expect(mock.state.constructed).toBe(2)
    // Har bufer O'Z so'zidan yasalgan. Instance qayta ishlatilganda ikkalasi ham
    // oxirgi so'zning baytlari bilan to'lardi.
    expect(a[0]).toBe('a'.charCodeAt(0))
    expect(b[0]).toBe('b'.charCodeAt(0))
  })

  it('retry ham HAR SAFAR yangi instance bilan boshlanadi', async () => {
    plan({ kind: 'empty' }, { kind: 'small', bytes: 512 }, { kind: 'ok', bytes: 4096 })

    const p = synthesizeWord('quick', { voice: VOICE, rate: 0 })
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(p).resolves.toHaveLength(4096)
    expect(mock.state.constructed).toBe(MAX_RETRIES + 1)
  })

  it("bo'sh audio (`toBuffer()` yiqiladi) retry sababi bo'ladi", async () => {
    plan({ kind: 'empty' }, { kind: 'ok', bytes: 4096 })

    const p = synthesizeWord('quick', { voice: VOICE, rate: 0 })
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(p).resolves.toHaveLength(4096)
    expect(mock.state.constructed).toBe(2)
  })

  it('juda kichik bufer retry sababi bo\'ladi', async () => {
    plan({ kind: 'small', bytes: 1023 }, { kind: 'ok', bytes: 4096 })

    const p = synthesizeWord('quick', { voice: VOICE, rate: 0 })
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(p).resolves.toHaveLength(4096)
    expect(mock.state.constructed).toBe(2)
  })

  it('MAX_RETRIES dan keyin ham buzuq bo\'lsa xato beradi', async () => {
    plan({ kind: 'empty' }, { kind: 'small', bytes: 10 }, { kind: 'empty' })

    const p = synthesizeWord('quick', { voice: VOICE, rate: 0 })
    const assertion = expect(p).rejects.toThrow(/"quick" sintez qilinmadi \(3 urinish\)/)
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion

    expect(mock.state.constructed).toBe(MAX_RETRIES + 1)
  })

  it('synthesize() ning o\'z xatosi ham retry bilan qoplanadi', async () => {
    plan({ kind: 'reject', message: 'socket yiqildi' }, { kind: 'ok', bytes: 3000 })

    const p = synthesizeWord('quick', { voice: VOICE, rate: 0 })
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(p).resolves.toHaveLength(3000)
    expect(mock.state.constructed).toBe(2)
  })

  it('synthesize osilib qolsa SYNTH_TIMEOUT_MS dan keyin uziladi', async () => {
    plan({ kind: 'hang' }, { kind: 'hang' }, { kind: 'hang' })

    const p = synthesizeWord('quick', { voice: VOICE, rate: 0 })
    let settled = false
    const outcome: Promise<unknown> = p.then(
      (value) => {
        settled = true
        return value
      },
      (err: unknown) => {
        settled = true
        return err
      },
    )

    // Taymer tugagunicha hech narsa sodir bo'lmaydi.
    await vi.advanceTimersByTimeAsync(SYNTH_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    expect(mock.state.constructed).toBe(1)

    // 1-urinish uziladi -> 300 ms backoff -> 2-urinish.
    await vi.advanceTimersByTimeAsync(1 + 300)
    expect(settled).toBe(false)
    expect(mock.state.constructed).toBe(2)

    // Qolgan urinishlar ham uziladi.
    await vi.advanceTimersByTimeAsync(SYNTH_TIMEOUT_MS * 2 + 1_000)
    const err = await outcome

    expect(settled).toBe(true)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/20000 ms kutish vaqti tugadi/)
    expect(mock.state.constructed).toBe(MAX_RETRIES + 1)
    // Osilib qolgan socket har urinishdan keyin yopishga urinildi.
    expect(mock.state.closed).toBe(MAX_RETRIES + 1)
  })

  it('diapazondan tashqaridagi rate ni O\'ZIMIZ rad etamiz (kutubxonada tekshiruv yo\'q)', async () => {
    await expect(synthesizeWord('quick', { voice: VOICE, rate: -500 })).rejects.toThrow(/rate/)
    await expect(synthesizeWord('quick', { voice: VOICE, rate: 500 })).rejects.toThrow(/rate/)
    await expect(synthesizeWord('quick', { voice: VOICE, rate: -12.5 })).rejects.toThrow(/rate/)

    // Sintezga umuman borilmaydi.
    expect(mock.state.constructed).toBe(0)
  })

  it('bo\'sh matn va bo\'sh ovoz rad etiladi', async () => {
    await expect(synthesizeWord('   ', { voice: VOICE, rate: 0 })).rejects.toThrow(/matn/)
    await expect(synthesizeWord('quick', { voice: '  ', rate: 0 })).rejects.toThrow(/voice/)

    expect(mock.state.constructed).toBe(0)
  })
})

// `src/audio/ttsClient.ts` <-> `server/index.ts` SIM CHEGARASI testi.
//
// Bu yerdagi asosiy g'oya: `globalThis.fetch` stub qilinadi va klientning HAQIQIY
// so'rovi haqiqiy `buildServer()` nusxasiga `app.inject` orqali uzatiladi. Ya'ni
// tekshiriladigan narsa klientning ichki holati emas, SERVER QABUL QILGAN TANA.
// Shu sababli klient va server sxemasi orasidagi har qanday nomuvofiqlik (tashlab
// ketilgan yoki nomi o'zgargan maydon) shu yerda ko'rinadi.
//
// `server/tts.ts` va `server/store.ts` `vi.mock` bilan almashtiriladi — tarmoq ham,
// disk ham ishlatilmaydi. Muhit — node; hech qanday DOM kerak emas.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '../../server/index.ts'
import { requestBatch } from '../../src/audio/ttsClient.ts'
import {
  DEFAULT_RATE,
  DEFAULT_VOICE,
  sanitizeRate,
  sanitizeVoice,
} from '../../shared/filename.ts'

// `vi.mock` fabrikalari import'lardan OLDIN ishga tushadi, shuning uchun ular
// tayanadigan holat `vi.hoisted` ichida yaratiladi.
const h = vi.hoisted(() => {
  const files = new Map<string, Buffer>()
  const counters = { inFlight: 0, maxInFlight: 0 }

  /**
   * Qo'lda boshqariladigan sintez. `on` yoqilganda har bir chaqiruv test uni
   * bo'shatmaguncha "ichkarida" turadi — parallellikni taymerga tayanmasdan
   * o'lchash uchun. O'chiq bo'lsa sintez darhol tugaydi.
   */
  const gate = { on: false, pending: [] as Array<{ resolve: () => void }> }

  /** ID3 sarlavhasi + 4 KB — soxta MP3. */
  const fakeMp3 = (): Buffer => Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4096, 7)])

  return {
    files,
    counters,
    gate,
    fakeMp3,
    reset: (): void => {
      files.clear()
      counters.inFlight = 0
      counters.maxInFlight = 0
      gate.on = false
      gate.pending.length = 0
    },
  }
})

vi.mock('../../server/tts.ts', () => ({
  SYNTH_TIMEOUT_MS: 20_000,
  MAX_RETRIES: 2,
  synthesizeWord: async (): Promise<Buffer> => {
    h.counters.inFlight += 1
    h.counters.maxInFlight = Math.max(h.counters.maxInFlight, h.counters.inFlight)
    if (h.gate.on) {
      await new Promise<void>((resolve) => {
        h.gate.pending.push({ resolve })
      })
    }
    h.counters.inFlight -= 1
    return h.fakeMp3()
  },
}))

vi.mock('../../server/store.ts', () => ({
  AUDIO_DIR: '/dnt-soxta-audio',
  audioPath: (file: string): string => `/dnt-soxta-audio/${file}`,
  ensureAudioDir: async (): Promise<void> => {},
  looksLikeMp3: (buf: Uint8Array): boolean => buf.length >= 3 && buf[0] === 0x49,
  readValidCached: async (file: string): Promise<Buffer | null> => h.files.get(file) ?? null,
  writeAtomic: async (file: string, buf: Buffer): Promise<void> => {
    h.files.set(file, buf)
  },
  ensureAudio: async (
    file: string,
    synth: () => Promise<Buffer>,
  ): Promise<{ status: 'cached' | 'synthesized' }> => {
    if (h.files.has(file)) return { status: 'cached' }
    const buf = await synth()
    h.files.set(file, buf)
    return { status: 'synthesized' }
  },
  inFlightCount: (): number => 0,
  __resetForTests: (): void => {
    h.files.clear()
  },
}))

/** Server qabul qilgan tana. Maydonlar ixtiyoriy — tashlab ketilgani ko'rinishi kerak. */
type SentBody = {
  words?: string[]
  voice?: string
  rate?: number
  background?: boolean
}

/** Shu testda serverga yetib borgan tanalar, yuborilish tartibida. */
const sent: SentBody[] = []

let app: FastifyInstance
let realFetch: typeof globalThis.fetch

/** `fetch` ga berilgan manzilni satr ko'rinishida qaytaradi. */
function urlOf(input: unknown): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  throw new Error("kutilmagan so'rov manzili")
}

/**
 * Klientning so'rovini haqiqiy Fastify nusxasiga uzatadi va javobni standart
 * `Response` ga o'raydi — `ttsClient.ts` aynan `res.ok` va `res.json()` ga tayanadi.
 */
async function injectingFetch(input: unknown, init?: RequestInit): Promise<Response> {
  const url = urlOf(input)
  const rawBody = init?.body
  const payload = typeof rawBody === 'string' ? rawBody : undefined
  if (payload !== undefined) sent.push(JSON.parse(payload) as SentBody)

  const res = await app.inject({
    method: init?.method === 'POST' ? 'POST' : 'GET',
    url,
    headers: { 'content-type': 'application/json' },
    payload,
  })

  // `/api/*` javoblari JSON, shuning uchun satr ko'rinishidagi tana yetarli.
  return new Response(res.payload, {
    status: res.statusCode,
    headers: { 'content-type': 'application/json' },
  })
}

beforeAll(async () => {
  // `dist/` ataylab yo'q: bu testda faqat `/api/*` marshrutlari kerak.
  const thisFile = fileURLToPath(import.meta.url)
  const distDir = path.join(path.dirname(thisFile), 'dist-yoq')
  app = buildServer({ distDir })
  await app.ready()

  realFetch = globalThis.fetch
  globalThis.fetch = injectingFetch as typeof globalThis.fetch
})

afterAll(async () => {
  globalThis.fetch = realFetch
  await app.close()
})

beforeEach(() => {
  h.reset()
  sent.length = 0
})

/** Bitta makrotask: shu paytgacha yig'ilgan mikrotasklar tugaydi. */
function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** Shart bajarilguncha kutadi. Bajarilmasa — timeout emas, tushunarli xato. */
async function waitFor(label: string, check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return
    await tick()
  }
  throw new Error(`kutish natijasiz tugadi: ${label}`)
}

// `server/index.ts` dagi semafor MODUL darajasida turadi va testlar orasida
// tiklanmaydi. Assert bo'shatishdan OLDIN yiqilsa, gate ichida qolgan sintezlar
// slotlarni qaytarmaydi va keyingi testlar ham yiqilardi — ya'ni bitta xato bir
// nechta xato bo'lib ko'rinardi. Shuning uchun gate ostida boshlangan har bir
// so'rov ro'yxatga olinadi va test qanday tugashidan qat'i nazar bo'shatiladi.

/** Ayni testda boshlangan va hali bo'shatilmagan so'rovlar. */
const parkedRequests: Array<Promise<unknown>> = []

/** So'rovni majburiy bo'shatish ro'yxatiga qo'shadi. */
function park<T>(pending: Promise<T>): Promise<T> {
  parkedRequests.push(pending)
  return pending
}

/** So'rov tugagunicha gate'ni bo'shatib turadi. */
async function drainUntilSettled<T>(pending: Promise<T>): Promise<T> {
  let done = false
  void pending.then(
    () => {
      done = true
    },
    () => {
      done = true
    },
  )
  for (let i = 0; i < 200 && !done; i += 1) {
    await tick()
    for (const entry of h.gate.pending.splice(0)) entry.resolve()
  }
  return pending
}

afterEach(async () => {
  const pending = parkedRequests.splice(0)
  if (pending.length === 0) return

  // Bu yerda hech qachon `throw` bo'lmasligi kerak: tozalash xatosi testning
  // haqiqiy sababini almashtirib qo'yardi. Aylanishlar soni ham cheklangan —
  // so'rov baribir tugamasa, tozalash osilib qolmasdan shunchaki to'xtaydi.
  let settled = false
  void Promise.allSettled(pending).then(() => {
    settled = true
  })
  for (let i = 0; i < 500 && !settled; i += 1) {
    await tick()
    for (const entry of h.gate.pending.splice(0)) entry.resolve()
  }
})

/** Noyob, faqat harflardan iborat so'zlar: `wa`, `wb`, ... `wba`, ... */
function sampleWords(count: number): string[] {
  const out: string[] = []
  for (let i = 0; i < count; i += 1) {
    let n = i
    let suffix = ''
    do {
      suffix = String.fromCharCode(97 + (n % 26)) + suffix
      n = Math.floor(n / 26)
    } while (n > 0)
    out.push(`w${suffix}`)
  }
  return out
}

describe("requestBatch — sim ustidagi so'rov tanasi", () => {
  it("{ background: true } serverga aynan shu maydon nomi bilan yetib boradi", async () => {
    const result = await requestBatch(['quick'], DEFAULT_VOICE, DEFAULT_RATE, { background: true })

    // Butun tana solishtiriladi: maydon tashlab ketilsa ham, nomi o'zgarsa ham
    // shu yerda ko'rinadi.
    expect(sent).toEqual([
      { words: ['quick'], voice: DEFAULT_VOICE, rate: DEFAULT_RATE, background: true },
    ])
    // Sxemada `additionalProperties: false` turibdi, ya'ni nomi o'zgargan maydon
    // 400 beradi va butun paket `failed` ga tushadi.
    expect(result.failed).toEqual([])
    expect(result.ok.map((entry) => entry.word)).toEqual(['quick'])
  })

  it("parametrsiz chaqiruv INTERAKTIV bo'lib qoladi", async () => {
    const result = await requestBatch(['brown'], DEFAULT_VOICE, DEFAULT_RATE)

    expect(sent).toEqual([
      { words: ['brown'], voice: DEFAULT_VOICE, rate: DEFAULT_RATE, background: false },
    ])
    expect(result.failed).toEqual([])
  })

  it('{ background: false } ham interaktiv', async () => {
    await requestBatch(['jump'], DEFAULT_VOICE, DEFAULT_RATE, { background: false })

    expect(sent[0]?.background).toBe(false)
  })

  it("200 tadan katta ro'yxat bo'linadi va HAR BIR bo'lak bayroqni saqlaydi", async () => {
    const all = sampleWords(210)
    const result = await requestBatch(all, DEFAULT_VOICE, DEFAULT_RATE, { background: true })

    expect(sent).toHaveLength(2)
    expect(sent[0]?.words).toHaveLength(200)
    expect(sent[1]?.words).toHaveLength(10)
    expect(sent[0]?.background).toBe(true)
    expect(sent[1]?.background).toBe(true)
    expect(result.ok).toHaveLength(210)
  })

  it("sintez qilib bo'lmaydigan token serverga umuman yuborilmaydi", async () => {
    const result = await requestBatch(['2024', 'jump'], DEFAULT_VOICE, DEFAULT_RATE, {
      background: true,
    })

    expect(sent[0]?.words).toEqual(['jump'])
    expect(result.failed.map((entry) => entry.word)).toEqual(['2024'])
    expect(result.ok.map((entry) => entry.word)).toEqual(['jump'])
  })

  it("takrorlangan so'z simga bir marta chiqadi", async () => {
    await requestBatch(['echo', 'echo', 'echo'], DEFAULT_VOICE, DEFAULT_RATE, { background: true })

    expect(sent[0]?.words).toEqual(['echo'])
    expect(sent[0]?.background).toBe(true)
  })
})

// Yuqoridagi guruh maydon simga chiqishini tekshiradi; bu guruh esa o'sha maydon
// SERVER XULQINI haqiqatan o'zgartirishini tekshiradi. Ikkalasi birga: klient
// bayroqni yubormasa yoki server uni o'qimasa — shu yerda ko'rinadi.
describe("requestBatch — fon bayrog'i serverdagi navbatga ta'sir qiladi", () => {
  it("fon paketi 4 slotdan ko'pi bilan 2 tasini egallaydi", async () => {
    h.gate.on = true
    const pending = park(
      requestBatch(sampleWords(6), DEFAULT_VOICE, DEFAULT_RATE, { background: true }),
    )

    await waitFor('sintez boshlandi', () => h.counters.inFlight > 0)
    // Ortiqcha sintez kirib ulgurishi uchun ataylab qo'shimcha aylanish beriladi:
    // paket interaktiv deb qabul qilinsa, shu yerda 4 ta bo'lardi.
    await tick()
    await tick()
    await tick()
    expect(h.counters.inFlight).toBe(2)

    const result = await drainUntilSettled(pending)
    expect(result.failed).toEqual([])
    expect(result.ok).toHaveLength(6)
    expect(h.counters.maxInFlight).toBe(2)
  })

  it("o'sha paket bayroqsiz yuborilganda 4 slotgacha chiqadi", async () => {
    h.gate.on = true
    const pending = park(requestBatch(sampleWords(6), DEFAULT_VOICE, DEFAULT_RATE))

    await waitFor('sintez boshlandi', () => h.counters.inFlight > 0)
    await tick()
    await tick()
    await tick()
    expect(h.counters.inFlight).toBe(4)

    const result = await drainUntilSettled(pending)
    expect(result.ok).toHaveLength(6)
    expect(h.counters.maxInFlight).toBe(4)
  })
})

// `src/store/lessons.ts` dagi `toLesson` `voice` maydoni yo'q yozuvni BO'SH SATRGA
// tushiradi, `rate` esa xom son bo'lib o'tadi (ro'yxatga solishtirilmaydi). Server
// ikkalasini ham `enum` bilan tekshiradi, ya'ni bunday darsning so'rovi tozalashsiz
// 400 oladi va butun paket yiqiladi.
describe('eski dars qiymatlari: tozalash bo`lmasa server rad etadi', () => {
  it("bo'sh voice xom holda 400 beradi, tozalangani esa 200", async () => {
    const xom = await requestBatch(['the'], '', DEFAULT_RATE, { background: true })
    expect(xom.ok).toEqual([])
    expect(xom.failed).toHaveLength(1)
    expect(xom.failed[0]?.reason).toContain('400')

    const tozalangan = await requestBatch(['the'], sanitizeVoice(''), sanitizeRate(0), {
      background: true,
    })
    expect(tozalangan.failed).toEqual([])
    expect(tozalangan.ok[0]?.file).toBe('the.mp3')
    expect(sent[1]?.voice).toBe(DEFAULT_VOICE)
  })

  it("ro'yxatda yo'q rate xom holda 400 beradi, tozalangani esa 200", async () => {
    const xom = await requestBatch(['the'], DEFAULT_VOICE, -5, { background: true })
    expect(xom.ok).toEqual([])
    expect(xom.failed[0]?.reason).toContain('400')

    const tozalangan = await requestBatch(['the'], sanitizeVoice(DEFAULT_VOICE), sanitizeRate(-5), {
      background: true,
    })
    expect(tozalangan.failed).toEqual([])
    expect(sent[1]?.rate).toBe(DEFAULT_RATE)
  })
})

// Yuqoridagi guruhlar `requestBatch` ning o'zini qoplaydi. Uni CHAQIRADIGAN ikki joy
// esa React kodi ichida: `useTypingSession` — hook effekti, `Import` — komponent
// ichidagi ishlov beruvchi. Node muhitida ikkalasini ham ishga tushirib bo'lmaydi
// (DOM yo'q), shuning uchun chaqiruv joyi MANBA MATNIDAN tekshiriladi. Usiz
// `{ background: true }` argumenti olib tashlansa, butun ustuvorlik mexanizmi
// jimgina o'lik kodga aylanardi va boshqa hech bir tekshiruv buni sezmasdi.

/** Manba fayli — loyiha ildiziga nisbatan. */
function readSource(relative: string): string {
  const thisFile = fileURLToPath(import.meta.url)
  const projectRoot = path.resolve(path.dirname(thisFile), '..', '..')
  return fs.readFileSync(path.join(projectRoot, relative), 'utf8')
}

function countMatches(source: string, pattern: RegExp): number {
  return [...source.matchAll(pattern)].length
}

/** Har qanday `requestBatch(` chaqiruvi — izohlarda bu nom qavssiz yoziladi. */
const CALL = /requestBatch\(/g

/** Oxirgi argumenti aynan `{ background: true }` bo'lgan chaqiruv. */
const BACKGROUND_CALL = /requestBatch\([^)]*\{\s*background:\s*true\s*\}\s*\)/g

describe("chaqiruv joylari: qaysi paket fon deb belgilanadi", () => {
  it("useTypingSession darsning qolgan so'zlarini fon paketi sifatida so'raydi", () => {
    const source = readSource('src/hooks/useTypingSession.ts')

    expect(countMatches(source, CALL)).toBe(1)
    expect(countMatches(source, BACKGROUND_CALL)).toBe(1)
  })

  it('Import ekrani qolgan gaplarni fon paketi sifatida so`raydi', () => {
    const source = readSource('src/screens/Import.tsx')

    // Ikkita chaqiruv bor: birinchi gaplarning so'zlari KUTILADI (interaktiv),
    // qolgan gaplarniki esa fonda ketadi.
    expect(countMatches(source, CALL)).toBe(2)
    expect(countMatches(source, BACKGROUND_CALL)).toBe(1)
  })

  it('AudioManager ijro yo`lidagi so`rovlarni interaktiv qoldiradi', () => {
    const source = readSource('src/audio/AudioManager.ts')

    expect(countMatches(source, CALL)).toBe(2)
    expect(countMatches(source, BACKGROUND_CALL)).toBe(0)
  })

  it("useTypingSession ovoz va tezlikni tozalash helperlaridan o'tkazadi", () => {
    const source = readSource('src/hooks/useTypingSession.ts')

    // Xom `lesson.voice` bo'sh satr bo'lishi mumkin — yuqoridagi guruh buning
    // serverda 400 berishini ko'rsatadi.
    expect(countMatches(source, /sanitizeVoice\(lesson\.voice\)/g)).toBe(1)
    expect(countMatches(source, /sanitizeRate\(lesson\.rate\)/g)).toBe(1)
  })
})

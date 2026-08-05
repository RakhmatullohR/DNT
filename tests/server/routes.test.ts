// Server marshrutlari testi — TARMOQSIZ va DISKSIZ.
//
// `server/tts.ts` (Microsoft endpointi) va `server/store.ts` (disk) `vi.mock` bilan
// stub qilinadi, so'rovlar `fastify.inject()` orqali yuboriladi — hech qanday port
// band qilinmaydi va haqiqiy `audio-words/` papkasi ifloslanmaydi.
//
// PLAN §9 talablari shu yerda qoplanadi:
//   voice:'../../x' -> 400; rate:-500 -> 400; words.length=500 -> 400; words:[] -> 400;
//   to'g'ri so'rov -> 200 va ok ro'yxati; '..%2F..%2Fetc%2Fpasswd' -> 404 (chiqib ketmaydi);
//   noma'lum '/api/yoq' -> 404 JSON (index.html EMAS).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { buildServer } from '../../server/index.ts'
import type { BatchResponse } from '../../server/index.ts'
import { DEFAULT_RATE, DEFAULT_VOICE, audioFilename } from '../../shared/filename.ts'

// `vi.mock` fabrikalari import'lardan OLDIN ishga tushadi, shuning uchun ular
// tayanadigan holat `vi.hoisted` ichida yaratiladi — oddiy modul o'zgaruvchisi
// bu paytda hali `undefined` bo'lardi.
const h = vi.hoisted(() => {
  /** Soxta "disk": fayl nomi -> bufer. Haqiqiy fayl tizimi umuman ishlatilmaydi. */
  const files = new Map<string, Buffer>()
  const synthCalls: string[] = []
  const ensureCalls: string[] = []
  const counters = { inFlight: 0, maxInFlight: 0 }

  /**
   * Qo'lda boshqariladigan sintez. `on` yoqilganda har bir chaqiruv test uni
   * bo'shatmaguncha "ichkarida" turadi — parallellikni taymerga tayanmasdan,
   * aniq o'lchash uchun shu kerak.
   */
  const gate = { on: false, pending: [] as Array<{ text: string; resolve: () => void }> }

  /** ID3 sarlavhasi + 4 KB — `looksLikeMp3` va `> 1 KB` shartidan o'tadigan soxta MP3. */
  const fakeMp3 = (): Buffer => Buffer.concat([Buffer.from('ID3'), Buffer.alloc(4096, 7)])

  return {
    files,
    synthCalls,
    ensureCalls,
    counters,
    gate,
    fakeMp3,
    reset: (): void => {
      files.clear()
      synthCalls.length = 0
      ensureCalls.length = 0
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
  synthesizeWord: async (text: string): Promise<Buffer> => {
    h.synthCalls.push(text)
    h.counters.inFlight += 1
    h.counters.maxInFlight = Math.max(h.counters.maxInFlight, h.counters.inFlight)
    if (h.gate.on) {
      await new Promise<void>((resolve) => {
        h.gate.pending.push({ text, resolve })
      })
    } else {
      await new Promise((resolve) => {
        setTimeout(resolve, 5)
      })
    }
    h.counters.inFlight -= 1
    // Sintez xatosini modellashtirish uchun kelishilgan so'z.
    if (text.includes('bomba')) throw new Error('sintez muvaffaqiyatsiz')
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
    h.ensureCalls.push(file)
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

let root = ''
let app: FastifyInstance
/** `dist/` mavjud BO'LMAGAN holat uchun alohida nusxa. */
let bare: FastifyInstance

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dnt-routes-'))
  const distDir = path.join(root, 'dist')
  fs.mkdirSync(distDir, { recursive: true })
  fs.writeFileSync(
    path.join(distDir, 'index.html'),
    '<!doctype html><title>dnt</title><div id="root"></div>',
  )

  app = buildServer({ distDir })
  bare = buildServer({ distDir: path.join(root, 'dist-yoq') })
  await app.ready()
  await bare.ready()
})

afterAll(async () => {
  await app.close()
  await bare.close()
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  h.reset()
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

/** Noyob va yaroqli so'zlar: `fonx`, `fonxx`, ... */
function words(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => prefix + 'x'.repeat(index + 1))
}

/** Shu prefiks bilan boshlanadigan nechta so'z sintezga KIRGAN. */
function synthCount(prefix: string): number {
  return h.synthCalls.filter((text) => text.startsWith(prefix)).length
}

/**
 * Shu prefiks bilan boshlanadigan nechta fayl `ensureAudio` ga yetib borgan.
 * Kesh tekshiruvi va semafordan slot so'rash bitta sinxron blokda ketadi, shuning
 * uchun bu son "so'rov semaforga yetdi" belgisi bo'lib xizmat qiladi — sintez
 * boshlanmagan, ya'ni `synthCalls` hali jim turgan holatda ham.
 */
function ensureCount(prefix: string): number {
  return h.ensureCalls.filter((file) => file.startsWith(prefix)).length
}

/** Gate'da kutayotgan bitta sintezni (prefiksi bo'yicha) bo'shatadi. */
function releaseSynth(prefix: string): void {
  const index = h.gate.pending.findIndex((entry) => entry.text.startsWith(prefix))
  const entry = index < 0 ? undefined : h.gate.pending[index]
  if (entry === undefined) {
    throw new Error(`gate: '${prefix}' bilan boshlanadigan kutayotgan sintez yo'q`)
  }
  h.gate.pending.splice(index, 1)
  entry.resolve()
}

/** So'rovlar tugagunicha gate'ni bo'shatib turadi. */
async function drainUntilSettled<T>(pending: Array<Promise<T>>): Promise<T[]> {
  let done = false
  const all = Promise.all(pending)
  void all.then(
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
  return all
}

// ---- Testlararo ajratish ----
// `server/index.ts` dagi semafor MODUL darajasida turadi va testlar orasida
// tiklanmaydi. Assert `drainUntilSettled` dan OLDIN yiqilsa, o'sha so'rovning
// yo'laklari gate ichida abadiy qolib, slotlarni qaytarmaydi — keyingi testlar
// bo'sh slot kutib `waitFor` da yiqiladi va bitta haqiqiy xato bir nechta xato
// bo'lib ko'rinadi. Shuning uchun gate ostida yuborilgan har bir so'rov ro'yxatga
// olinadi va test qanday tugashidan qat'i nazar `afterEach` da bo'shatiladi.

/** Ayni testda yuborilgan va hali bo'shatilmagan so'rovlar. */
const parkedRequests: Array<Promise<LightMyRequestResponse>> = []

/** `/api/tts/batch` ga so'rov yuboradi va uni majburiy bo'shatish ro'yxatiga qo'shadi. */
function post(payload: Record<string, unknown>): Promise<LightMyRequestResponse> {
  const pending = app.inject({ method: 'POST', url: '/api/tts/batch', payload })
  parkedRequests.push(pending)
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

describe('GET /api/health', () => {
  it('{ ok: true } qaytaradi', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })
})

describe('POST /api/tts/batch — validatsiya (400)', () => {
  it("voice: '../../x' -> 400 (yo'l traversali fayl nomiga tushmaydi)", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: ['quick'], voice: '../../x' },
    })
    expect(res.statusCode).toBe(400)
    expect(h.synthCalls).toHaveLength(0)
    expect(h.ensureCalls).toHaveLength(0)
    // Hech qanday fayl yaratilmadi — traversal urinishi diskkacha yetib bormadi.
    expect(h.files.size).toBe(0)
  })

  it('rate: -500 -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: ['quick'], rate: -500 },
    })
    expect(res.statusCode).toBe(400)
    expect(h.synthCalls).toHaveLength(0)
  })

  it('words.length = 500 -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: Array.from({ length: 500 }, () => 'quick') },
    })
    expect(res.statusCode).toBe(400)
    expect(h.synthCalls).toHaveLength(0)
  })

  it('words: [] -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: [] },
    })
    expect(res.statusCode).toBe(400)
    expect(h.synthCalls).toHaveLength(0)
  })

  it("words umuman yo'q -> 400", async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tts/batch', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it("noma'lum maydon -> 400", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: ['quick'], voiceName: 'en-US-AvaNeural' },
    })
    expect(res.statusCode).toBe(400)
  })

  it("background: 'ha' (mantiqiy emas) -> 400", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: ['quick'], background: 'ha' },
    })
    expect(res.statusCode).toBe(400)
    expect(h.synthCalls).toHaveLength(0)
  })

  it('background: true qabul qilinadi -> 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: ['quick'], background: true },
    })
    expect(res.statusCode).toBe(200)
    expect(h.synthCalls).toEqual(['quick'])
  })
})

describe("POST /api/tts/batch — to'g'ri so'rov", () => {
  it("200 va ok ro'yxatini qaytaradi, ikkinchi chaqiruv sintezsiz keshdan o'tadi", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: ['quick', 'brown'] },
    })
    expect(res.statusCode).toBe(200)

    const body = res.json() as BatchResponse
    expect(body.failed).toEqual([])
    expect(body.ok.map((entry) => entry.word)).toEqual(['quick', 'brown'])
    expect(body.ok.map((entry) => entry.status)).toEqual(['synthesized', 'synthesized'])
    expect(body.ok[0]?.file).toBe(audioFilename('quick', DEFAULT_VOICE, DEFAULT_RATE))
    expect(h.synthCalls).toHaveLength(2)

    // Ikkinchi chaqiruv — sintez YO'Q.
    h.synthCalls.length = 0
    const again = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: ['quick', 'brown'] },
    })
    expect(again.statusCode).toBe(200)
    const cachedBody = again.json() as BatchResponse
    expect(cachedBody.ok.map((entry) => entry.status)).toEqual(['cached', 'cached'])
    expect(h.synthCalls).toHaveLength(0)
  })

  it("javob tartibi so'rovdagi tartibni saqlaydi", async () => {
    const words = ['zebra', 'alpha', 'mango']
    const res = await app.inject({ method: 'POST', url: '/api/tts/batch', payload: { words } })
    const body = res.json() as BatchResponse
    expect(body.ok.map((entry) => entry.word)).toEqual(words)
  })

  it("katta harfli qisqartma @caps fayliga tushadi va ASL shakli sintez qilinadi", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: ['US'] },
    })
    expect(res.statusCode).toBe(200)

    const body = res.json() as BatchResponse
    expect(body.ok[0]?.file).toBe('us@caps.mp3')
    expect(h.synthCalls).toEqual(['US'])
  })

  it("yaroqsiz so'z failed ro'yxatiga tushadi, qolganlari ishlanadi", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: ['2024', 'jump'] },
    })
    expect(res.statusCode).toBe(200)

    const body = res.json() as BatchResponse
    expect(body.failed.map((entry) => entry.word)).toEqual(['2024'])
    expect(body.failed[0]?.reason).toBeTruthy()
    expect(body.ok.map((entry) => entry.word)).toEqual(['jump'])
    expect(h.synthCalls).toEqual(['jump'])
  })

  it('sintez xatosi failed ga tushadi, so\'rov baribir 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: ['bomba'] },
    })
    expect(res.statusCode).toBe(200)

    const body = res.json() as BatchResponse
    expect(body.ok).toEqual([])
    expect(body.failed).toHaveLength(1)
    expect(body.failed[0]?.word).toBe('bomba')
    expect(body.failed[0]?.reason).toContain('sintez muvaffaqiyatsiz')
  })

  it("takrorlangan so'z bir marta sintez qilinadi, javob esa har element uchun keladi", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: ['echo', 'echo', 'echo'] },
    })
    expect(res.statusCode).toBe(200)

    const body = res.json() as BatchResponse
    expect(body.ok).toHaveLength(3)
    expect(body.ok.every((entry) => entry.file === 'echo.mp3')).toBe(true)
    expect(h.synthCalls).toHaveLength(1)
  })

  it('parallellik 4 tadan oshmaydi', async () => {
    const words = [
      'alpha',
      'bravo',
      'charlie',
      'delta',
      'echoes',
      'foxtrot',
      'golf',
      'hotel',
      'india',
      'juliet',
      'kilo',
      'lima',
    ]
    const res = await app.inject({ method: 'POST', url: '/api/tts/batch', payload: { words } })
    expect(res.statusCode).toBe(200)

    const body = res.json() as BatchResponse
    expect(body.ok).toHaveLength(words.length)
    expect(h.synthCalls).toHaveLength(words.length)
    expect(h.counters.maxInFlight).toBeGreaterThan(1)
    expect(h.counters.maxInFlight).toBeLessThanOrEqual(4)
  })

  it("ruxsat etilgan boshqa ovoz/tezlik fayl nomiga yorliq qo'shadi", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tts/batch',
      payload: { words: ['quick'], voice: 'en-GB-SoniaNeural', rate: -25 },
    })
    expect(res.statusCode).toBe(200)

    const body = res.json() as BatchResponse
    expect(body.ok[0]?.file).toBe(audioFilename('quick', 'en-GB-SoniaNeural', -25))
    expect(body.ok[0]?.file).toContain('@')
  })
})

// Chegara BITTA so'rovda emas, butun jarayonda amal qiladi (PLAN §10): klient ayni
// paytda ham gap oldidan yuklashni, ham fon paketini yuboradi, ya'ni so'rovlar
// ustma-ust tushadi. Sintez `h.gate` bilan to'xtatib turiladi — shunda parallellik
// taymerga tayanmasdan, aniq o'lchanadi.
describe('POST /api/tts/batch — global parallellik chegarasi', () => {
  it("ikkita ustma-ust so'rov birgalikda ham 4 tadan oshmaydi", async () => {
    h.gate.on = true
    const first = post({ words: words('bir', 6) })
    const second = post({ words: words('ikki', 6) })

    await waitFor('4 ta sintez boshlandi', () => h.counters.inFlight === 4)
    // Ortiqcha sintez kirib ulgurishi uchun ataylab qo'shimcha aylanish beriladi:
    // har so'rov o'z hovuzini ochsa, shu yerda 8 ta bo'lardi.
    await tick()
    await tick()
    expect(h.counters.inFlight).toBe(4)
    expect(h.counters.maxInFlight).toBe(4)

    const [firstRes, secondRes] = await drainUntilSettled([first, second])
    expect(firstRes?.statusCode).toBe(200)
    expect(secondRes?.statusCode).toBe(200)
    expect(h.counters.maxInFlight).toBe(4)
    expect(h.synthCalls).toHaveLength(12)
  })

  it("fon so'rovi 4 slotdan ko'pi bilan 2 tasini egallaydi", async () => {
    h.gate.on = true
    const bg = post({ words: words('fon', 6), background: true })

    await waitFor('2 ta fon sintezi boshlandi', () => h.counters.inFlight === 2)
    await tick()
    await tick()
    expect(h.counters.inFlight).toBe(2)

    const [res] = await drainUntilSettled([bg])
    expect(res?.statusCode).toBe(200)
    expect(h.counters.maxInFlight).toBe(2)
    expect(h.synthCalls).toHaveLength(6)
  })

  // Bitta fon so'rovi 2 tadan oshmasligini so'rov ichidagi yo'lak soni ham
  // ta'minlaydi, ya'ni u global fon chegarasini alohida tekshira olmaydi.
  // Ikkita fon so'rovi esa ta'minlay olmaydi: har biri 2 tadan yo'lak ochadi va
  // chegara faqat global bo'lgani uchun 4 emas, 2 ta sintez ketadi.
  it("ikkita bir vaqtdagi fon paketi birgalikda ham 2 slotdan oshmaydi", async () => {
    h.gate.on = true
    const birinchi = post({ words: words('fona', 6), background: true })
    const ikkinchi = post({ words: words('fonb', 6), background: true })

    // Ikkala so'rovning ikkitadan yo'lagi ham semaforga yetgani kutiladi: shundan
    // keyingina "4 ta emas, 2 ta" degan o'lchov ma'noga ega bo'ladi.
    await waitFor(
      "ikkala fon paketining yo'laklari semaforga yetdi",
      () => ensureCount('fona') === 2 && ensureCount('fonb') === 2,
    )
    await tick()
    await tick()
    // Ikkinchi so'rovning yo'laklari navbatda turadi — 4 ta slotdan 2 tasi interaktiv
    // ish uchun bo'sh qoladi.
    expect(h.counters.inFlight).toBe(2)
    expect(h.counters.maxInFlight).toBe(2)

    const [birRes, ikkiRes] = await drainUntilSettled([birinchi, ikkinchi])
    expect(birRes?.statusCode).toBe(200)
    expect(ikkiRes?.statusCode).toBe(200)
    expect(h.counters.maxInFlight).toBe(2)
    expect(h.synthCalls).toHaveLength(12)
  })

  it("uzoq fon paketi interaktiv so'rovni kutdirib qo'ymaydi", async () => {
    h.gate.on = true
    const bg = post({ words: words('fon', 40), background: true })
    await waitFor('fon 2 ta slotni egalladi', () => h.counters.inFlight === 2)

    const live = post({ words: ['gapbir', 'gapikki'] })
    // Fon paketi hali 38 ta so'zni sintez qilmagan, lekin interaktiv so'rov kutmaydi.
    await waitFor("interaktiv so'zlar sintezga kirdi", () => synthCount('gap') === 2)
    expect(h.counters.inFlight).toBe(4)

    const [bgRes, liveRes] = await drainUntilSettled([bg, live])
    expect(bgRes?.statusCode).toBe(200)
    expect(liveRes?.statusCode).toBe(200)
    expect(h.counters.maxInFlight).toBe(4)
    expect(h.synthCalls).toHaveLength(42)
  })

  it("navbatda interaktiv so'rov fon so'rovidan oldin turadi", async () => {
    h.gate.on = true
    const bg = post({ words: words('fon', 10), background: true })
    await waitFor('fon 2 ta slotni egalladi', () => h.counters.inFlight === 2)

    const live = post({ words: words('gap', 3) })
    await waitFor("4 ta slot ham band bo'ldi", () => h.counters.inFlight === 4)
    // Uchinchi interaktiv so'z navbatda qoldi.
    expect(synthCount('gap')).toBe(2)

    const late = post({ words: words('kech', 4), background: true })
    await tick()
    await tick()
    expect(synthCount('kech')).toBe(0)

    // Bitta slot bo'shaydi: uni navbatdagi interaktiv so'z oladi, keyin kelgan fon
    // so'rovi emas.
    releaseSynth('gap')
    await waitFor("uchinchi interaktiv so'z kirdi", () => synthCount('gap') === 3)
    expect(synthCount('kech')).toBe(0)

    const [bgRes, liveRes, lateRes] = await drainUntilSettled([bg, live, late])
    expect(bgRes?.statusCode).toBe(200)
    expect(liveRes?.statusCode).toBe(200)
    expect(lateRes?.statusCode).toBe(200)
    expect(h.counters.maxInFlight).toBe(4)
    expect(h.synthCalls).toHaveLength(17)
  })

  // Yuqoridagi test interaktiv so'zni navbatga fon so'zlaridan OLDIN qo'yadi, ya'ni
  // oddiy FIFO ham xuddi shu natijani berardi. Bu yerdagi tartib teskari: navbatda
  // avval fon so'zlari turadi, interaktiv so'z esa ulardan KEYIN keladi va shundan
  // so'ng bitta slot bo'shaydi.
  it("keyin kelgan interaktiv so'z navbatda turgan fon so'zlaridan oldinga o'tadi", async () => {
    h.gate.on = true
    // 4 ta slotni interaktiv so'rov to'liq egallaydi.
    const jonli = post({ words: words('jonli', 4) })
    await waitFor("4 ta slot ham band bo'ldi", () => h.counters.inFlight === 4)

    // Fon so'rovi navbatning BOSHIGA tushadi — bo'sh slot yo'q.
    const fon = post({ words: words('fon', 6), background: true })
    await waitFor("fon yo'laklari navbatga turdi", () => ensureCount('fon') === 2)
    expect(synthCount('fon')).toBe(0)

    // Interaktiv so'z navbatga fon so'zlaridan KEYIN keladi.
    const kech = post({ words: words('kech', 1) })
    await waitFor("interaktiv so'z navbatga turdi", () => ensureCount('kech') === 1)
    expect(synthCount('kech')).toBe(0)

    // Aynan bitta slot bo'shaydi. Uni navbatda oldinroq turgan fon so'zi emas,
    // interaktiv so'z oladi.
    releaseSynth('jonli')
    await waitFor(
      "bo'shagan slotni kimdir egalladi",
      () => synthCount('kech') + synthCount('fon') > 0,
    )
    await tick()
    await tick()
    expect(synthCount('kech')).toBe(1)
    expect(synthCount('fon')).toBe(0)

    const [jonliRes, fonRes, kechRes] = await drainUntilSettled([jonli, fon, kech])
    expect(jonliRes?.statusCode).toBe(200)
    expect(fonRes?.statusCode).toBe(200)
    expect(kechRes?.statusCode).toBe(200)
    expect(h.counters.maxInFlight).toBe(4)
    expect(h.synthCalls).toHaveLength(11)
  })
})

describe('GET /api/audio/:file', () => {
  it("mavjud faylni 'audio/mpeg' va uzoq keshlash sarlavhasi bilan beradi", async () => {
    h.files.set('bergan.mp3', h.fakeMp3())
    const res = await app.inject({ method: 'GET', url: '/api/audio/bergan.mp3' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('audio/mpeg')
    expect(res.headers['cache-control']).toBe('public, max-age=31536000')
    // Yalang'och `immutable` EMAS (PLAN §5a).
    expect(res.headers['cache-control']).not.toContain('immutable')
    expect(res.rawPayload.length).toBeGreaterThan(1024)
  })

  it("mavjud bo'lmagan fayl -> 404", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/audio/yoq.mp3' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
  })

  it("'..%2F..%2Fetc%2Fpasswd' papkadan chiqib keta olmaydi -> 404", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/audio/..%2F..%2Fetc%2Fpasswd' })
    expect(res.statusCode).toBe(404)
    expect(res.body).not.toContain('root:')
    expect(res.body).not.toContain('<!doctype html>')
  })

  it("'..%2F..%2Fdist%2Findex.html' ham 404", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/audio/..%2F..%2Fdist%2Findex.html' })
    expect(res.statusCode).toBe(404)
    expect(res.body).not.toContain('<div id="root"></div>')
  })
})

describe('SPA fallback va /api chegarasi', () => {
  it("noma'lum '/api/yoq' -> 404 JSON (index.html EMAS)", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/yoq' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
    expect(res.body).not.toContain('<!doctype html>')
    expect(res.json()).toMatchObject({ error: 'not_found' })
  })

  it("noma'lum '/api/tts/yoq' ham 404 JSON", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tts/yoq' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
  })

  it("so'rov qatoridagi '/api/yoq?x=1' ham JSON 404", async () => {
    const res = await app.inject({ method: 'GET', url: '/api/yoq?x=1' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
  })

  it('SPA marshruti index.html oladi', async () => {
    const res = await app.inject({ method: 'GET', url: '/practice/3' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('<div id="root"></div>')
  })

  it('ildiz ham index.html oladi', async () => {
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('<div id="root"></div>')
  })
})

describe("dist/ bo'lmaganda", () => {
  it("server yiqilmaydi, /api ishlaydi, SPA yo'li 404 beradi", async () => {
    const health = await bare.inject({ method: 'GET', url: '/api/health' })
    expect(health.statusCode).toBe(200)

    const spa = await bare.inject({ method: 'GET', url: '/practice/3' })
    expect(spa.statusCode).toBe(404)

    const api = await bare.inject({ method: 'GET', url: '/api/yoq' })
    expect(api.statusCode).toBe(404)
    expect(api.headers['content-type']).toContain('application/json')
  })
})

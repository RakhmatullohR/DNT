// Fastify serveri — TTS batch, keshlangan MP3 berish, statik `dist/` va SPA fallback.
//
// Ikkita rejim:
//   1. `node server/index.ts` — to'g'ridan-to'g'ri ishga tushirilganda `listen()` qilinadi;
//   2. `import { buildServer } from './index.ts'` — testlar va smoke uchun, listen QILINMAYDI.
// Ikkinchisi shart: aks holda har bir test fayli 8787 portini band qilishga urinardi.
//
// Marshrutlar tartibi MUHIM (PLAN §5a): `/api/*` statik va SPA fallback dan OLDIN
// ro'yxatdan o'tadi, `setNotFoundHandler` esa `/api/` yo'liga index.html QAYTARMAYDI —
// aks holda `fetch` xatosi HTML sahifa bo'lib kelardi va `res.json()` jimgina yiqilardi.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { ensureAudio, ensureAudioDir, readValidCached } from './store.ts'
import { synthesizeWord } from './tts.ts'
import {
  DEFAULT_RATE,
  DEFAULT_VOICE,
  RATES,
  VOICES,
  audioFilename,
  isValidWord,
  synthTextFor,
} from '../shared/filename.ts'

/** Bitta so'rovdagi maksimal so'z soni (PLAN §5a). */
export const MAX_WORDS = 200

/**
 * Bir vaqtning o'zida ketadigan sintez soni — BUTUN JARAYON bo'yicha, so'rovga emas.
 * `edge-tts` norasmiy endpoint — parallellik <= 4 (PLAN §10).
 * Chegara har so'rovda alohida qo'yilganda ikki bir vaqtda kelgan so'rov 4 + 4 = 8 ta
 * socket ochardi, shuning uchun u modul darajasidagi semafor bilan ushlanadi.
 */
export const MAX_CONCURRENCY = 4

/**
 * Fon so'rovi (`background: true`) bir vaqtda egallay oladigan slotlar soni.
 * 4 tadan kamida 2 tasi HAR DOIM interaktiv ish uchun ochiq qoladi — aks holda
 * 400 so'zlik fon paketi ayni o'qilayotgan gapning so'zini navbatda ushlab qolardi
 * va foydalanuvchi gap o'rtasida brauzer zaxirasiga tushardi.
 */
export const MAX_BACKGROUND_CONCURRENCY = 2

/**
 * Bitta so'zning eng ko'p uzunligi. Ingliz tilidagi eng uzun so'z ~45 belgi,
 * shuning uchun bu chegara haqiqiy so'zni rad etmaydi, lekin fayl tizimini
 * cheksiz uzun nomdan himoya qiladi.
 */
export const MAX_WORD_LENGTH = 64

const DEFAULT_PORT = 8787
const HOST = '127.0.0.1'

const thisFile = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(thisFile), '..')

export type BatchBody = {
  words: string[]
  voice?: string
  rate?: number
  /** Fon (oldindan yuklash) paketi — interaktiv so'rovlardan keyin navbatga turadi. */
  background?: boolean
}

/** `cached` — disk keshidan olindi; `synthesized` — shu so'rovda sintez qilindi. */
export type BatchStatus = 'cached' | 'synthesized'

export type BatchOk = {
  word: string
  file: string
  status: BatchStatus
}

export type BatchFailed = { word: string; reason: string }

export type BatchResponse = { ok: BatchOk[]; failed: BatchFailed[] }

export type BuildServerOptions = {
  /** Statik fayllar papkasi. Ko'rsatilmasa — loyiha ildizidagi `dist/`. */
  distDir?: string
}

/**
 * Body validatsiyasi Fastify JSON schema orqali — 400 ni Fastify O'ZI qaytaradi.
 * `voice` va `rate` uchun `enum`: validatsiyasiz `voice: "../../../.config/x"`
 * fayl nomiga tushib, `audio-words/` dan tashqariga yozardi (PLAN §5a).
 */
const batchBodySchema = {
  type: 'object',
  required: ['words'],
  additionalProperties: false,
  properties: {
    words: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_WORDS,
      items: { type: 'string', minLength: 1, maxLength: MAX_WORD_LENGTH },
    },
    voice: { type: 'string', enum: VOICES.slice() },
    rate: { type: 'number', enum: RATES.slice() },
    background: { type: 'boolean' },
  },
}

/** So'rov `/api/...` ga tegishlimi — SPA fallback uni HECH QACHON ushlamasligi kerak. */
function isApiPath(url: string): boolean {
  const pathname = url.split('?')[0] ?? ''
  return pathname === '/api' || pathname.startsWith('/api/')
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---- Global sintez semafori ----
// Modul darajasida turadi, ya'ni BARCHA so'rovlar bitta hovuzni bo'lishadi.
// Slot faqat `synthesizeWord` davomida band bo'ladi: kesh urgan yoki `store.ts`
// dedupiga tushgan chaqiruv hech qanday slot olmaydi.

type SynthWaiter = { background: boolean; resolve: () => void }

let activeSynth = 0
let activeBackgroundSynth = 0
const synthWaiters: SynthWaiter[] = []

function canStartSynth(background: boolean): boolean {
  if (activeSynth >= MAX_CONCURRENCY) return false
  return !background || activeBackgroundSynth < MAX_BACKGROUND_CONCURRENCY
}

function takeSynthSlot(background: boolean): void {
  activeSynth += 1
  if (background) activeBackgroundSynth += 1
}

/**
 * Slot oladi yoki navbatga turadi.
 * Interaktiv chaqiruvchi navbatda fon chaqiruvchilaridan OLDINGA qo'yiladi — shuning
 * uchun uzoq fon paketi ayni kerak bo'lgan so'zni hech qachon kutdirib qo'ymaydi.
 */
function acquireSynthSlot(background: boolean): Promise<void> {
  // Fon chaqiruvchisi har qanday kutayotgandan keyin turadi, interaktiv esa faqat
  // o'zidan oldin kelgan interaktivlardan keyin (o'zaro FIFO).
  const blocked = background
    ? synthWaiters.length > 0
    : synthWaiters.some((waiter) => !waiter.background)
  if (!blocked && canStartSynth(background)) {
    takeSynthSlot(background)
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    const waiter: SynthWaiter = { background, resolve }
    if (background) {
      synthWaiters.push(waiter)
      return
    }
    const firstBackground = synthWaiters.findIndex((other) => other.background)
    if (firstBackground < 0) synthWaiters.push(waiter)
    else synthWaiters.splice(firstBackground, 0, waiter)
  })
}

function releaseSynthSlot(background: boolean): void {
  activeSynth -= 1
  if (background) activeBackgroundSynth -= 1
  for (;;) {
    // Navbat boshidagi fon chaqiruvchisi o'z chegarasiga yetgan bo'lishi mumkin —
    // bunda undan keyingi ishlay oladigani bloklanib qolmaydi.
    const index = synthWaiters.findIndex((waiter) => canStartSynth(waiter.background))
    if (index < 0) return
    const waiter = synthWaiters[index]
    if (waiter === undefined) return
    synthWaiters.splice(index, 1)
    takeSynthSlot(waiter.background)
    waiter.resolve()
  }
}

/** Sintezni global semafor ostida bajaradi. Slot xatoda ham qaytariladi. */
async function withSynthSlot<T>(background: boolean, run: () => Promise<T>): Promise<T> {
  await acquireSynthSlot(background)
  try {
    return await run()
  } finally {
    releaseSynthSlot(background)
  }
}

/**
 * BITTA so'rov ichidagi navbat: `limit` ta "yo'lak" ochiladi, har biri navbatdagi
 * keyingi indeksni oladi. Umumiy parallellikni bu emas, yuqoridagi semafor ushlaydi —
 * bu yerdagi chegara shunchaki navbatni qisqa saqlaydi.
 */
async function runLimited(
  count: number,
  limit: number,
  worker: (index: number) => Promise<void>,
): Promise<void> {
  if (count <= 0) return
  let next = 0
  const laneCount = Math.min(Math.max(1, limit), count)
  const lanes: Array<Promise<void>> = []
  for (let lane = 0; lane < laneCount; lane += 1) {
    lanes.push(
      (async () => {
        for (;;) {
          const index = next
          next += 1
          if (index >= count) return
          await worker(index)
        }
      })(),
    )
  }
  await Promise.all(lanes)
}

type Outcome = { kind: 'ok'; item: BatchOk } | { kind: 'failed'; item: BatchFailed }

/** Bitta fayl uchun ish. Bir so'rovda takrorlangan so'z BITTA marta sintez qilinadi. */
type Task = { word: string; file: string; targets: number[] }

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
    // Fastify defaulti `removeAdditional: true` — noma'lum maydonni JIMGINA olib tashlaydi.
    // Ya'ni `voiceName` deb xato yozilgan kalit 200 qaytarib, standart ovoz bilan
    // fayl yasardi va klient kutgan nom bilan kesh hech qachon urmasdi. Shuning uchun
    // `additionalProperties: false` haqiqatan 400 beradigan qilib sozlanadi.
    ajv: { customOptions: { removeAdditional: false } },
  })

  // Birinchi yozuvda ENOENT bo'lmasligi uchun papka oldindan yaratiladi (PLAN §5a).
  app.addHook('onReady', async () => {
    await ensureAudioDir()
  })

  // ---- /api marshrutlari statik va SPA fallback dan OLDIN ro'yxatdan o'tadi ----

  app.get('/api/health', async () => ({ ok: true }))

  app.post<{ Body: BatchBody }>(
    '/api/tts/batch',
    { schema: { body: batchBodySchema } },
    async (request, reply) => {
      const body = request.body
      const voice = body.voice ?? DEFAULT_VOICE
      const rate = body.rate ?? DEFAULT_RATE
      // Standart qiymat `false`: bayroq yubormaydigan klient bugungi interaktiv
      // xatti-harakatni aynan saqlab qoladi.
      const background = body.background ?? false

      // Schema allaqachon tekshirdi. Bu — ikkinchi to'siq: qiymat FAYL NOMIGA tushadi,
      // shuning uchun bitta tekshiruvga tayanmaymiz (yo'l traversali himoyasi).
      if (!VOICES.includes(voice)) {
        return reply
          .code(400)
          .send({ error: 'invalid_voice', message: `Noma'lum ovoz: ${voice}` })
      }
      if (!RATES.includes(rate)) {
        return reply
          .code(400)
          .send({ error: 'invalid_rate', message: `Ruxsat etilmagan tezlik: ${String(rate)}` })
      }

      const words = body.words
      if (words.length < 1 || words.length > MAX_WORDS) {
        return reply.code(400).send({
          error: 'invalid_words',
          message: `So'zlar ro'yxati 1..${String(MAX_WORDS)} ta element bo'lishi kerak`,
        })
      }

      // Natija joyi kirish tartibida to'ldiriladi — javob so'rovdagi tartibni saqlaydi.
      const outcomes = new Array<Outcome | undefined>(words.length)
      const tasks = new Map<string, Task>()

      for (let i = 0; i < words.length; i += 1) {
        const word = words[i]
        if (word === undefined) continue

        // Yaroqsiz so'z butun so'rovni yiqitmaydi — `failed` ro'yxatiga tushadi.
        if (!isValidWord(word)) {
          outcomes[i] = {
            kind: 'failed',
            item: { word, reason: "yaroqsiz so'z — faqat harflar, ' va - ruxsat etiladi" },
          }
          continue
        }

        let file: string
        try {
          file = audioFilename(word, voice, rate)
        } catch (err) {
          outcomes[i] = { kind: 'failed', item: { word, reason: errorText(err) } }
          continue
        }

        const existing = tasks.get(file)
        if (existing !== undefined) {
          existing.targets.push(i)
          continue
        }
        tasks.set(file, { word, file, targets: [i] })
      }

      const taskList = [...tasks.values()]

      const laneLimit = background ? MAX_BACKGROUND_CONCURRENCY : MAX_CONCURRENCY

      await runLimited(taskList.length, laneLimit, async (index) => {
        const task = taskList[index]
        if (task === undefined) return
        try {
          // `ensureAudio` kesh tekshiruvini, in-flight dedupni va atomik yozishni
          // o'zi bajaradi; bizga faqat natija statusi kerak.
          const result = await ensureAudio(task.file, () =>
            withSynthSlot(background, () =>
              synthesizeWord(synthTextFor(task.word), { voice, rate }),
            ),
          )
          for (const target of task.targets) {
            outcomes[target] = {
              kind: 'ok',
              item: { word: task.word, file: task.file, status: result.status },
            }
          }
        } catch (err) {
          const reason = errorText(err)
          for (const target of task.targets) {
            outcomes[target] = { kind: 'failed', item: { word: task.word, reason } }
          }
        }
      })

      const ok: BatchOk[] = []
      const failed: BatchFailed[] = []
      for (const outcome of outcomes) {
        if (outcome === undefined) continue
        if (outcome.kind === 'ok') ok.push(outcome.item)
        else failed.push(outcome.item)
      }

      const response: BatchResponse = { ok, failed }
      return reply.code(200).send(response)
    },
  )

  app.get<{ Params: { file: string } }>('/api/audio/:file', async (request, reply) => {
    // `path.basename` MAJBURIY: `..%2F..%2Fetc%2Fpasswd` dekodlangach `../../etc/passwd`
    // bo'ladi va usiz `audio-words/` dan tashqariga chiqib ketardi.
    const raw = request.params.file
    const file = path.basename(raw)
    if (file !== raw || file === '' || file === '.' || file === '..') {
      return reply.code(404).send({ error: 'not_found', message: 'Fayl topilmadi' })
    }

    // Fayl `store.readValidCached` orqali o'qiladi: u hajm va MP3 sarlavhasini ham
    // tekshiradi, ya'ni yarim yozilgan yoki 0 baytli fayl "bor" deb berilmaydi —
    // bunday fayl o'chiriladi va keyingi batch so'rovida qayta sintez qilinadi.
    let buf: Buffer | null
    try {
      buf = await readValidCached(file)
    } catch {
      return reply.code(404).send({ error: 'not_found', message: 'Fayl topilmadi' })
    }
    if (buf === null) {
      return reply.code(404).send({ error: 'not_found', message: 'Fayl topilmadi' })
    }

    reply.header('Content-Type', 'audio/mpeg')
    // Yalang'och `immutable` EMAS — fayl qayta sintez qilinishi mumkin (PLAN §5a).
    reply.header('Cache-Control', 'public, max-age=31536000')
    return reply.send(buf)
  })

  // ---- Statik `dist/` ----
  // `dist/` hali qurilmagan bo'lsa (faqat `npm run dev`) server YIQILMASLIGI kerak.
  const distDir = options.distDir ?? path.join(projectRoot, 'dist')
  const hasDist = fs.existsSync(path.join(distDir, 'index.html'))
  if (hasDist) {
    app.register(fastifyStatic, { root: distDir })
  }

  // ---- SPA fallback ----
  app.setNotFoundHandler((request, reply) => {
    // `/api/*` uchun HECH QACHON index.html qaytarilmaydi.
    if (isApiPath(request.url)) {
      return reply.code(404).send({ error: 'not_found', message: `Marshrut yo'q: ${request.url}` })
    }
    if (hasDist) {
      // Kod aniq qo'yiladi: bu yerga `reply.callNotFound()` orqali kelinganda
      // javobda 404 qolib ketishi mumkin edi.
      return reply.code(200).sendFile('index.html')
    }
    return reply
      .code(404)
      .type('text/plain; charset=utf-8')
      .send("dist/ topilmadi — avval `npm run build` bajaring yoki Vite dev serveridan foydalaning")
  })

  return app
}

function resolvePort(): number {
  const raw = process.env['PORT']
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return DEFAULT_PORT
  return parsed
}

/**
 * Serverni ishga tushiradi.
 * Port band bo'lsa JIMGINA davom etmaydi — aniq xabar va `process.exit(1)`.
 * PLAN §1: `concurrently --kill-others-on-fail` aynan shu chiqishga tayanadi, aks holda
 * Vite ishlayverib, ilova sezdirmasdan `speechSynthesis` zaxirasiga tushib qolardi.
 */
export async function startServer(): Promise<FastifyInstance> {
  const port = resolvePort()
  const app = buildServer()
  try {
    await ensureAudioDir()
    await app.listen({ port, host: HOST })
    console.log(`[server] TTS serveri tayyor: http://${HOST}:${String(port)}`)
    return app
  } catch (err) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined
    if (code === 'EADDRINUSE') {
      console.error(
        `[server] XATO: ${HOST}:${String(port)} porti band. Ishlab turgan nusxani to'xtating yoki PORT ni o'zgartiring.`,
      )
    } else {
      console.error('[server] XATO: server ishga tushmadi:', err)
    }
    process.exit(1)
  }
}

// Faqat TO'G'RIDAN-TO'G'RI ishga tushirilganda listen qilinadi.
// Import qilinganda (testlar, smoke) hech qanday port band qilinmaydi.
const entry = process.argv[1]
const isDirectRun = entry !== undefined && path.resolve(entry) === thisFile

if (isDirectRun) {
  await startServer()
}

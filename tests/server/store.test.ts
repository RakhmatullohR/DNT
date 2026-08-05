// `server/store.ts` testlari — tarmoqsiz, `synth` stub bilan.
//
// AUDIO_DIR modul yuklanganda `process.cwd()` dan hisoblanadi. Shuning uchun avval
// vaqtinchalik papkaga o'tamiz, SO'NG modulni dinamik import qilamiz va darhol
// cwd ni tiklaymiz: haqiqiy `audio-words/` papkaga umuman tegilmaydi.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const originalCwd = process.cwd()
const tmpRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dnt-store-')))
process.chdir(tmpRoot)
const store = await import('../../server/store.ts')
process.chdir(originalCwd)

/** MP3 ga o'xshash, yetarlicha katta bufer yasaydi. */
function fakeMp3(size = 2048, tag: 'frame' | 'id3' = 'frame'): Buffer {
  const buf = Buffer.alloc(size, 0x11)
  if (tag === 'id3') {
    buf[0] = 0x49
    buf[1] = 0x44
    buf[2] = 0x33
  } else {
    buf[0] = 0xff
    buf[1] = 0xfb
    buf[2] = 0x90
  }
  return buf
}

/** Qo'lda boshqariladigan Promise — sintezni "osib qo'yish" uchun. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function listAudioDir(): Promise<string[]> {
  const names = await fs.readdir(store.AUDIO_DIR)
  return names.sort()
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Shart bajarilguncha kutadi — `ensureAudio` ichida haqiqiy fayl I/O bor. */
async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now()
  while (!cond()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Shart kutilgan vaqtda bajarilmadi')
    }
    await sleep(1)
  }
}

beforeEach(async () => {
  store.__resetForTests()
  await fs.rm(store.AUDIO_DIR, { recursive: true, force: true })
  await store.ensureAudioDir()
})

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

describe('AUDIO_DIR va ensureAudioDir', () => {
  it('vaqtinchalik papkada ishlaydi, haqiqiy loyiha papkasiga tegmaydi', () => {
    expect(store.AUDIO_DIR).toBe(path.join(tmpRoot, 'audio-words'))
    expect(store.AUDIO_DIR.startsWith(originalCwd + path.sep)).toBe(false)
  })

  it("papka bo'lmasa yaratadi va ikkinchi chaqiruvda xato bermaydi", async () => {
    await fs.rm(store.AUDIO_DIR, { recursive: true, force: true })
    await store.ensureAudioDir()
    await store.ensureAudioDir()
    expect(await listAudioDir()).toEqual([])
  })
})

describe('audioPath', () => {
  it('oddiy nomni AUDIO_DIR ichiga joylaydi', () => {
    expect(store.audioPath('the.mp3')).toBe(path.join(store.AUDIO_DIR, 'the.mp3'))
    expect(store.audioPath("don't.mp3")).toBe(path.join(store.AUDIO_DIR, "don't.mp3"))
  })

  it("yo'l bo'ylab yuqoriga chiqishga urinishni rad etadi", () => {
    expect(() => store.audioPath('../../etc/passwd')).toThrow()
    expect(() => store.audioPath('../secret.mp3')).toThrow()
    expect(() => store.audioPath('/etc/passwd')).toThrow()
    expect(() => store.audioPath('sub/dir.mp3')).toThrow()
    expect(() => store.audioPath('..\\win.mp3')).toThrow()
    expect(() => store.audioPath('..')).toThrow()
    expect(() => store.audioPath('')).toThrow()
    expect(() => store.audioPath('bad\0name.mp3')).toThrow()
  })

  it('rad etilmagan har qanday natija AUDIO_DIR ning bevosita ichida qoladi', () => {
    const full = store.audioPath('us@caps.mp3')
    expect(path.dirname(full)).toBe(store.AUDIO_DIR)
  })

  it('readValidCached ham xavfsiz nom talab qiladi', async () => {
    await expect(store.readValidCached('../../etc/passwd')).rejects.toThrow()
  })
})

describe('looksLikeMp3', () => {
  it('ID3 tegini tan oladi', () => {
    expect(store.looksLikeMp3(fakeMp3(1500, 'id3'))).toBe(true)
  })

  it('MPEG frame sync ni tan oladi', () => {
    expect(store.looksLikeMp3(new Uint8Array([0xff, 0xfb, 0x90, 0x00]))).toBe(true)
    expect(store.looksLikeMp3(new Uint8Array([0xff, 0xe3, 0x00, 0x00]))).toBe(true)
  })

  it('boshqa baytlarni va juda qisqa buferni rad etadi', () => {
    expect(store.looksLikeMp3(Buffer.from('salom dunyo', 'utf8'))).toBe(false)
    expect(store.looksLikeMp3(new Uint8Array([0xff, 0x00, 0x00]))).toBe(false)
    expect(store.looksLikeMp3(new Uint8Array([0xff, 0xfb]))).toBe(false)
    expect(store.looksLikeMp3(new Uint8Array([]))).toBe(false)
  })
})

describe("readValidCached — TOCTOU yo'q", () => {
  it("fayl yo'q bo'lsa null qaytaradi", async () => {
    expect(await store.readValidCached('yoq.mp3')).toBeNull()
  })

  it('yaroqli faylni buffer sifatida qaytaradi', async () => {
    const buf = fakeMp3(4096)
    await fs.writeFile(store.audioPath('quick.mp3'), buf)
    const got = await store.readValidCached('quick.mp3')
    expect(got).not.toBeNull()
    expect(got?.length).toBe(4096)
  })

  it("0 baytli faylni rad etadi va o'chiradi", async () => {
    await fs.writeFile(store.audioPath('quick.mp3'), Buffer.alloc(0))
    expect(await store.readValidCached('quick.mp3')).toBeNull()
    expect(await listAudioDir()).toEqual([])
  })

  it("yarim yozilgan (1024 baytdan kichik) faylni rad etadi va o'chiradi", async () => {
    await fs.writeFile(store.audioPath('quick.mp3'), fakeMp3(512))
    expect(await store.readValidCached('quick.mp3')).toBeNull()
    expect(await listAudioDir()).toEqual([])
  })

  it("MP3 sarlavhasiz katta faylni rad etadi va o'chiradi", async () => {
    await fs.writeFile(store.audioPath('quick.mp3'), Buffer.alloc(4096, 0x41))
    expect(await store.readValidCached('quick.mp3')).toBeNull()
    expect(await listAudioDir()).toEqual([])
  })
})

describe('writeAtomic', () => {
  it('faylni yozadi va .tmp fayl QOLDIRMAYDI', async () => {
    await store.writeAtomic('quick.mp3', fakeMp3(3000))
    expect(await listAudioDir()).toEqual(['quick.mp3'])
    const onDisk = await fs.readFile(store.audioPath('quick.mp3'))
    expect(onDisk.length).toBe(3000)
  })

  it("papka bo'lmasa ham ishlaydi (ENOENT bermaydi)", async () => {
    await fs.rm(store.AUDIO_DIR, { recursive: true, force: true })
    await store.writeAtomic('quick.mp3', fakeMp3(2048))
    expect(await listAudioDir()).toEqual(['quick.mp3'])
  })

  it('yaroqsiz buferda xato tashlaydi va .tmp ni tozalaydi', async () => {
    await expect(store.writeAtomic('quick.mp3', Buffer.alloc(4096, 0x41))).rejects.toThrow()
    expect(await listAudioDir()).toEqual([])
  })

  it('juda kichik buferda xato tashlaydi va hech narsa qoldirmaydi', async () => {
    await expect(store.writeAtomic('quick.mp3', fakeMp3(100))).rejects.toThrow()
    expect(await listAudioDir()).toEqual([])
  })

  it('ketma-ket yozuvlar noyob .tmp nomlaridan foydalanadi va qoldiq qoldirmaydi', async () => {
    await Promise.all([
      store.writeAtomic('a.mp3', fakeMp3(2048)),
      store.writeAtomic('b.mp3', fakeMp3(2048)),
      store.writeAtomic('c.mp3', fakeMp3(2048)),
    ])
    expect(await listAudioDir()).toEqual(['a.mp3', 'b.mp3', 'c.mp3'])
  })
})

describe('ensureAudio', () => {
  it('birinchi chaqiruvda sintez qiladi, ikkinchisida keshdan oladi', async () => {
    let calls = 0
    const synth = async (): Promise<Buffer> => {
      calls += 1
      return fakeMp3(2048)
    }

    const first = await store.ensureAudio('quick.mp3', synth)
    expect(first.status).toBe('synthesized')

    const second = await store.ensureAudio('quick.mp3', synth)
    expect(second.status).toBe('cached')

    expect(calls).toBe(1)
    expect(await listAudioDir()).toEqual(['quick.mp3'])
    expect(store.inFlightCount()).toBe(0)
  })

  it("bir xil so'z ikki parallel chaqiruvda — synth AYNAN 1 marta chaqiriladi", async () => {
    let calls = 0
    const gate = deferred()
    const synth = async (): Promise<Buffer> => {
      calls += 1
      await gate.promise
      return fakeMp3(2048)
    }

    const a = store.ensureAudio('quick.mp3', synth)
    const b = store.ensureAudio('quick.mp3', synth)
    // Birinchisi in-flight ga tushdi (u gate da turibdi), ikkinchisi kesh tekshiruvini
    // tugatib o'sha Promise ga ulanguncha kutamiz.
    await waitFor(() => store.inFlightCount() === 1)
    await sleep(25)
    gate.resolve()

    const [ra, rb] = await Promise.all([a, b])
    expect(calls).toBe(1)
    expect(ra.status).toBe('synthesized')
    expect(rb.status).toBe('synthesized')
    expect(store.inFlightCount()).toBe(0)
    expect(await listAudioDir()).toEqual(['quick.mp3'])
  })

  it("sakkiz parallel chaqiruvda ham bitta sintez bo'ladi", async () => {
    let calls = 0
    const synth = async (): Promise<Buffer> => {
      calls += 1
      await sleep(5)
      return fakeMp3(2048)
    }

    const results = await Promise.all(
      Array.from({ length: 8 }, () => store.ensureAudio('quick.mp3', synth)),
    )
    expect(calls).toBe(1)
    expect(results.every((r) => r.status === 'synthesized')).toBe(true)
    expect(store.inFlightCount()).toBe(0)
  })

  it("turli so'zlar alohida dedup qilinadi", async () => {
    const seen: string[] = []
    const make = (word: string) => async (): Promise<Buffer> => {
      seen.push(word)
      await sleep(5)
      return fakeMp3(2048)
    }

    await Promise.all([
      store.ensureAudio('the.mp3', make('the')),
      store.ensureAudio('cat.mp3', make('cat')),
      store.ensureAudio('the.mp3', make('the')),
    ])
    expect(seen.sort()).toEqual(['cat', 'the'])
    expect(await listAudioDir()).toEqual(['cat.mp3', 'the.mp3'])
  })

  it("inFlightCount sintez davomida 1 bo'ladi, tugagach 0 ga qaytadi", async () => {
    const gate = deferred()
    const synth = async (): Promise<Buffer> => {
      await gate.promise
      return fakeMp3(2048)
    }

    const task = store.ensureAudio('quick.mp3', synth)
    await waitFor(() => store.inFlightCount() === 1)
    expect(store.inFlightCount()).toBe(1)

    gate.resolve()
    await task
    expect(store.inFlightCount()).toBe(0)
  })

  it("0 baytli fayl kesh urishi hisoblanmaydi — qayta sintez bo'ladi", async () => {
    await fs.writeFile(store.audioPath('quick.mp3'), Buffer.alloc(0))

    let calls = 0
    const res = await store.ensureAudio('quick.mp3', async () => {
      calls += 1
      return fakeMp3(2048)
    })

    expect(res.status).toBe('synthesized')
    expect(calls).toBe(1)
    const onDisk = await fs.readFile(store.audioPath('quick.mp3'))
    expect(onDisk.length).toBe(2048)
  })

  it("yarim yozilgan MP3 kesh urishi hisoblanmaydi — qayta sintez bo'ladi", async () => {
    await fs.writeFile(store.audioPath('quick.mp3'), fakeMp3(300))

    let calls = 0
    const res = await store.ensureAudio('quick.mp3', async () => {
      calls += 1
      return fakeMp3(4096, 'id3')
    })

    expect(res.status).toBe('synthesized')
    expect(calls).toBe(1)
    expect((await fs.readFile(store.audioPath('quick.mp3'))).length).toBe(4096)
  })

  it('qolib ketgan .tmp fayl kesh sifatida ishlatilmaydi', async () => {
    // Uzilgan yozuvdan qolgan chala fayl: nomi `.tmp` bilan tugaydi.
    await fs.writeFile(path.join(store.AUDIO_DIR, 'quick.mp3.777.1.tmp'), fakeMp3(300))

    let calls = 0
    const res = await store.ensureAudio('quick.mp3', async () => {
      calls += 1
      return fakeMp3(2048)
    })

    expect(res.status).toBe('synthesized')
    expect(calls).toBe(1)
    expect(await store.readValidCached('quick.mp3')).not.toBeNull()
  })

  it('MP3 sarlavhasiz bufer — xato tashlaydi, fayl yozilmaydi', async () => {
    await expect(
      store.ensureAudio('quick.mp3', async () => Buffer.alloc(4096, 0x41)),
    ).rejects.toThrow()
    expect(await listAudioDir()).toEqual([])
    expect(store.inFlightCount()).toBe(0)
  })

  it('1024 baytdan kichik bufer — xato tashlaydi (retry tts.ts da)', async () => {
    await expect(store.ensureAudio('quick.mp3', async () => fakeMp3(512))).rejects.toThrow()
    expect(await listAudioDir()).toEqual([])
    expect(store.inFlightCount()).toBe(0)
  })

  it('synth xato tashlasa in-flight yozuvi tozalanadi va qayta urinish mumkin', async () => {
    await expect(
      store.ensureAudio('quick.mp3', async () => {
        throw new Error('tarmoq uzildi')
      }),
    ).rejects.toThrow('tarmoq uzildi')
    expect(store.inFlightCount()).toBe(0)

    const res = await store.ensureAudio('quick.mp3', async () => fakeMp3(2048))
    expect(res.status).toBe('synthesized')
    expect(await listAudioDir()).toEqual(['quick.mp3'])
  })

  it('muvaffaqiyatsiz parallel sintezda ikkala chaqiruvchi ham xato oladi', async () => {
    let calls = 0
    const synth = async (): Promise<Buffer> => {
      calls += 1
      await sleep(5)
      throw new Error('sintez muvaffaqiyatsiz')
    }

    const a = store.ensureAudio('quick.mp3', synth)
    const b = store.ensureAudio('quick.mp3', synth)
    await expect(a).rejects.toThrow('sintez muvaffaqiyatsiz')
    await expect(b).rejects.toThrow('sintez muvaffaqiyatsiz')
    expect(calls).toBe(1)
    expect(store.inFlightCount()).toBe(0)
    expect(await listAudioDir()).toEqual([])
  })
})

describe('__resetForTests', () => {
  it('in-flight Map ni tozalaydi', async () => {
    const gate = deferred()
    const task = store.ensureAudio('quick.mp3', async () => {
      await gate.promise
      return fakeMp3(2048)
    })
    await waitFor(() => store.inFlightCount() === 1)

    store.__resetForTests()
    expect(store.inFlightCount()).toBe(0)

    gate.resolve()
    await task
  })
})

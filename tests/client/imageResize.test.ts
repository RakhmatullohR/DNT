// `src/media/imageResize.ts` — izoh rasmini siqish.
//
// `client` proyekti (`audioManager.test.ts` bilan bir xil): NODE muhitida
// ishlaydi va brauzer API'lari `vi.stubGlobal` bilan qo'yiladi. Sof qaror
// mantiqi (o'lcham hisobi, nom, "kattasini saqlama" qoidasi) shu yerda
// sinaladi; haqiqiy WebP kodlash brauzerning ishi.

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_IMAGE_DIMENSION,
  fitWithin,
  prepareImage,
  toWebpName,
} from '../../src/media/imageResize.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fitWithin', () => {
  it('chegaradan kichik rasmni KATTALASHTIRMAYDI', () => {
    expect(fitWithin(800, 600, MAX_IMAGE_DIMENSION)).toEqual({ width: 800, height: 600 })
  })

  it('aynan chegarada tegmaydi', () => {
    expect(fitWithin(1600, 900, 1600)).toEqual({ width: 1600, height: 900 })
  })

  it('nisbatni saqlab kichraytiradi', () => {
    expect(fitWithin(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 })
    expect(fitWithin(1000, 4000, 1600)).toEqual({ width: 400, height: 1600 })
  })

  it("juda cho'zilgan rasmda qisqa tomon 0 ga tushmaydi", () => {
    expect(fitWithin(10_000, 3, 1600).height).toBe(1)
  })
})

describe('toWebpName', () => {
  it('kengaytmani almashtiradi', () => {
    expect(toWebpName('skrinshot.png')).toBe('skrinshot.webp')
  })

  it("kengaytmasiz nomga qo'shadi", () => {
    expect(toWebpName('skrinshot')).toBe('skrinshot.webp')
  })

  it("nuqta bilan boshlanadigan nom kengaytma deb qaralmaydi", () => {
    expect(toWebpName('.yashirin')).toBe('.yashirin.webp')
  })

  it("bo'sh nomga zaxira nom beriladi", () => {
    expect(toWebpName('   ')).toBe('rasm.webp')
  })
})

describe('prepareImage', () => {
  const file = new Blob(['x'.repeat(5000)], { type: 'image/png' })

  it("brauzer API'lari yo'q muhitda ASL faylni qaytaradi", async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    vi.stubGlobal('OffscreenCanvas', undefined)

    expect(await prepareImage(file, 'a.png')).toEqual({ blob: file, name: 'a.png' })
  })

  it('siqish yiqilsa ASL faylga qaytadi', async () => {
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('buzuq rasm')))
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext(): null {
          return null
        }
      },
    )

    expect(await prepareImage(file, 'a.png')).toEqual({ blob: file, name: 'a.png' })
  })

  it('natija asl fayldan katta bo\'lsa ASL fayl qoladi', async () => {
    stubCanvas(new Blob(['y'.repeat(9000)], { type: 'image/webp' }))

    expect(await prepareImage(file, 'a.png')).toEqual({ blob: file, name: 'a.png' })
  })

  it('WebP chiqmasa (brauzer PNG bergan) ASL fayl qoladi', async () => {
    stubCanvas(new Blob(['kichik'], { type: 'image/png' }))

    expect(await prepareImage(file, 'a.png')).toEqual({ blob: file, name: 'a.png' })
  })

  it('kichikroq WebP chiqsa uni va yangi nomni qaytaradi', async () => {
    const small = new Blob(['kichik'], { type: 'image/webp' })
    stubCanvas(small)

    expect(await prepareImage(file, 'skrinshot.png')).toEqual({
      blob: small,
      name: 'skrinshot.webp',
    })
  })

  it("bitmap har holatda YOPILADI — xotira oqmasin", async () => {
    const close = vi.fn()
    stubCanvas(new Blob(['kichik'], { type: 'image/webp' }), close)

    await prepareImage(file, 'a.png')

    expect(close).toHaveBeenCalledOnce()
  })
})

/** `createImageBitmap` + `OffscreenCanvas` ni berilgan natija bilan taqlid qiladi. */
function stubCanvas(result: Blob, close: () => void = () => {}): void {
  vi.stubGlobal('createImageBitmap', () =>
    Promise.resolve({ width: 3200, height: 1600, close }),
  )
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      width: number
      height: number
      constructor(width: number, height: number) {
        this.width = width
        this.height = height
      }
      getContext(): { drawImage: () => void } {
        return { drawImage: () => {} }
      }
      convertToBlob(): Promise<Blob> {
        return Promise.resolve(result)
      }
    },
  )
}

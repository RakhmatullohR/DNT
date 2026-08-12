// Izohga qo'yilgan rasmni SAQLASHDAN OLDIN kichraytiradi.
//
// ⭐ NEGA UMUMAN KERAK: izoh rasmlari dars `.json` zaxirasiga base64 bo'lib
// kiradi (≈ +33% hajm), zaxira esa Drive/Telegram'ga yuboriladigan YAGONA fayl
// bo'lishi kerak. Siqishsiz 20 ta telefon skrinshoti faylni ~30 MB ga
// chiqarardi; 1600px/WebP dan keyin o'sha fayl ~4 MB atrofida qoladi.
//
// ⚠️ Bu YO'QOTISHLI qayta kodlash — asl fayl saqlanmaydi. Matn skrinshotlari
// uchun 1600px va 0.82 sifat o'qishni saqlaydi; bu ataylab qilingan kelishuv.
//
// Fayl `src/core/` da EMAS: u yerdagi qoida "sof mantiq, DOM yo'q", bu modul
// esa `createImageBitmap`/`OffscreenCanvas` ga tayanadi (`src/audio/` bilan bir
// xil ajratish).

/** Eng katta tomon shu pikseldan oshmaydi. */
export const MAX_IMAGE_DIMENSION = 1600

/** WebP sifati: matnli skrinshot o'qilishini saqlaydigan eng past qiymat. */
export const WEBP_QUALITY = 0.82

const WEBP_TYPE = 'image/webp'

/**
 * Nisbatni saqlab, eng katta tomonni `max` ga keltiradi.
 *
 * Kichikroq rasm KATTALASHTIRILMAYDI: piksel qo'shish sifat bermaydi, faqat
 * faylni shishirardi.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max || longest <= 0) return { width, height }

  const ratio = max / longest
  return {
    // Kamida 1px: juda cho'zilgan rasmda qisqa tomon 0 ga yumaloqlanib,
    // `OffscreenCanvas` ni yaroqsiz o'lchamga tushirardi.
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  }
}

/** `skrinshot.png` → `skrinshot.webp`; nuqtasiz nomga qo'shib qo'yiladi. */
export function toWebpName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') return 'rasm.webp'

  const dot = trimmed.lastIndexOf('.')
  // Nuqta boshida bo'lsa (`.gitignore`) u kengaytma emas — nomning o'zi.
  return dot > 0 ? `${trimmed.slice(0, dot)}.webp` : `${trimmed}.webp`
}

export type PreparedImage = { blob: Blob; name: string }

/**
 * Rasmni siqadi. HECH QACHON tashlamaydi.
 *
 * Muvaffaqiyatsizlikning har qanday turi — brauzerda `OffscreenCanvas` yo'q,
 * WebP qo'llab-quvvatlanmaydi, fayl buzuq — ASL faylga qaytadi. Sabab: siqish
 * qulaylik, izohni saqlash esa asosiy ish; ikkinchisi birinchisining
 * nosozligidan yiqilmasligi kerak. Yaroqsiz rasmni keyingi qatlam
 * (`store/notes.ts` dagi tur/hajm tekshiruvi) baribir rad etadi.
 *
 * Natija asl fayldan KATTA chiqsa ham asli qaytadi: kichik PNG (masalan
 * bir rangli diagramma) WebP'da kattalashishi mumkin.
 */
export async function prepareImage(file: Blob, name: string): Promise<PreparedImage> {
  const original: PreparedImage = { blob: file, name }

  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    return original
  }

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const size = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_DIMENSION)

    const canvas = new OffscreenCanvas(size.width, size.height)
    const context = canvas.getContext('2d')
    if (context === null) return original
    context.drawImage(bitmap, 0, 0, size.width, size.height)

    const blob = await canvas.convertToBlob({ type: WEBP_TYPE, quality: WEBP_QUALITY })
    // Brauzer WebP'ni qo'llab-quvvatlamasa `convertToBlob` jimgina PNG beradi —
    // o'shanda "siqildi" deb nom o'zgartirish yolg'on bo'lardi.
    if (blob.type !== WEBP_TYPE) return original
    if (blob.size >= file.size) return original

    return { blob, name: toWebpName(name) }
  } catch {
    return original
  } finally {
    bitmap?.close()
  }
}

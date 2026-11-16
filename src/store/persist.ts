// Doimiy saqlash (persistent storage) so'rovi va disk kvotasi holati
// (`docs/stats-longterm.md` §3.1 va §3.3 ning kod ko'rinishi).
//
// **§3.1 dagi asosiy fakt:** `navigator.storage.persist()` origin'ning
// BUTUN storage bucket'ini himoya qiladi — IndexedDB ham, `localStorage`
// ham birga. Ya'ni bu chaqiruv IndexedDB migratsiyasini KUTMAYDI: hozirgi
// `localStorage` ma'lumotini DARHOL himoya qiladi. Bu — IndexedDB'ga o'tish
// sababi EMAS (hujjatning §3.1 dagi tuzatishi) — u ikkala saqlash usulini
// ham bir xil himoya qiladi, shuning uchun uni bugunoq chaqirish hujjatdagi
// eng arzon va eng tez foydali tavsiya.
//
// **§3.3 dagi xatar:** `persist()` rad etilishi mumkin (brauzer foydalanuvchi
// bilan aloqa evristikasiga qaraydi; Firefox esa foydalanuvchidan so'raydi).
// Shuning uchun bu modul yiqilmaydi — qo'llab-quvvatlanmagan yoki rad etilgan
// holatni ochiq qaytaradi, ilova esa doimiy saqlashsiz ham ishlashda davom etadi.

export type PersistState = 'granted' | 'denied' | 'unsupported'

/**
 * `storageEstimate()` ning natijasi — `usage`/`quota` va oldindan hisoblangan
 * `ratio`, yoki ma'lumot yo'q bo'lsa `null`.
 *
 * ⚠️ `StorageEstimate` DEB ATALMAYDI, garchi tarixan shunday atalgan bo'lsa ham:
 * `lib.dom` da `StorageEstimate` interfeysi ALLAQACHON bor va pastdagi
 * `navigator.storage.estimate()` aynan o'shani qaytaradi. Bir modul ichida
 * bitta nom ikkita ma'noda — o'quvchi uchun tuzoq.
 */
export type PersistEstimate = { usage: number; quota: number; ratio: number } | null

/**
 * `navigator.storage` va kerakli metodlar MAVJUDLIGINI tekshiradi.
 *
 * Tekshiruvning O'ZI ham `SecurityError` tashlashi mumkin (masalan cookie'lari
 * o'chirilgan brauzer yoki `file://` sahifasi) — shuning uchun u `try` ichida
 * (`stats.ts` dagi `getStore()` bilan bir xil himoya uslubi). Tashlash bu yerda
 * HAQIQATAN "brauzer qo'llab-quvvatlamaydi" degani.
 *
 * ALOHIDA funksiya bo'lishining sababi §3.3 da: mavjudlik tekshiruvining
 * tashlashi (`'unsupported'`) va API CHAQIRUVINING tashlashi (`'denied'`)
 * bir-biridan farq qilishi SHART — pastdagi izohga qarang.
 */
function hasStorageMethods(...methods: Array<'persist' | 'persisted' | 'estimate'>): boolean {
  try {
    if (typeof navigator === 'undefined') return false
    if (!navigator.storage) return false
    return methods.every((name) => typeof navigator.storage[name] === 'function')
  } catch {
    return false
  }
}

/**
 * Doimiylikni SO'RAYDI.
 *
 * Avval `navigator.storage.persisted()` bilan hozirgi holat tekshiriladi:
 * agar u allaqachon `true` bo'lsa, `persist()` QAYTA chaqirilmaydi — ba'zi
 * brauzerlar `persist()` ni har chaqirilganda foydalanuvchiga so'rov
 * ko'rsatishi mumkin, holbuki natija allaqachon ma'lum.
 *
 * ⚠️ CHAQIRUV tashlasa `'denied'` qaytariladi, `'unsupported'` EMAS. Ilgari
 * ikkalasi bitta `try` da edi va `persist()` ning `SecurityError` i ham
 * "qo'llab-quvvatlanmaydi" bo'lib ko'rinardi. §3.3 ning butun maqsadi — jimgina
 * yo'qolish o'rniga TO'G'RI ko'rinadigan holat: "brauzeringiz qo'llab-quvvatlamaydi"
 * deb ko'rsatilgan foydalanuvchi eksport odatini shakllantirish o'rniga "menda
 * imkoni yo'q" deb qo'yadi, holbuki API bor va qayta so'rash mumkin.
 */
export async function requestPersistence(): Promise<PersistState> {
  if (!hasStorageMethods('persisted', 'persist')) return 'unsupported'

  try {
    const already = await navigator.storage.persisted()
    if (already) return 'granted'

    const granted = await navigator.storage.persist()
    return granted ? 'granted' : 'denied'
  } catch {
    // §3.3: API bor, lekin so'rov o'tmadi (rad etildi yoki `SecurityError`).
    // Ilova yiqilmaydi, holat esa "rad etildi" — chunki aynan shunday bo'ldi.
    return 'denied'
  }
}

/**
 * Doimiylik HOLATINI o'qiydi, SO'RAMAYDI (`navigator.storage.persisted()`).
 * Statistika ekranida holatni ko'rsatish uchun (§3.3: "jimgina yo'qolish
 * o'rniga ko'rinadigan holat").
 *
 * `requestPersistence` bilan bir xil bo'linish: API yo'q -> `'unsupported'`,
 * chaqiruv tashladi -> `'denied'`.
 */
export async function persistenceState(): Promise<PersistState> {
  if (!hasStorageMethods('persisted')) return 'unsupported'

  try {
    const persisted = await navigator.storage.persisted()
    return persisted ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}

/**
 * Disk kvotasi holati (§3.3: Statistika ekranida ko'rsatish uchun —
 * muntazam eksportni odatga aylantirish shu ko'rsatkichga tayanadi).
 */
export async function storageEstimate(): Promise<PersistEstimate> {
  if (!hasStorageMethods('estimate')) return null

  try {
    const { usage, quota } = await navigator.storage.estimate()
    if (typeof usage !== 'number' || typeof quota !== 'number') return null

    return { usage, quota, ratio: quota > 0 ? usage / quota : 0 }
  } catch {
    return null
  }
}

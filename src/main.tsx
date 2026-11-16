// Ilova kirish nuqtasi.
//
// DIQQAT (PLAN §5b): `StrictMode` effektlarni ikki marta ishga tushiradi.
// `AudioContext` shuning uchun `AudioManager.ts` da MODUL DARAJASIDAGI singleton
// qilib olingan va foydalanuvchi harakati tinglovchilari ham o'sha modulda
// bir marta o'rnatiladi. Shu sababli bu yerda audio umuman import qilinmaydi
// va hech qanday audio effekti yozilmaydi — ekranlar kerak bo'lganda o'zi chaqiradi.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { App } from './App.tsx'
import { requestPersistence } from './store/persist.ts'
import { initStats } from './store/stats.ts'

// docs/stats-longterm.md §3.1: `persist()` origin'ning butun storage
// bucket'ini (IndexedDB HAM, `localStorage` HAM) darhol himoya qiladi —
// hech qanday migratsiyani kutmaydi. Natija KUTILMAYDI: render bloklanmasin.
// Rad javobi (`.catch`) ilovani TO'XTATMAYDI — `persist()` §3.3 ga ko'ra rad
// etilishi mumkin, bu kutilgan holat, xatolik emas.
void requestPersistence().catch(() => {})

// ⭐ Statistika omborining BOOT chaqiruvi (§9, §4.4): ulanish -> v1
// migratsiyasi -> 180 kunlik retention qisqartirishi.
//
// ⚠️ Bu chaqiruv ilovadagi YAGONASI EMAS va shunday bo'lishi SHART ham emas:
// `initStats()` IDEMPOTENT — og'ir ishni (migratsiya, qisqartirish) bir marta
// bajaradi, keyingilari esa keshlangan ulanishdan holatni qaytaradi. Uchala
// ekran (Home, Stats, Results) uni o'z yuklashida QAYTA chaqiradi va natijasini
// KUTADI: migratsiya tugamasdan o'qilgan ombor bo'sh ko'rinardi va ekran
// "hali statistika yo'q" deb yolg'on aytardi. Qaytgan `StatsAvailability` o'sha
// yerda bannerni ham hal qiladi (§8.4d).
//
// Nega u holda bu yerda ham chaqiriladi: boot'da boshlangan migratsiya birinchi
// ekran o'z o'qishiga yetgunicha ilgarilab ketadi, ya'ni ekranlar odatda
// allaqachon tayyor omborni kutadi.
//
// Natija KUTILMAYDI va render BLOKLANMAYDI: ekranlar o'z ma'lumotini o'zi
// asinxron yuklaydi. `initStats()` ning o'zi TASHLAMAYDI (u xatolarni holat
// qiymatiga aylantiradi), `.catch` esa kutilmagan holat uchun oxirgi to'siq.
void initStats().catch(() => {})

const container = document.getElementById('root')
if (!container) {
  throw new Error("#root elementi topilmadi — index.html buzilgan bo'lishi mumkin")
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

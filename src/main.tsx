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

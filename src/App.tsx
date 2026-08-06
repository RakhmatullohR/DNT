// Marshrutlar (PLAN §1). Barcha ekranlar bitta `Layout` ichida —
// navigatsiya va server ogohlantirishi hamma joyda bir xil ko'rinsin.
//
// Noma'lum yo'l endi jimgina `/` ga qaytarilmaydi — `NotFound` sababni
// tushuntiradi va chiqish yo'llarini beradi, xuddi Practice/Results dagi
// "topilmadi" holatlari kabi (izchillik uchun; `replace` yo'qligi "orqaga"
// tugmasini ham buzmaydi).

import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout.tsx'
import { Home } from './screens/Home.tsx'
import { Import } from './screens/Import.tsx'
import { NotFound } from './screens/NotFound.tsx'
import { Practice } from './screens/Practice.tsx'
import { Results } from './screens/Results.tsx'
import { Stats } from './screens/Stats.tsx'

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/import" element={<Import />} />
        <Route path="/practice/:lessonId" element={<Practice />} />
        <Route path="/results/:sessionId" element={<Results />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

// Sahifa sarlavhasi (`document.title`) marshrut bilan birga o'zgarsin.
//
// Muammo: `react-router` sahifani qayta yuklamaydi, ya'ni `index.html` dagi
// sarlavha beshta marshrutda ham o'zgarmay qolardi. Buning ikkita oqibati bor
// edi: (1) brauzer yorlig'i, tarixi va "Recently closed" ro'yxatida beshta
// sahifa bir xil ko'rinardi; (2) ekran o'quvchilar SPA da marshrut
// o'zgarganini birinchi navbatda AYNAN sarlavha orqali sezadi — u o'zgarmasa
// navigatsiya "jim" bo'lib qolardi.
//
// Qo'shimcha yordamchi bermaydi (masalan `dnt — ...` prefiksini majburlash):
// har ekran o'z sarlavhasini to'liq o'zi beradi, chunki mashq ekranida dars
// nomi eng oldinda turishi kerak — yorliq tor bo'lganda brauzer oxirini
// kesadi, boshini emas.

import { useEffect } from 'react'

/** Ilova nomi — sarlavha oxirida, yorliq torayganda birinchi bo'lib kesiladi. */
const SUFFIX = 'dnt'

/**
 * `document.title` ni o'rnatadi va komponent uzilganda TIKLAMAYDI.
 *
 * Ataylab tiklanmaydi: marshrut o'zgarganda eski ekran uzilishi yangi ekran
 * effektidan KEYIN emas, oldin ham bo'lishi mumkin edi va tiklash yangi
 * sarlavhani ustidan yozib yuborardi. Har ekran o'zinikini o'rnatgani uchun
 * tiklashning keragi ham yo'q.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title === '' ? SUFFIX : `${title} — ${SUFFIX}`
  }, [title])
}

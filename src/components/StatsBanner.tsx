// Statistika ombori ishlamayotgani haqidagi banner (docs/stats-longterm.md §8.4d).
//
// ⚠️ NEGA UMUMAN BANNER KERAK. IndexedDB hamma joyda bir xil ishlamaydi:
// Firefox private rejimida baza seans bilan tozalanadi, WebKit skript
// yozadigan omborni ma'lum sharoitlarda cheklaydi, `file://` sahifasida esa u
// umuman yo'q. §8.4d bu holatlar uchun "ochiq banner, JIM ISHLAMASLIK EMAS"
// deb qat'iy talab qo'yadi: aks holda foydalanuvchi oylab mashq qilib,
// statistikasi hech qachon yozilmayotganini bilmasdi.
//
// ⚠️ IKKI MATN — IKKI BOSHQA MASLAHAT, va ularni birlashtirish xato bo'lardi:
//
//   `unavailable` — brauzer omborni bermayapti. Foydalanuvchi qila oladigan
//                   hech narsa yo'q, shuning uchun matn HOLATNI aytadi va
//                   mashqni to'xtatishga undamaydi.
//   `blocked`     — boshqa TAB eski sxema versiyasini ushlab turibdi (§8.4b).
//                   Bu VAQTINCHALIK va TUZATILADIGAN holat, va uni "bu
//                   brauzerda statistika saqlanmaydi" deb ko'rsatish
//                   foydalanuvchini bir bosishlik yechimdan mahrum qilardi.
//
// Uchta ekran (Bosh sahifa, Statistika, Natijalar) uchun BITTA komponent:
// matn nusxa ko'chirilsa, u ekranlar orasida jimgina ayrilib ketardi.

import type { StatsAvailability } from '../store/stats.ts'

export function StatsBanner({ availability }: { availability: StatsAvailability }) {
  if (availability === 'ready') return null

  const blocked = availability === 'blocked'

  return (
    <div
      role="status"
      // Sariq — `Stats.tsx` dagi boshqa ogohlantirishlar bilan bir xil rang
      // oilasi: bu xato emas, "diqqat qiling" darajasidagi holat.
      className="rounded-control border border-[#3a3520] bg-[#15130d] p-4"
    >
      <p className="font-mono text-[13px] leading-relaxed text-[#f2cf8a]">
        {blocked
          ? "Statistika ombori bloklangan: shu ilova ochiq turgan boshqa tab eski versiyani ushlab turibdi. O'sha tabni yoping va sahifani yangilang — undan keyin yozuv o'z-o'zidan tiklanadi."
          : "Bu brauzerda statistika saqlanmaydi: IndexedDB mavjud emas yoki o'chirilgan (private rejim, `file://` sahifasi yoki sayt ma'lumotlari taqiqlangan). Mashq ishlaydi, lekin natijalar yozilmaydi va bu sahifadagi raqamlar bo'sh qoladi."}
      </p>
    </div>
  )
}

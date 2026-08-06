// Noma'lum marshrut uchun ekran — `App.tsx` dagi `*` yo'li.
//
// Ilgari bu holat `<Navigate to="/" replace />` bilan jimgina yashirilardi:
// tashqi havoladan kelgan yoki manzilni xato yozgan foydalanuvchi hech qanday
// tushuntirishsiz bosh sahifaga otilib ketardi, `replace` tufayli "orqaga"
// tugmasi ham ishlamasdi. Shakli Practice.tsx va Results.tsx dagi NotFound
// bilan ATAYIN BIR XIL — ilovada uchta "topilmadi" holati bitta qolipda
// ko'rinsin (sabab tushuntiriladi, chiqish yo'llari beriladi).

import { Link } from 'react-router-dom'
import { useDocumentTitle } from '../hooks/useDocumentTitle.ts'

const PANEL = 'rounded-panel border border-[#1d2833] bg-[#0e141c]'
const LABEL = 'font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[#7d8b9c]'
/**
 * `Link` tugma ko'rinishida — `Button.tsx` faqat `<button>` chiqaradi.
 *
 * Fokus halqasi offseti `#0e141c`, `--color-base` emas: bu havolalar faqat
 * panelning USTIDA turadi (Practice.tsx dagi NotFound bilan bir xil sabab).
 */
const LINK_BTN_BASE =
  'inline-flex h-10 items-center justify-center rounded-control border px-4 font-mono text-[13px] font-medium transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-[#5ee6c1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e141c] focus-visible:outline-none'
const LINK_BTN_PRIMARY = `${LINK_BTN_BASE} border-transparent bg-[#5ee6c1] text-[#04231c] hover:bg-[#7cf0d3]`
const LINK_BTN_GHOST = `${LINK_BTN_BASE} border-[#22303d] text-[#c6d3de] hover:border-[#334556] hover:bg-[#131b23] hover:text-[#e6edf3]`

export function NotFound() {
  useDocumentTitle('Topilmadi')

  return (
    // `Layout.tsx` allaqachon <main>, markazlash va yon bo'shliqni beradi —
    // bu yerda faqat matnni torroq ustunga siqish qoladi.
    <div className="mx-auto w-full max-w-3xl">
      <div className={`${PANEL} p-8 text-center sm:p-12`}>
        <div className={LABEL}>sahifa topilmadi</div>
        <h1 className="mt-4 font-mono text-[21px] font-semibold text-[#e6edf3]">
          Bunday sahifa yo&apos;q
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-[#8b98a9]">
          Manzil noto&apos;g&apos;ri yoki sahifa ko&apos;chirilgan bo&apos;lishi mumkin.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/" className={LINK_BTN_PRIMARY}>
            Darslar
          </Link>
          <Link to="/stats" className={LINK_BTN_GHOST}>
            Statistika
          </Link>
        </div>
      </div>
    </div>
  )
}

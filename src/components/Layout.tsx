// Barcha ekranlar uchun umumiy ramka: yuqori navigatsiya, server ogohlantirishi
// va markazlashgan konteyner. Bolalar `children` orqali emas, `<Outlet />` orqali
// keladi — marshrutlar `App.tsx` da ichma-ich e'lon qilingan.
//
// Uslub: qorong'i asos (--color-base), ingichka (1px) chegaralar, gradientsiz,
// butunlay monospace tipografiya. Yagona yorqin rang — na'na aksent
// (--color-accent), u faqat faol holat va asosiy harakatga ajratilgan.
// Rang va radius tokenlari `src/index.css` dagi `@theme` blokida — shu
// yerda xom hex takrorlanmasin va boshqa komponentlar bilan bir manbadan
// oziqlansin.

import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigationType } from 'react-router-dom'
import { ServerBanner } from './ServerBanner.tsx'

/** `short` — tor ekranda ko'rsatiladigan qisqartma; usiz uchta yorliq 320px ga sig'maydi. */
type NavItem = { to: string; label: string; short?: string; end?: boolean }

const NAV_ITEMS: readonly NavItem[] = [
  // `end: true` bo'lmasa `/` har qanday yo'lda faol ko'rinardi.
  // `short: 'Dars'` ataylab eski `short: 'Bosh'` bilan BIR XIL uzunlikda (4
  // harf) — 320px ga sig'ishi allaqachon tekshirilgan (yuqoridagi izoh), shu
  // bois to'liq `label`ni o'zgartirib, `short` uzunligini saqlab qoldik.
  { to: '/', label: 'Darslar', short: 'Dars', end: true },
  { to: '/import', label: 'Import' },
  { to: '/stats', label: 'Statistika', short: 'Stat' },
]

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    'relative flex h-14 items-center font-mono text-[13px]',
    'transition-colors duration-150 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    'focus-visible:ring-offset-2 focus-visible:ring-offset-base rounded-xs',
    isActive ? 'text-accent' : 'text-muted hover:text-[#dce6ee]',
  ].join(' ')
}

export function Layout() {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()

  // Marshrut o'zgarganda tepaga qaytarish. Shart `POP` NI CHIQARIB TASHLASH
  // orqali yozilgan, `PUSH` ni sanash orqali emas — chunki uchinchi tur ham bor:
  //   `POP`     — ilk yuklash va "orqaga/oldinga". TEGMAYMIZ: brauzerning o'z
  //               skroll tiklashi biznikidan yaxshiroq.
  //   `PUSH`    — oddiy havola (masalan Stats dagi seans qatori).
  //   `REPLACE` — `useTypingSession` seans yakunida shu bilan `/results/:id` ga
  //               o'tadi (`navigate(..., { replace: true })`). Agar faqat `PUSH`
  //               sanalsa, telefonda pastga surilgan mashq ekranidan kelgan
  //               foydalanuvchi Natijalar sahifasining O'RTASIGA tushardi.
  useEffect(() => {
    if (navigationType !== 'POP') {
      window.scrollTo(0, 0)
    }
  }, [pathname, navigationType])

  return (
    <div className="flex min-h-full flex-col bg-base text-text">
      <a
        href="#asosiy"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-accent focus:px-3 focus:py-2 focus:font-mono focus:text-[13px] focus:text-[#04231c]"
      >
        Asosiy qismga o&apos;tish
      </a>

      <header className="sticky top-0 z-20 border-b border-border bg-base/93 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 sm:gap-6 sm:px-5">
          <Link
            to="/"
            className="flex h-14 items-center gap-2 rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base"
          >
            {/* `-translate-y-px` — 16px shrift 13px navigatsiya yorliqlari bilan
                bir xil `h-14 items-center` markazida turadi, lekin ikki xil
                o'lcham markazga tekislanganda BAZA CHIZIG'I (baseline) avtomatik
                mos kelmaydi: kattaroq shrift markazdan bir oz pastroqqa tushadi.
                O'lchov bilan tasdiqlangan (ekran skrinshotidan piksel tahlili):
                sozlashsiz "dnt" bazasi navigatsiya bazasidan ~1.3px pastda edi. */}
            <span className="-translate-y-px font-mono text-[16px] font-medium tracking-[0.22em] text-text">
              dnt
            </span>
            {/* Yonib-o'chuvchi kursor — yozuv mashqining o'zi haqidagi yagona ishora.
                `motion-reduce:animate-none` — foydalanuvchi harakatni kamaytirishni
                so'ragan bo'lsa, cheksiz pulslash to'xtaydi (xuddi Home.tsx dagi
                progress-bar va Practice.tsx dagi indikator kabi). */}
            <span
              aria-hidden="true"
              className="inline-block h-3.75 w-1.75 animate-pulse bg-accent motion-reduce:animate-none"
            />
            <span className="ml-1 hidden font-mono text-[11px] text-muted sm:inline">
              eshit va yoz
            </span>
          </Link>

          <nav aria-label="Asosiy navigatsiya" className="flex items-center gap-4 sm:gap-6">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={navClass}
                aria-label={item.short ? item.label : undefined}
              >
                {({ isActive }) => (
                  <>
                    {item.short ? (
                      <>
                        <span className="sm:hidden">{item.short}</span>
                        <span className="hidden sm:inline">{item.label}</span>
                      </>
                    ) : (
                      item.label
                    )}
                    {/* Faol yo'lni sarlavha chizig'i ustidagi qisqa chiziq bilan belgilaymiz. */}
                    <span
                      aria-hidden="true"
                      className={[
                        'absolute right-0 bottom-0 left-0 h-0.5 transition-colors duration-200 ease-out',
                        isActive ? 'bg-accent' : 'bg-transparent',
                      ].join(' ')}
                    />
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <ServerBanner />

      {/* `tabIndex={-1}` — skip-link (`href="#asosiy"`) faqat skroll qilib,
          fokusni ishonchli ko'chirmasdi: elementga oldindan `tabIndex` bo'lishi
          shart, aks holda `<main>` dasturiy fokus uchun yaroqsiz. `-1` hech
          narsani AVTOMATIK fokuslamaydi (Tab bilan aylanishda ham qatnashmaydi),
          faqat skip-link bosilganda brauzer uni fokuslay olishini ta'minlaydi. */}
      {/* `max-w-6xl` (1152px) UCH JOYDA bir xil bo'lishi SHART: shu `<main>`,
          yuqoridagi sticky header ichki qatori va `ServerBanner` ichki qatori.
          Ular alohida DOM shoxlarida turadi, ya'ni faqat bittasi o'zgartirilsa
          hech narsa buzilmaydi — logotip va navigatsiya sahifa kontentidan
          ichkarida qolib ketadi, xolos. Kenglik: 1152 − 40 (sm:px-5) = 1112px
          kontent. */}
      <main
        id="asosiy"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-20 sm:px-5"
      >
        <Outlet />
      </main>
    </div>
  )
}

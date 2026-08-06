// Barcha ekranlar uchun umumiy ramka: yuqori navigatsiya, server ogohlantirishi
// va markazlashgan konteyner. Bolalar `children` orqali emas, `<Outlet />` orqali
// keladi — marshrutlar `App.tsx` da ichma-ich e'lon qilingan.
//
// Uslub: qorong'i asos (#0b0f14), ingichka (1px) chegaralar, gradientsiz,
// butunlay monospace tipografiya. Yagona yorqin rang — na'na aksent (#5ee6c1),
// u faqat faol holat va asosiy harakatga ajratilgan.

import { Link, NavLink, Outlet } from 'react-router-dom'
import { ServerBanner } from './ServerBanner.tsx'

/** `short` — tor ekranda ko'rsatiladigan qisqartma; usiz uchta yorliq 320px ga sig'maydi. */
type NavItem = { to: string; label: string; short?: string; end?: boolean }

const NAV_ITEMS: readonly NavItem[] = [
  // `end: true` bo'lmasa `/` har qanday yo'lda faol ko'rinardi.
  { to: '/', label: 'Bosh sahifa', short: 'Bosh', end: true },
  { to: '/import', label: 'Import' },
  { to: '/stats', label: 'Statistika', short: 'Stat' },
]

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    'relative flex h-14 items-center font-mono text-[13px]',
    'transition-colors duration-150 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5ee6c1]',
    'focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f14] rounded-xs',
    isActive ? 'text-[#5ee6c1]' : 'text-[#7d8fa1] hover:text-[#dce6ee]',
  ].join(' ')
}

export function Layout() {
  return (
    <div className="flex min-h-full flex-col bg-[#0b0f14] text-[#e6edf3]">
      <a
        href="#asosiy"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-sm focus:bg-[#5ee6c1] focus:px-3 focus:py-2 focus:font-mono focus:text-[13px] focus:text-[#04231c]"
      >
        Asosiy qismga o&apos;tish
      </a>

      <header className="sticky top-0 z-20 border-b border-[#161f29] bg-[#0b0f14ee] backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 sm:gap-6 sm:px-5">
          <Link
            to="/"
            className="flex h-14 items-center gap-2 rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5ee6c1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b0f14]"
          >
            <span className="font-mono text-[16px] font-medium tracking-[0.22em] text-[#e6edf3]">
              dnt
            </span>
            {/* Yonib-o'chuvchi kursor — yozuv mashqining o'zi haqidagi yagona ishora. */}
            <span
              aria-hidden="true"
              className="inline-block h-3.75 w-1.75 animate-pulse bg-[#5ee6c1]"
            />
            <span className="ml-1 hidden font-mono text-[11px] text-[#7d8fa1] sm:inline">
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
                        isActive ? 'bg-[#5ee6c1]' : 'bg-transparent',
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

      <main id="asosiy" className="mx-auto w-full max-w-4xl flex-1 px-4 pt-8 pb-20 sm:px-5">
        <Outlet />
      </main>
    </div>
  )
}

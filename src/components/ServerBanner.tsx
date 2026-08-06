// TTS serveri holati (PLAN §1).
//
// Nima uchun bu komponent umuman bor: `concurrently` bayroqsiz ishga tushirilganda
// 8787-port band bo'lsa Fastify o'ladi, Vite esa ishlayveradi. Ilova jimgina
// `speechSynthesis` zaxirasiga tushib qoladi — ya'ni zaxira ishga tushish xatosini
// YASHIRADI. Shu banner o'sha jimlikni buzadi.
//
// Polling qoidasi: dastlabki tekshiruv + cheklangan sonli qayta urinish.
// Cheksiz `setInterval` emas — server o'chirilgan bo'lsa, uni har 5 soniyada
// abadiy urib turishning ma'nosi yo'q. Urinishlar tugagach qo'lda tugma qoladi.

import { useEffect, useState } from 'react'
import { serverAvailable } from '../audio/ttsClient.ts'
import { Button } from './Button.tsx'

/** Qayta tekshiruvlar orasidagi tanaffus. */
const RETRY_MS = 5_000

/** Jami tekshiruvlar soni (birinchisi bilan birga) — keyin polling to'xtaydi. */
const MAX_CHECKS = 6

type Status = 'checking' | 'ok' | 'down'

export function ServerBanner() {
  const [status, setStatus] = useState<Status>('checking')
  /** Avtomatik urinishlar tugadimi — shunda qo'lda tekshirish tugmasi ko'rinadi. */
  const [exhausted, setExhausted] = useState(false)
  /** Qo'lda "Qayta tekshirish" bosilganda effektni qaytadan ishga tushiradi. */
  const [attemptId, setAttemptId] = useState(0)
  /** Kirish animatsiyasi uchun: birinchi kadrdan keyin yoqiladi. */
  const [shown, setShown] = useState(false)

  useEffect(() => {
    // StrictMode effektni ikki marta ishga tushiradi — `cancelled` va
    // `clearTimeout` tufayli ikkinchi nusxa holatni yozmaydi va taymer qolmaydi.
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const check = async (attempt: number): Promise<void> => {
      const ok = await serverAvailable()
      if (cancelled) return

      if (ok) {
        setStatus('ok')
        setExhausted(false)
        return
      }

      setStatus('down')
      if (attempt + 1 < MAX_CHECKS) {
        timer = setTimeout(() => {
          void check(attempt + 1)
        }, RETRY_MS)
      } else {
        setExhausted(true)
      }
    }

    void check(0)

    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [attemptId])

  useEffect(() => {
    if (status !== 'down') {
      setShown(false)
      return
    }
    // Bir kadr keyin — CSS o'tishi boshlang'ich holatni ko'rib ulgursin.
    const id = requestAnimationFrame(() => {
      setShown(true)
    })
    return () => {
      cancelAnimationFrame(id)
    }
  }, [status])

  // `checking` holatida hech narsa ko'rsatilmaydi: server bor bo'lsa
  // sahifa ochilishida ogohlantirish lip etib o'tib ketmasligi kerak.
  if (status !== 'down') return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'border-b border-[#3a2c12] bg-[#151007]',
        'transition-all duration-300 ease-out',
        shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0',
      ].join(' ')}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-5">
        <span
          aria-hidden="true"
          className={[
            'h-1.5 w-1.5 shrink-0 rounded-full bg-[#f2b344]',
            exhausted ? '' : 'animate-pulse',
          ].join(' ')}
        />
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[#f2b344]">
          ogohlantirish
        </span>
        <p className="font-mono text-[13px] text-[#e0cfa8]">
          TTS server ulanmadi — brauzer ovozi (zaxira) ishlatiladi
        </p>

        <span className="ml-auto flex items-center gap-3">
          {exhausted ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setExhausted(false)
                setAttemptId((n) => n + 1)
              }}
            >
              Qayta tekshirish
            </Button>
          ) : (
            <span className="font-mono text-[11px] text-[#8a7c5b]">
              qayta ulanish tekshirilmoqda...
            </span>
          )}
        </span>
      </div>
    </div>
  )
}

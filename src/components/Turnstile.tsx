import { useEffect, useRef, useState } from 'react'

// Cloudflare Turnstile, явный рендер. Скрипт грузится только на странице отправки в live-режиме.
type TurnstileApi = {
  render(el: HTMLElement, opts: Record<string, unknown>): string
  reset(id: string): void
  remove(id: string): void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      scriptPromise = null
      reject(new Error('turnstile script failed'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

type Props = {
  siteKey: string
  action: string
  onToken: (token: string | null) => void
  /** Меняй значение, чтобы получить новый токен (они одноразовые). */
  resetSignal: number
}

export function Turnstile({ siteKey, action, onToken, resetSignal }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          action,
          language: 'ru',
          theme: 'light',
          callback: (t: string) => {
            setError(null)
            onToken(t)
          },
          'expired-callback': () => onToken(null),
          'error-callback': () => {
            onToken(null)
            setError('Проверка «я не робот» не прошла.')
          },
        })
      })
      .catch(() => setError('Не получилось загрузить проверку «я не робот». Проверь интернет или блокировщик рекламы.'))
    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
      widgetId.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, action])

  useEffect(() => {
    if (resetSignal > 0 && widgetId.current && window.turnstile) {
      onToken(null)
      window.turnstile.reset(widgetId.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal])

  return (
    <div>
      <div ref={ref} className="turnstile-slot" />
      {error && (
        <div className="actions">
          <p className="field-error" role="alert">
            {error}
          </p>
          {widgetId.current && (
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                setError(null)
                if (widgetId.current) window.turnstile?.reset(widgetId.current)
              }}
            >
              Повторить проверку
            </button>
          )}
        </div>
      )}
    </div>
  )
}

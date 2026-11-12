import { useEffect, useState } from 'react'

type Props = {
  src: string
  alt: string
  width?: number | null
  height?: number | null
  /** Вызывается, если ссылка перестала работать (истёк срок). Должен вернуть новую ссылку. */
  onExpired?: () => Promise<string | null>
}

export function ExhibitImage({ src, alt, width, height, onExpired }: Props) {
  const [current, setCurrent] = useState(src)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [refreshed, setRefreshed] = useState(false)

  useEffect(() => {
    setCurrent(src)
    setState('loading')
    setRefreshed(false)
  }, [src])

  async function handleError() {
    if (onExpired && !refreshed) {
      setRefreshed(true)
      try {
        const next = await onExpired()
        if (next) {
          setCurrent(next)
          return
        }
      } catch {
        /* покажем ошибку */
      }
    }
    setState('error')
  }

  if (state === 'error') {
    return (
      <div className="exhibit-image-fallback" role="img" aria-label={alt}>
        <p>Не получилось загрузить фотографию.</p>
        <button
          type="button"
          className="btn btn-small"
          onClick={async () => {
            const next = onExpired ? await onExpired().catch(() => null) : null
            setRefreshed(false)
            setState('loading')
            setCurrent(next ?? src)
          }}
        >
          Попробовать ещё раз
        </button>
      </div>
    )
  }

  return (
    <img
      src={current}
      alt={alt}
      width={width ?? undefined}
      height={height ?? undefined}
      decoding="async"
      onLoad={() => setState('ok')}
      onError={handleError}
      style={state === 'loading' ? { opacity: 0.001 } : undefined}
      className={state === 'ok' ? 'appear' : undefined}
    />
  )
}

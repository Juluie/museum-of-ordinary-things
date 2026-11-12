import { useState } from 'react'
import { shareLink } from '../lib/share.ts'

export function ShareButton({ url, title }: { url: string; title: string }) {
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null)
  const [busy, setBusy] = useState(false)

  async function onClick() {
    setBusy(true)
    setMessage(null)
    const r = await shareLink(url, title)
    setBusy(false)
    if (r === 'copied') setMessage({ text: 'Ссылка скопирована.', kind: 'ok' })
    else if (r === 'shared' || r === 'cancelled') setMessage(null)
    else setMessage({ text: `Не получилось скопировать. Ссылка: ${r.failed}`, kind: 'error' })
  }

  return (
    <>
      <button type="button" className="btn" onClick={onClick} disabled={busy}>
        Поделиться
      </button>
      <span className="exhibit-hint" role="status" aria-live="polite" data-kind={message?.kind}>
        {message?.text}
      </span>
    </>
  )
}

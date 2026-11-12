import { useEffect } from 'react'

const SITE = 'Музей обычных вещей'

export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    document.title = title ? `${title} — ${SITE}` : SITE
  }, [title])
}

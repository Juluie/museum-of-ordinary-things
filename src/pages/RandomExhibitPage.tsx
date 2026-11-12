import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useApp } from '../lib/app-context.ts'
import { useDocumentTitle } from '../lib/use-document-title.ts'
import { EmptyCollection, ErrorState, LoadingState } from '../components/States.tsx'

/** /exhibit — выбирает случайный экспонат на сервере и переходит на его постоянный адрес. */
export function RandomExhibitPage() {
  const { api } = useApp()
  const navigate = useNavigate()
  const [state, setState] = useState<'loading' | 'empty' | { error: string }>('loading')
  useDocumentTitle('Экспонат')

  const load = useCallback(async () => {
    setState('loading')
    try {
      const { exhibit, hasOthers } = await api.getRandom()
      if (!exhibit) return setState('empty')
      navigate(`/exhibit/${exhibit.id}`, { replace: true, state: { exhibit, hasOthers } })
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : 'Что-то пошло не так.' })
    }
  }, [api, navigate])

  useEffect(() => {
    void load()
  }, [load])

  if (state === 'loading') return <LoadingState text="Ищем экспонат…" />
  if (state === 'empty') return <EmptyCollection />
  return <ErrorState message={state.error} onRetry={load} />
}

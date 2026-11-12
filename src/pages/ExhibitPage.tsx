import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ExhibitView } from '../components/ExhibitView.tsx'
import { ShareButton } from '../components/ShareButton.tsx'
import { ErrorState, LoadingState, NotFoundExhibit } from '../components/States.tsx'
import { useApp } from '../lib/app-context.ts'
import { useDocumentTitle } from '../lib/use-document-title.ts'
import type { Exhibit } from '../types/exhibit.ts'

type State = { kind: 'loading' } | { kind: 'ok'; exhibit: Exhibit } | { kind: 'not_found' } | { kind: 'error'; message: string }

export function ExhibitPage() {
  const { id = '' } = useParams()
  const { api } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const passed = (location.state as { exhibit?: Exhibit } | null)?.exhibit

  const [state, setState] = useState<State>(passed?.id === id ? { kind: 'ok', exhibit: passed } : { kind: 'loading' })
  const [nextState, setNextState] = useState<'idle' | 'loading' | 'only-one' | { error: string }>('idle')

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const exhibit = await api.getById(id)
      setState(exhibit ? { kind: 'ok', exhibit } : { kind: 'not_found' })
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Что-то пошло не так.' })
    }
  }, [api, id])

  useEffect(() => {
    setNextState('idle')
    if (passed?.id === id) setState({ kind: 'ok', exhibit: passed })
    else void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useDocumentTitle(state.kind === 'ok' ? state.exhibit.title : state.kind === 'not_found' ? 'Экспонат не найден' : 'Экспонат')

  async function goNext() {
    if (state.kind !== 'ok') return
    setNextState('loading')
    try {
      const { exhibit } = await api.getRandom(state.exhibit.id)
      if (!exhibit) return setNextState('only-one')
      if (exhibit.id === state.exhibit.id) return setNextState('only-one')
      navigate(`/exhibit/${exhibit.id}`, { state: { exhibit } })
    } catch (e) {
      setNextState({ error: e instanceof Error ? e.message : 'Не получилось загрузить следующую вещь.' })
    }
  }

  async function refreshImage(): Promise<string | null> {
    const fresh = await api.getById(id)
    if (!fresh) {
      setState({ kind: 'not_found' })
      return null
    }
    return fresh.imageUrl
  }

  if (state.kind === 'loading') return <LoadingState text="Достаём экспонат из хранилища…" />
  if (state.kind === 'not_found') return <NotFoundExhibit />
  if (state.kind === 'error') return <ErrorState message={state.message} onRetry={load} />

  const url = `${window.location.origin}/exhibit/${state.exhibit.id}`

  return (
    <ExhibitView key={state.exhibit.id} exhibit={state.exhibit} onImageExpired={api.mode === 'live' ? refreshImage : undefined}>
      <div className="exhibit-actions">
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={goNext}
            disabled={nextState === 'loading'}
            aria-busy={nextState === 'loading'}
          >
            {nextState === 'loading' ? 'Ищем…' : 'Следующая вещь'}
          </button>
          <ShareButton url={url} title={state.exhibit.title} />
        </div>
        <p className="exhibit-hint" role="status" aria-live="polite">
          {nextState === 'only-one' && 'Пока в музее только эта вещь. Можно добавить свою.'}
          {typeof nextState === 'object' && nextState.error}
        </p>
        <p>
          <Link to="/submit">Добавить свою вещь</Link>
        </p>
      </div>
    </ExhibitView>
  )
}

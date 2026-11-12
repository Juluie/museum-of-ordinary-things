import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useApp } from '../lib/app-context.ts'
import { createDemoAdminApi } from '../lib/api/demo.ts'
import { createLiveAdminApi } from '../lib/api/admin-live.ts'
import { ApiError, type AdminAction, type AdminApi, type AdminList } from '../lib/api/types.ts'
import { formatDate, formatNumber } from '../lib/format.ts'
import { getSupabase } from '../lib/supabase-client.ts'
import { useDocumentTitle } from '../lib/use-document-title.ts'
import type { AdminExhibit, ExhibitStatus } from '../types/exhibit.ts'

const TABS: { status: ExhibitStatus; label: string }[] = [
  { status: 'pending', label: 'На проверке' },
  { status: 'approved', label: 'Опубликовано' },
  { status: 'rejected', label: 'Отклонено' },
]

let demoAdmin: AdminApi | null = null

export function AdminPage() {
  const { config } = useApp()
  const navigate = useNavigate()
  const [api, setApi] = useState<AdminApi | null>(null)
  const [signOut, setSignOut] = useState<(() => Promise<void>) | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)
  useDocumentTitle('Модерация')

  useEffect(() => {
    if (config.mode === 'demo') {
      demoAdmin ??= createDemoAdminApi()
      setApi(demoAdmin)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const client = await getSupabase(config.supabaseUrl, config.publishableKey)
        const { data } = await client.auth.getSession()
        if (!data.session) return navigate('/admin/login', { replace: true })
        const live = createLiveAdminApi(client, config.supabaseUrl, config.publishableKey)
        await live.whoami()
        if (cancelled) return
        setApi(live)
        setSignOut(() => async () => {
          await client.auth.signOut()
          navigate('/admin/login', { replace: true })
        })
      } catch (e) {
        if (e instanceof ApiError && e.kind === 'unauthorized') return navigate('/admin/login', { replace: true })
        setAuthError(e instanceof ApiError && e.kind === 'forbidden' ? 'У этого аккаунта нет прав хранителя.' : 'Не получилось проверить вход.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [config, navigate])

  if (authError) {
    return (
      <div className="center-state">
        <h1>Нет доступа</h1>
        <p className="notice notice-error" role="alert">
          {authError}
        </p>
        <Link to="/admin/login" className="btn">
          Войти другим аккаунтом
        </Link>
      </div>
    )
  }
  if (!api) {
    return (
      <div className="center-state">
        <h1 className="visually-hidden">Модерация</h1>
        <p className="loading" role="status">
          Проверяем вход…
        </p>
      </div>
    )
  }
  return <Moderation api={api} onSignOut={signOut} />
}

function Moderation({ api, onSignOut }: { api: AdminApi; onSignOut: (() => Promise<void>) | null }) {
  const [tab, setTab] = useState<ExhibitStatus>('pending')
  const [page, setPage] = useState(1)
  const [list, setList] = useState<AdminList | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    setList(null)
    try {
      setList(await api.list(tab, page))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Не получилось загрузить список.')
    }
  }, [api, tab, page])

  useEffect(() => {
    void load()
  }, [load])

  async function act(action: AdminAction, item: AdminExhibit) {
    setMessage(null)
    try {
      await api.act(action, item.id)
      const done: Record<AdminAction, string> = {
        approve: 'опубликован',
        reject: 'отклонён, фото удалено',
        unpublish: 'снят с публикации',
        delete: 'удалён навсегда',
      }
      setMessage({ text: `«${item.title}» — ${done[action]}.`, kind: 'ok' })
      await load()
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Операция не выполнена.', kind: 'error' })
    }
  }

  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1

  return (
    <section className="admin" aria-labelledby="admin-title">
      {api.mode === 'demo' && (
        <p className="notice notice-demo" role="note">
          <strong>Незащищённый макет.</strong> Это демонстрация интерфейса модерации с вымышленными данными. Изменения
          хранятся только в этой вкладке и пропадут после перезагрузки.
        </p>
      )}
      <div className="admin-head">
        <h1 id="admin-title">Модерация</h1>
        {onSignOut && (
          <button type="button" className="btn btn-small" onClick={() => void onSignOut()}>
            Выйти
          </button>
        )}
      </div>

      <div className="tabs" role="tablist" aria-label="Статус экспонатов">
        {TABS.map((t) => (
          <button
            key={t.status}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === t.status}
            aria-controls="admin-panel"
            onClick={() => {
              setTab(t.status)
              setPage(1)
              setMessage(null)
            }}
          >
            {t.label}
            {tab === t.status && list ? ` · ${list.total}` : ''}
          </button>
        ))}
      </div>

      <p role="status" aria-live="polite" className={message ? `notice notice-${message.kind === 'ok' ? 'success' : 'error'}` : undefined}>
        {message?.text}
      </p>

      <div id="admin-panel" role="tabpanel">
        {loadError && (
          <div className="center-state">
            <p className="notice notice-error" role="alert">
              {loadError}
            </p>
            <button type="button" className="btn" onClick={() => void load()}>
              Попробовать ещё раз
            </button>
          </div>
        )}
        {!list && !loadError && (
          <p className="loading" role="status">
            Загружаем…
          </p>
        )}
        {list && list.items.length === 0 && <p className="muted">Здесь пока пусто.</p>}
        {list && list.items.length > 0 && (
          <ul className="admin-list">
            {list.items.map((item) => (
              <AdminItem key={item.id} item={item} onAct={act} />
            ))}
          </ul>
        )}
        {list && pages > 1 && (
          <nav className="pager" aria-label="Страницы">
            <button type="button" className="btn btn-small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Назад
            </button>
            <span className="muted">
              Страница {page} из {pages}
            </span>
            <button type="button" className="btn btn-small" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Дальше
            </button>
          </nav>
        )}
      </div>
    </section>
  )
}

function AdminItem({ item, onAct }: { item: AdminExhibit; onAct: (a: AdminAction, i: AdminExhibit) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function run(a: AdminAction) {
    setBusy(true)
    await onAct(a, item)
    setBusy(false)
    setConfirming(false)
  }

  return (
    <li className="admin-item">
      <div className="admin-item-photo">
        {item.imageUrl ? <img src={item.imageUrl} alt={item.imageAlt} loading="lazy" /> : <span>Фото удалено</span>}
      </div>
      <div className="admin-item-body">
        <div className="admin-meta">
          {item.number != null && <span>№ {formatNumber(item.number)}</span>}
          <span>Отправлено: {formatDate(item.createdAt)}</span>
          {item.approvedAt && <span>Опубликовано: {formatDate(item.approvedAt)}</span>}
        </div>
        <h2>{item.title}</h2>
        <p className="admin-story">{item.story}</p>
        <dl className="exhibit-meta">
          <dt>Описание фото</dt>
          <dd>{item.imageAlt}</dd>
          <dt>Подпись</dt>
          <dd>{item.authorName ?? '—'}</dd>
          <dt>Хранится</dt>
          <dd>{item.keptSince ?? '—'}</dd>
        </dl>

        {confirming ? (
          <div className="confirm" role="alertdialog" aria-label="Подтверждение удаления">
            <span>Удалить запись и фото навсегда? Это нельзя отменить.</span>
            <button type="button" className="btn btn-small btn-danger" onClick={() => void run('delete')} disabled={busy}>
              Да, удалить
            </button>
            <button type="button" className="btn btn-small" onClick={() => setConfirming(false)} disabled={busy}>
              Отмена
            </button>
          </div>
        ) : (
          <div className="actions">
            {item.status === 'pending' && (
              <>
                <button type="button" className="btn btn-small btn-primary" onClick={() => void run('approve')} disabled={busy || !item.imageUrl}>
                  Одобрить
                </button>
                <button type="button" className="btn btn-small" onClick={() => void run('reject')} disabled={busy}>
                  Отклонить
                </button>
              </>
            )}
            {item.status === 'approved' && (
              <>
                <Link className="btn btn-small btn-quiet" to={`/exhibit/${item.id}`}>
                  Открыть на сайте
                </Link>
                <button type="button" className="btn btn-small" onClick={() => void run('unpublish')} disabled={busy}>
                  Снять с публикации
                </button>
              </>
            )}
            <button type="button" className="btn btn-small btn-danger" onClick={() => setConfirming(true)} disabled={busy}>
              Удалить навсегда
            </button>
            {busy && (
              <span className="loading" role="status">
                Выполняем…
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

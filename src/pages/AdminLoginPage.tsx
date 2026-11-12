import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useApp } from '../lib/app-context.ts'
import { createLiveAdminApi } from '../lib/api/admin-live.ts'
import { ApiError } from '../lib/api/types.ts'
import { getSupabase } from '../lib/supabase-client.ts'
import { useDocumentTitle } from '../lib/use-document-title.ts'

export function AdminLoginPage() {
  const { config } = useApp()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useDocumentTitle('Вход для хранителя')

  if (config.mode === 'demo') {
    return (
      <div className="login">
        <h1>Вход для хранителя</h1>
        <p className="notice notice-demo">
          В демо-версии входа нет. Можно посмотреть <strong>незащищённый макет</strong> админки с вымышленными данными.
        </p>
        <Link to="/admin" className="btn">
          Открыть макет админки
        </Link>
      </div>
    )
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (config.mode !== 'live') return
    setBusy(true)
    setError(null)
    try {
      const client = await getSupabase(config.supabaseUrl, config.publishableKey)
      const { error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password })
      if (authError) {
        setError('Неверный email или пароль.')
        return
      }
      try {
        await createLiveAdminApi(client, config.supabaseUrl, config.publishableKey).whoami()
      } catch (err) {
        await client.auth.signOut()
        setError(err instanceof ApiError && err.kind === 'forbidden' ? 'У этого аккаунта нет прав хранителя.' : 'Не получилось проверить права. Попробуй ещё раз.')
        return
      }
      navigate('/admin', { replace: true })
    } catch {
      setError('Нет связи с сервером. Попробуй ещё раз.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="login" onSubmit={onSubmit}>
      <h1>Вход для хранителя</h1>
      <div className="field">
        <label htmlFor="admin-email" className="field-label">
          Email
        </label>
        <input id="admin-email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="admin-password" className="field-label">
          Пароль
        </label>
        <input
          id="admin-password"
          className="input"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
        {busy ? 'Входим…' : 'Войти'}
      </button>
    </form>
  )
}

// Публичная конфигурация интерфейса. Режим выбирается явно через VITE_APP_MODE.
// Если live настроен не полностью — показываем ошибку, а не переключаемся тихо на demo.

export type AppConfig =
  | { mode: 'demo' }
  | {
      mode: 'live'
      supabaseUrl: string
      publishableKey: string
      turnstileSiteKey: string | null
      submissionsEnabled: boolean
    }

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; problems: string[] }

export function readAppConfig(env: ImportMetaEnv = import.meta.env): ConfigResult {
  if (env.VITE_APP_MODE !== 'live') return { ok: true, config: { mode: 'demo' } }

  const problems: string[] = []
  const url = env.VITE_SUPABASE_URL?.trim() ?? ''
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url))
    problems.push('VITE_SUPABASE_URL')
  if (!key) problems.push('VITE_SUPABASE_PUBLISHABLE_KEY')
  // Защита от ошибки «вставила не тот ключ»: секретный ключ в браузере недопустим.
  if (key.startsWith('sb_secret_') || /service_role/.test(atobSafe(key.split('.')[1] ?? '')))
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY содержит СЕКРЕТНЫЙ ключ — замени его на publishable')

  const submissionsEnabled = env.VITE_SUBMISSIONS_ENABLED === 'true'
  const turnstileSiteKey = env.VITE_TURNSTILE_SITE_KEY?.trim() || null
  if (submissionsEnabled && !turnstileSiteKey) problems.push('VITE_TURNSTILE_SITE_KEY')

  if (problems.length) return { ok: false, problems }
  return {
    ok: true,
    config: { mode: 'live', supabaseUrl: url, publishableKey: key, turnstileSiteKey, submissionsEnabled },
  }
}

function atobSafe(s: string): string {
  try {
    return atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return ''
  }
}

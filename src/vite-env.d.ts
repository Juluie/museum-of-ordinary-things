/// <reference types="vite/client" />

// Всё с префиксом VITE_ попадает в браузер и видно посетителю.
// Здесь только публичные значения. Секретов здесь быть не должно.
interface ImportMetaEnv {
  readonly VITE_APP_MODE?: 'demo' | 'live'
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_TURNSTILE_SITE_KEY?: string
  readonly VITE_SUBMISSIONS_ENABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

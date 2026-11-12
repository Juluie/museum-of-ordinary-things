// Серверные настройки. Читаются из секретов Supabase (Deno.env) — никогда из VITE_*.

export type ServerConfig = {
  submissionsEnabled: boolean
  turnstileSecret: string | null
  turnstileHostnames: string[]
  rateLimitSecret: string | null
  rateLimitKeyVersion: string
  allowedOrigins: string[]
  limits: { perHour: number; perDay: number; globalPerDay: number }
  maxUploadBytes: number
  maxServerPixels: number
  publicSignedUrlTtl: number
  adminSignedUrlTtl: number
  bucket: string
}

function int(v: string | undefined, fallback: number, min = 0): number {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isFinite(n) && n >= min ? n : fallback
}

function list(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function readConfig(get: (name: string) => string | undefined): ServerConfig {
  return {
    // По умолчанию приём ВЫКЛЮЧЕН — включается явно.
    submissionsEnabled: get('SUBMISSIONS_ENABLED') === 'true',
    turnstileSecret: get('TURNSTILE_SECRET_KEY') || null,
    turnstileHostnames: list(get('TURNSTILE_EXPECTED_HOSTNAMES')),
    rateLimitSecret: get('RATE_LIMIT_HMAC_SECRET') || null,
    rateLimitKeyVersion: get('RATE_LIMIT_HMAC_KEY_VERSION') || 'v1',
    allowedOrigins: list(get('ALLOWED_ORIGINS')),
    limits: {
      perHour: int(get('SUBMIT_LIMIT_PER_HOUR'), 3, 1),
      perDay: int(get('SUBMIT_LIMIT_PER_DAY'), 10, 1),
      globalPerDay: int(get('SUBMIT_LIMIT_GLOBAL_PER_DAY'), 100, 1),
    },
    maxUploadBytes: int(get('MAX_UPLOAD_BYTES'), 6 * 1024 * 1024, 1024),
    maxServerPixels: int(get('MAX_SERVER_PIXELS'), 12_000_000, 1),
    publicSignedUrlTtl: int(get('PUBLIC_SIGNED_URL_TTL_SECONDS'), 3600, 60),
    adminSignedUrlTtl: int(get('ADMIN_SIGNED_URL_TTL_SECONDS'), 600, 60),
    bucket: 'exhibit-images',
  }
}

/** Почему приём закрыт. null — всё настроено. Отсутствующий секрет закрывает приём, а не отключает проверку. */
export function submissionsClosedReason(c: ServerConfig): string | null {
  if (!c.submissionsEnabled) return 'disabled'
  if (!c.turnstileSecret) return 'missing_turnstile_secret'
  if (c.turnstileHostnames.length === 0) return 'missing_turnstile_hostnames'
  if (!c.rateLimitSecret || c.rateLimitSecret.length < 32) return 'missing_rate_limit_secret'
  if (c.allowedOrigins.length === 0) return 'missing_allowed_origins'
  return null
}

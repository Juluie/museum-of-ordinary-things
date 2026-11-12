// Подключение к Supabase и Turnstile для Edge Functions (только Deno).
// Ключи читаются из окружения функции; в браузер они никогда не попадают.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { TurnstileOutcome } from './submit-core.ts'

function secretKey(): string {
  // Новые ключи Supabase (sb_secret_…) приходят JSON-словарём; legacy — service_role.
  const dict = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (dict) {
    try {
      const parsed = JSON.parse(dict) as Record<string, string>
      const key = parsed.default ?? Object.values(parsed)[0]
      if (key) return key
    } catch {
      /* перейти к legacy */
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!legacy) throw new Error('Server key is not configured')
  return legacy
}

let client: SupabaseClient | null = null
export function serviceClient(): SupabaseClient {
  if (client) return client
  const url = Deno.env.get('SUPABASE_URL')
  if (!url) throw new Error('SUPABASE_URL is not configured')
  client = createClient(url, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return client
}

export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null,
  idempotencyKey: string,
): Promise<TurnstileOutcome> {
  const body: Record<string, string> = { secret, response: token, idempotency_key: idempotencyKey }
  if (remoteIp) body.remoteip = remoteIp
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`siteverify ${res.status}`)
  const data = (await res.json()) as {
    success: boolean
    hostname?: string
    action?: string
    'error-codes'?: string[]
  }
  return { success: data.success === true, hostname: data.hostname, action: data.action, errorCodes: data['error-codes'] }
}

/** Логи без персональных данных: только событие и технические поля. */
export function log(fn: string) {
  return (event: string, data: Record<string, unknown> = {}) => {
    console.log(JSON.stringify({ fn, event, ...data }))
  }
}

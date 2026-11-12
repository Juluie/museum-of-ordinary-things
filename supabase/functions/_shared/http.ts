// HTTP-помощники на стандартных Web API (работают и в Deno, и в Node 20+).

export type JsonBody = Record<string, unknown>

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const h: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '600',
  }
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}

export function isOriginAllowed(origin: string | null, allowed: string[]): boolean {
  return !!origin && allowed.includes(origin)
}

export function json(status: number, body: JsonBody, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  })
}

export class BodyTooLargeError extends Error {}

/** Читает тело запроса, обрывая чтение при превышении лимита (даже без Content-Length). */
export async function readLimitedBody(req: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > maxBytes) throw new BodyTooLargeError()
  if (!req.body) return new Uint8Array()
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new BodyTooLargeError()
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.byteLength
  }
  return out
}

/**
 * Достоверный IP посетителя. Запросы к *.supabase.co проходят через Cloudflare,
 * который перезаписывает CF-Connecting-IP — клиент не может его подделать.
 * X-Forwarded-For не используем: клиент может дописать туда что угодно.
 */
export function trustedClientIp(headers: Headers): string | null {
  const cf = headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  return null
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')
}

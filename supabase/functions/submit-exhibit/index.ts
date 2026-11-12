// POST /functions/v1/submit-exhibit — приём нового экспоната (multipart/form-data).

import {
  AlphaAction,
  ImageMagick,
  initializeImageMagick,
  MagickColors,
  MagickFormat,
  MagickGeometry,
  ResourceLimits,
} from 'npm:@imagemagick/magick-wasm@0.0.46'
import { readConfig, submissionsClosedReason } from '../_shared/config.ts'
import { log, serviceClient, verifyTurnstile } from '../_shared/deno-deps.ts'
import { BodyTooLargeError, corsHeaders, hmacHex, isOriginAllowed, json, readLimitedBody, trustedClientIp } from '../_shared/http.ts'
import { normalizeImage, type MagickApi } from '../_shared/image-normalize.ts'
import { handleSubmission, type QuotaOutcome } from '../_shared/submit-core.ts'

const wasmBytes = await Deno.readFile(
  new URL('x86/magick.wasm', import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.46')),
)
await initializeImageMagick(wasmBytes)

const magick = {
  ImageMagick,
  MagickFormat,
  MagickGeometry,
  MagickColors,
  AlphaAction,
  ResourceLimits,
} as unknown as MagickApi

const logger = log('submit-exhibit')

Deno.serve(async (req) => {
  const config = readConfig((k) => Deno.env.get(k))
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin, config.allowedOrigins)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: isOriginAllowed(origin, config.allowedOrigins) ? 204 : 403, headers: cors })
  }
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, cors)
  if (!isOriginAllowed(origin, config.allowedOrigins)) {
    return json(403, { ok: false, error: 'forbidden_origin' }, cors)
  }
  // Не читаем тело, если приём закрыт.
  if (submissionsClosedReason(config)) return json(503, { ok: false, error: 'submissions_closed' }, cors)

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return json(415, { ok: false, error: 'bad_request' }, cors)
  }

  let form: FormData
  try {
    const bytes = await readLimitedBody(req, config.maxUploadBytes)
    form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData()
  } catch (e) {
    if (e instanceof BodyTooLargeError) return json(413, { ok: false, error: 'payload_too_large' }, cors)
    return json(400, { ok: false, error: 'bad_request' }, cors)
  }

  const str = (k: string) => {
    const v = form.get(k)
    return typeof v === 'string' ? v : null
  }
  const photo = form.get('photo')
  const file = photo instanceof File ? new Uint8Array(await photo.arrayBuffer()) : null

  const supabase = serviceClient()
  const bucket = supabase.storage.from(config.bucket)

  const result = await handleSubmission(
    {
      config,
      verifyTurnstile: (token, ip, key) => verifyTurnstile(config.turnstileSecret!, token, ip, key),
      hashKey: (v) => hmacHex(config.rateLimitSecret!, v),
      async submissionExists(submissionId) {
        const { data, error } = await supabase
          .from('exhibits')
          .select('id')
          .eq('submission_id', submissionId)
          .maybeSingle()
        if (error) throw error
        return !!data
      },
      async consumeQuota(keyHash): Promise<QuotaOutcome> {
        const { data, error } = await supabase.rpc('consume_submission_quota', {
          p_key: keyHash,
          p_per_hour: config.limits.perHour,
          p_per_day: config.limits.perDay,
          p_global_per_day: config.limits.globalPerDay,
        })
        if (error) throw error
        if (data === 'ok') return { allowed: true }
        if (data === 'per_hour' || data === 'per_day' || data === 'global_day') return { allowed: false, reason: data }
        throw new Error('unexpected quota response')
      },
      normalizeImage: async (bytes) => normalizeImage(magick, bytes, { maxPixels: config.maxServerPixels }),
      async uploadImage(path, bytes, ct) {
        const { error } = await bucket.upload(path, bytes, { contentType: ct, upsert: false, cacheControl: '3600' })
        if (error) throw error
      },
      async removeImage(path) {
        const { error } = await bucket.remove([path])
        if (error) throw error
      },
      async insertPending(row) {
        const { error } = await supabase.from('exhibits').insert(row)
        if (!error) return 'ok'
        if (error.code === '23505') return 'duplicate'
        throw error
      },
      newId: () => crypto.randomUUID(),
      log: logger,
    },
    {
      fields: {
        title: str('title'),
        story: str('story'),
        authorName: str('authorName'),
        keptSince: str('keptSince'),
        imageAlt: str('imageAlt'),
        consent: str('consent'),
      },
      file,
      turnstileToken: str('turnstileToken'),
      submissionId: str('submissionId'),
      honeypot: str('website'),
      clientIp: trustedClientIp(req.headers),
    },
  ).catch((e) => {
    logger('unhandled_error', { message: e instanceof Error ? e.message.slice(0, 200) : 'unknown' })
    return { status: 500, body: { ok: false, error: 'server_error' } }
  })

  return json(result.status, result.body, cors)
})

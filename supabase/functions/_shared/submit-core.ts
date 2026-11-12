// Логика приёма экспоната. Все внешние операции передаются через deps,
// поэтому сценарии (боты, лимиты, сбои) проверяются unit-тестами без реального Supabase.

import { submissionsClosedReason, type ServerConfig } from './config.ts'
import { IMAGE_REJECT_MESSAGES, ImageRejectedError, type NormalizedImage } from './image-normalize.ts'
import { CONSENT_VERSION, isUuid, validateSubmission } from './validation.ts'

export const TURNSTILE_ACTION = 'submit_exhibit'

export type TurnstileOutcome = {
  success: boolean
  hostname?: string
  action?: string
  errorCodes?: string[]
}

export type QuotaOutcome = { allowed: true } | { allowed: false; reason: 'per_hour' | 'per_day' | 'global_day' }

export type PendingRow = {
  id: string
  submission_id: string
  title: string
  story: string
  author_name: string | null
  kept_since: string | null
  image_alt: string
  image_path: string
  image_width: number
  image_height: number
  consent_version: string
}

export type SubmitDeps = {
  config: ServerConfig
  verifyTurnstile(token: string, remoteIp: string | null, idempotencyKey: string): Promise<TurnstileOutcome>
  hashKey(value: string): Promise<string>
  submissionExists(submissionId: string): Promise<boolean>
  consumeQuota(keyHash: string): Promise<QuotaOutcome>
  normalizeImage(bytes: Uint8Array): Promise<NormalizedImage>
  uploadImage(path: string, bytes: Uint8Array, contentType: string): Promise<void>
  removeImage(path: string): Promise<void>
  /** Вставляет pending-запись. 'duplicate' — такой submission_id уже есть. */
  insertPending(row: PendingRow): Promise<'ok' | 'duplicate'>
  newId(): string
  log(event: string, data?: Record<string, unknown>): void
}

export type SubmitInput = {
  fields: Record<string, unknown>
  file: Uint8Array | null
  turnstileToken: string | null
  submissionId: string | null
  honeypot: string | null
  clientIp: string | null
}

export type SubmitResult = { status: number; body: Record<string, unknown> }

const fail = (status: number, error: string, extra: Record<string, unknown> = {}): SubmitResult => ({
  status,
  body: { ok: false, error, ...extra },
})

const ACCEPTED: SubmitResult = { status: 201, body: { ok: true, state: 'pending' } }

export async function handleSubmission(deps: SubmitDeps, input: SubmitInput): Promise<SubmitResult> {
  const { config } = deps

  // 0. Приём выключен или не хватает секретов → закрыто.
  const closed = submissionsClosedReason(config)
  if (closed) {
    deps.log('submit_closed', { reason: closed })
    return fail(503, 'submissions_closed')
  }

  // 1. Honeypot — дополнительный, не основной фильтр.
  if (input.honeypot && input.honeypot.trim() !== '') {
    deps.log('submit_honeypot')
    return fail(400, 'bot_check_failed')
  }

  if (!isUuid(input.submissionId)) return fail(400, 'bad_request')
  const submissionId = input.submissionId

  // 2. Turnstile — обязательная серверная проверка.
  const token = input.turnstileToken?.trim() ?? ''
  if (!token || token.length > 2048) return fail(400, 'bot_check_failed')
  let ts: TurnstileOutcome
  try {
    ts = await deps.verifyTurnstile(token, input.clientIp, submissionId)
  } catch {
    deps.log('turnstile_unreachable')
    return fail(503, 'bot_check_unavailable')
  }
  if (
    !ts.success ||
    ts.action !== TURNSTILE_ACTION ||
    !ts.hostname ||
    !config.turnstileHostnames.includes(ts.hostname)
  ) {
    deps.log('turnstile_rejected', { codes: ts.errorCodes ?? [] })
    return fail(400, 'bot_check_failed')
  }

  // 3. Повтор того же submission_id (например, после обрыва сети) — не дублируем.
  if (await deps.submissionExists(submissionId)) return { ...ACCEPTED, status: 200 }

  // 4. Лимиты: атомарно в Postgres, общие для всех инстансов функции.
  const ipKey = input.clientIp ?? 'unknown-ip'
  const keyHash = await deps.hashKey(`${config.rateLimitKeyVersion}:${ipKey}`)
  const quota = await deps.consumeQuota(keyHash)
  if (!quota.allowed) {
    deps.log('rate_limited', { reason: quota.reason })
    return fail(429, quota.reason === 'global_day' ? 'daily_limit' : 'rate_limited')
  }

  // 5. Поля. Статус, путь к файлу, даты — из запроса не принимаются вообще.
  const v = validateSubmission({
    title: input.fields.title,
    story: input.fields.story,
    authorName: input.fields.authorName,
    keptSince: input.fields.keptSince,
    imageAlt: input.fields.imageAlt,
    consent: input.fields.consent,
  })
  if (!v.ok) return fail(422, 'validation', { fields: v.errors })

  // 6. Фото: проверка формата, декодирование, перекодирование без метаданных.
  if (!input.file || input.file.byteLength === 0) {
    return fail(422, 'validation', { fields: { photo: 'Добавь фотографию.' } })
  }
  let image: NormalizedImage
  try {
    image = await deps.normalizeImage(input.file)
  } catch (e) {
    if (e instanceof ImageRejectedError) {
      return fail(422, 'image_rejected', { message: IMAGE_REJECT_MESSAGES[e.reason] })
    }
    deps.log('image_processing_failed')
    return fail(500, 'server_error')
  }

  // 7. Сохранение: сначала файл (имя генерирует сервер), потом запись.
  const id = deps.newId()
  const path = `pending/${id}.jpg`
  try {
    await deps.uploadImage(path, image.bytes, image.contentType)
  } catch {
    deps.log('upload_failed')
    return fail(500, 'server_error')
  }

  let inserted: 'ok' | 'duplicate'
  try {
    inserted = await deps.insertPending({
      id,
      submission_id: submissionId,
      title: v.value.title,
      story: v.value.story,
      author_name: v.value.authorName,
      kept_since: v.value.keptSince,
      image_alt: v.value.imageAlt,
      image_path: path,
      image_width: image.width,
      image_height: image.height,
      consent_version: CONSENT_VERSION,
    })
  } catch {
    deps.log('insert_failed')
    await safeRemove(deps, path)
    return fail(500, 'server_error')
  }

  if (inserted === 'duplicate') {
    // Параллельный повтор успел раньше — наш файл лишний.
    await safeRemove(deps, path)
    return { ...ACCEPTED, status: 200 }
  }

  deps.log('submit_accepted')
  return ACCEPTED
}

async function safeRemove(deps: SubmitDeps, path: string) {
  try {
    await deps.removeImage(path)
  } catch {
    // Файл останется сиротой: его найдёт регулярная очистка (docs/OPERATIONS.md).
    deps.log('orphan_file_left', { path })
  }
}

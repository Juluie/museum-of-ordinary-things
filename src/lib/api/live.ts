// Live-режим: запросы к Supabase Edge Functions. В браузере только публичный ключ.
import type { Exhibit } from '../../types/exhibit.ts'
import { ApiError, type MuseumApi, type SubmitOutcome } from './types.ts'

type LiveOptions = { supabaseUrl: string; publishableKey: string; fetchImpl?: typeof fetch }

const SUBMIT_MESSAGES: Record<string, { message: string; retryable: boolean }> = {
  submissions_closed: { message: 'Приём новых вещей сейчас закрыт. Попробуй позже.', retryable: false },
  bot_check_failed: { message: 'Проверка «я не робот» не прошла. Пройди её ещё раз и отправь снова.', retryable: true },
  bot_check_unavailable: { message: 'Проверка «я не робот» сейчас недоступна. Попробуй через пару минут.', retryable: true },
  rate_limited: { message: 'Слишком много отправок подряд. Попробуй позже.', retryable: false },
  daily_limit: { message: 'Сегодня музей уже принял много вещей. Попробуй завтра.', retryable: false },
  payload_too_large: { message: 'Фото получилось слишком тяжёлым. Выбери другое.', retryable: false },
  validation: { message: 'Проверь поля формы.', retryable: false },
  server_error: { message: 'На сервере что-то пошло не так. Текст сохранён — попробуй ещё раз.', retryable: true },
}

export function createLiveApi({ supabaseUrl, publishableKey, fetchImpl = fetch }: LiveOptions): MuseumApi {
  const base = `${supabaseUrl}/functions/v1`
  const headers = { apikey: publishableKey }

  async function read(params: URLSearchParams): Promise<{ status: number; body: Record<string, unknown> }> {
    let res: Response
    try {
      res = await fetchImpl(`${base}/public-exhibits?${params}`, { headers })
    } catch {
      throw new ApiError('network', 'Не получилось связаться с музеем. Проверь интернет и попробуй ещё раз.')
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.status >= 500) throw new ApiError('server', 'Музей временно не отвечает. Попробуй ещё раз.')
    return { status: res.status, body }
  }

  return {
    mode: 'live',
    async getRandom(excludeId) {
      const p = new URLSearchParams({ random: '1' })
      if (excludeId) p.set('exclude', excludeId)
      const { status, body } = await read(p)
      if (status !== 200) throw new ApiError('server', 'Музей временно не отвечает. Попробуй ещё раз.')
      return { exhibit: (body.exhibit as Exhibit | null) ?? null, hasOthers: body.hasOthers === true }
    },
    async getById(id) {
      const { status, body } = await read(new URLSearchParams({ id }))
      if (status === 404) return null
      if (status !== 200) throw new ApiError('server', 'Музей временно не отвечает. Попробуй ещё раз.')
      return body.exhibit as Exhibit
    },
    async submit(payload): Promise<SubmitOutcome> {
      const form = new FormData()
      form.set('title', payload.fields.title)
      form.set('story', payload.fields.story)
      form.set('authorName', payload.fields.authorName)
      form.set('keptSince', payload.fields.keptSince)
      form.set('imageAlt', payload.fields.imageAlt)
      form.set('consent', payload.fields.consent ? 'true' : 'false')
      form.set('submissionId', payload.submissionId)
      form.set('turnstileToken', payload.turnstileToken ?? '')
      form.set('website', payload.honeypot)
      form.set('photo', payload.photo, 'photo.jpg')

      let res: Response
      try {
        res = await fetchImpl(`${base}/submit-exhibit`, { method: 'POST', headers, body: form })
      } catch {
        return {
          kind: 'error',
          code: 'network',
          message: 'Не получилось связаться с сервером. Текст и фото на месте — попробуй ещё раз.',
          retryable: true,
        }
      }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (res.ok && body.ok === true) return { kind: 'accepted' }

      const code = typeof body.error === 'string' ? body.error : 'server_error'
      if (code === 'image_rejected') {
        const message = String(body.message ?? 'Фото не подошло.')
        return { kind: 'error', code, message, fields: { photo: message }, retryable: false }
      }
      const known = SUBMIT_MESSAGES[code] ?? SUBMIT_MESSAGES.server_error
      return {
        kind: 'error',
        code,
        message: known.message,
        retryable: known.retryable,
        fields: code === 'validation' ? (body.fields as Record<string, string>) : undefined,
      }
    },
  }
}

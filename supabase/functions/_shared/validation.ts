// Общие правила формы. Этот файл импортируют и браузер (src/), и Edge Functions.
// Здесь не должно быть зависимостей от Deno, Node или браузера.

export const LIMITS = {
  title: { min: 2, max: 80 },
  story: { min: 20, max: 1500 },
  authorName: { max: 50 },
  keptSince: { max: 80 },
  imageAlt: { min: 1, max: 200 },
} as const

export const CONSENT_VERSION = '2026-11-v1'

export type SubmissionFields = {
  title: string
  story: string
  authorName: string
  keptSince: string
  imageAlt: string
  consent: boolean
}

export type FieldName = keyof SubmissionFields

export type CleanSubmission = {
  title: string
  story: string
  authorName: string | null
  keptSince: string | null
  imageAlt: string
}

export type ValidationResult =
  | { ok: true; value: CleanSubmission }
  | { ok: false; errors: Partial<Record<FieldName, string>> }

/** Длина в символах, а не в UTF-16 единицах: эмодзи и составные буквы считаются честно. */
export function charLength(s: string): number {
  return Array.from(s).length
}

/** Убирает управляющие символы (кроме переноса строки), нормализует переносы и пробелы по краям. */
export function cleanText(input: unknown, { multiline = false } = {}): string {
  if (typeof input !== 'string') return ''
  let s = input.normalize('NFC').replace(/\r\n?/g, '\n')
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
  if (!multiline) s = s.replace(/\n+/g, ' ')
  else s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

export function validateSubmission(raw: Partial<Record<FieldName, unknown>>): ValidationResult {
  const title = cleanText(raw.title)
  const story = cleanText(raw.story, { multiline: true })
  const authorName = cleanText(raw.authorName)
  const keptSince = cleanText(raw.keptSince)
  const imageAlt = cleanText(raw.imageAlt)
  const consent = raw.consent === true || raw.consent === 'true' || raw.consent === 'on'

  const errors: Partial<Record<FieldName, string>> = {}

  const t = charLength(title)
  if (t === 0) errors.title = 'Напиши, что это за вещь.'
  else if (t < LIMITS.title.min) errors.title = `Название — минимум ${LIMITS.title.min} символа.`
  else if (t > LIMITS.title.max) errors.title = `Название — не длиннее ${LIMITS.title.max} символов.`

  const st = charLength(story)
  if (st === 0) errors.story = 'Расскажи, почему ты хранишь эту вещь.'
  else if (st < LIMITS.story.min) errors.story = `История — минимум ${LIMITS.story.min} символов.`
  else if (st > LIMITS.story.max) errors.story = `История — не длиннее ${LIMITS.story.max} символов.`

  if (charLength(authorName) > LIMITS.authorName.max)
    errors.authorName = `Подпись — не длиннее ${LIMITS.authorName.max} символов.`

  if (charLength(keptSince) > LIMITS.keptSince.max)
    errors.keptSince = `Не длиннее ${LIMITS.keptSince.max} символов.`

  const a = charLength(imageAlt)
  if (a === 0) errors.imageAlt = 'Коротко опиши, что на фотографии.'
  else if (a > LIMITS.imageAlt.max) errors.imageAlt = `Описание — не длиннее ${LIMITS.imageAlt.max} символов.`

  if (!consent) errors.consent = 'Без согласия мы не можем принять вещь в музей.'

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      title,
      story,
      authorName: authorName || null,
      keptSince: keptSince || null,
      imageAlt,
    },
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

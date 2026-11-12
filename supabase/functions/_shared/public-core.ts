// Публичное чтение: только approved, только безопасные поля, временная ссылка на фото.

import { isUuid } from './validation.ts'

export type ApprovedRow = {
  id: string
  inventory_number: number
  title: string
  story: string
  author_name: string | null
  kept_since: string | null
  image_alt: string
  image_path: string
  image_width: number | null
  image_height: number | null
  others_exist?: boolean
}

export type PublicExhibit = {
  id: string
  number: number
  title: string
  story: string
  authorName: string | null
  keptSince: string | null
  imageAlt: string
  imageUrl: string
  imageWidth: number | null
  imageHeight: number | null
  imageUrlExpiresAt: string
}

export type PublicDeps = {
  ttlSeconds: number
  getApprovedById(id: string): Promise<ApprovedRow | null>
  getRandomApproved(excludeId: string | null): Promise<ApprovedRow | null>
  signUrl(path: string, ttlSeconds: number): Promise<string>
  now(): number
}

export type PublicResult = { status: number; body: Record<string, unknown> }

async function toPublic(deps: PublicDeps, row: ApprovedRow): Promise<PublicExhibit> {
  const imageUrl = await deps.signUrl(row.image_path, deps.ttlSeconds)
  return {
    id: row.id,
    number: row.inventory_number,
    title: row.title,
    story: row.story,
    authorName: row.author_name,
    keptSince: row.kept_since,
    imageAlt: row.image_alt,
    imageUrl,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    imageUrlExpiresAt: new Date(deps.now() + deps.ttlSeconds * 1000).toISOString(),
  }
}

export async function handlePublicRead(deps: PublicDeps, params: URLSearchParams): Promise<PublicResult> {
  const id = params.get('id')
  if (id !== null) {
    // Неизвестный, pending и rejected ID дают одинаковый ответ.
    if (!isUuid(id)) return { status: 404, body: { ok: false, error: 'not_found' } }
    const row = await deps.getApprovedById(id)
    if (!row) return { status: 404, body: { ok: false, error: 'not_found' } }
    return { status: 200, body: { ok: true, exhibit: await toPublic(deps, row) } }
  }

  if (params.get('random') !== null) {
    const exclude = params.get('exclude')
    const row = await deps.getRandomApproved(isUuid(exclude) ? exclude : null)
    if (!row) return { status: 200, body: { ok: true, exhibit: null, hasOthers: false } }
    return {
      status: 200,
      body: { ok: true, exhibit: await toPublic(deps, row), hasOthers: row.others_exist ?? false },
    }
  }

  return { status: 400, body: { ok: false, error: 'bad_request' } }
}

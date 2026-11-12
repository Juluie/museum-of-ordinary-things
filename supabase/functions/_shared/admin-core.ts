// Административные операции. Каждая проверяет пользователя и его роль сама,
// независимо от RLS: функция работает с привилегированным ключом.

import { isUuid } from './validation.ts'

export type Status = 'pending' | 'approved' | 'rejected'
export const STATUSES: Status[] = ['pending', 'approved', 'rejected']

export type AdminRow = {
  id: string
  inventory_number: number | null
  title: string
  story: string
  author_name: string | null
  kept_since: string | null
  image_alt: string
  image_path: string | null
  status: Status
  created_at: string
  approved_at: string | null
}

export type AdminDeps = {
  ttlSeconds: number
  /** Проверяет access token через Supabase Auth. Возвращает id пользователя или null. */
  getUserId(accessToken: string): Promise<string | null>
  /** Ищет пользователя в таблице admins (не в user_metadata). */
  isAdmin(userId: string): Promise<boolean>
  list(status: Status, offset: number, limit: number): Promise<{ items: AdminRow[]; total: number }>
  getRow(id: string): Promise<AdminRow | null>
  /** Условное обновление статуса: срабатывает, только если текущий статус входит в from. */
  setStatus(id: string, from: Status[], to: Status): Promise<boolean>
  /** Одобрение: присваивает номер и approved_at (SQL-функция, атомарно). */
  approve(id: string): Promise<boolean>
  setImagePath(id: string, path: string | null): Promise<void>
  removeFile(path: string): Promise<void>
  moveFile(from: string, to: string): Promise<void>
  deleteRow(id: string): Promise<void>
  signUrl(path: string, ttlSeconds: number): Promise<string>
  randomSuffix(): string
  log(event: string, data?: Record<string, unknown>): void
}

export type AdminResult = { status: number; body: Record<string, unknown> }

export const PAGE_SIZE = 12

const err = (status: number, error: string, message?: string): AdminResult => ({
  status,
  body: { ok: false, error, ...(message ? { message } : {}) },
})

export async function authorizeAdmin(deps: AdminDeps, authHeader: string | null): Promise<string | AdminResult> {
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token) return err(401, 'unauthorized')
  let userId: string | null
  try {
    userId = await deps.getUserId(token)
  } catch {
    return err(401, 'unauthorized')
  }
  if (!userId) return err(401, 'unauthorized')
  if (!(await deps.isAdmin(userId))) {
    deps.log('admin_forbidden')
    return err(403, 'forbidden')
  }
  return userId
}

export async function handleAdmin(
  deps: AdminDeps,
  authHeader: string | null,
  body: Record<string, unknown>,
): Promise<AdminResult> {
  const auth = await authorizeAdmin(deps, authHeader)
  if (typeof auth !== 'string') return auth

  const action = body.action
  if (action === 'whoami') return { status: 200, body: { ok: true, admin: true } }

  if (action === 'list') {
    const status = body.status as Status
    if (!STATUSES.includes(status)) return err(400, 'bad_request')
    const page = Math.max(1, Math.min(10_000, Number(body.page) || 1))
    const { items, total } = await deps.list(status, (page - 1) * PAGE_SIZE, PAGE_SIZE)
    const withUrls = await Promise.all(
      items.map(async (r) => ({
        id: r.id,
        number: r.inventory_number,
        title: r.title,
        story: r.story,
        authorName: r.author_name,
        keptSince: r.kept_since,
        imageAlt: r.image_alt,
        status: r.status,
        createdAt: r.created_at,
        approvedAt: r.approved_at,
        imageUrl: r.image_path ? await deps.signUrl(r.image_path, deps.ttlSeconds).catch(() => null) : null,
      })),
    )
    return { status: 200, body: { ok: true, items: withUrls, total, page, pageSize: PAGE_SIZE } }
  }

  const id = body.id
  if (!isUuid(id)) return err(400, 'bad_request')

  switch (action) {
    case 'approve':
      return approve(deps, id)
    case 'reject':
      return reject(deps, id)
    case 'unpublish':
      return unpublish(deps, id)
    case 'delete':
      return remove(deps, id)
    default:
      return err(400, 'bad_request')
  }
}

async function approve(deps: AdminDeps, id: string): Promise<AdminResult> {
  const row = await deps.getRow(id)
  if (!row) return err(404, 'not_found')
  if (row.status === 'approved') return { status: 200, body: { ok: true, status: 'approved' } }
  if (row.status !== 'pending' || !row.image_path) return err(409, 'invalid_state', 'Одобрить можно только запись на проверке с фотографией.')
  const ok = await deps.approve(id)
  if (!ok) return err(409, 'invalid_state', 'Статус записи изменился. Обнови список.')
  deps.log('admin_approved')
  return { status: 200, body: { ok: true, status: 'approved' } }
}

/** Отклонение: статус → rejected, затем удаление файла, затем обнуление пути. Повторяемо. */
async function reject(deps: AdminDeps, id: string): Promise<AdminResult> {
  const row = await deps.getRow(id)
  if (!row) return err(404, 'not_found')
  if (row.status === 'approved') return err(409, 'invalid_state', 'Сначала сними экспонат с публикации.')
  if (row.status === 'pending') {
    const ok = await deps.setStatus(id, ['pending'], 'rejected')
    if (!ok) return err(409, 'invalid_state', 'Статус записи изменился. Обнови список.')
  }
  if (row.image_path) {
    try {
      await deps.removeFile(row.image_path)
      await deps.setImagePath(id, null)
    } catch {
      deps.log('reject_file_cleanup_failed')
      return err(500, 'partial', 'Запись отклонена, но фото удалить не удалось. Нажми «Отклонить» ещё раз.')
    }
  }
  deps.log('admin_rejected')
  return { status: 200, body: { ok: true, status: 'rejected' } }
}

/**
 * Снятие с публикации: статус → pending (новые ссылки больше не выдаются),
 * затем файл переносится по новому пути — уже выданные временные ссылки перестают работать.
 */
async function unpublish(deps: AdminDeps, id: string): Promise<AdminResult> {
  const row = await deps.getRow(id)
  if (!row) return err(404, 'not_found')
  if (row.status === 'rejected') return err(409, 'invalid_state')
  if (row.status === 'approved') {
    const ok = await deps.setStatus(id, ['approved'], 'pending')
    if (!ok) return err(409, 'invalid_state', 'Статус записи изменился. Обнови список.')
  }
  if (row.image_path) {
    const next = `pending/${id}-${deps.randomSuffix()}.jpg`
    try {
      await deps.moveFile(row.image_path, next)
    } catch {
      deps.log('unpublish_move_failed')
      return err(
        500,
        'partial',
        'Экспонат скрыт, новые ссылки не выдаются. Но уже выданные ссылки на фото могут работать до истечения срока. Нажми «Снять с публикации» ещё раз.',
      )
    }
    try {
      await deps.setImagePath(id, next)
    } catch {
      // Файл перенесён, а путь не сохранён — откатываем перенос, чтобы запись не ссылалась в пустоту.
      await deps.moveFile(next, row.image_path).catch(() => deps.log('unpublish_rollback_failed', { next }))
      return err(500, 'partial', 'Экспонат скрыт, но перенос фото не завершён. Повтори действие.')
    }
  }
  deps.log('admin_unpublished')
  return { status: 200, body: { ok: true, status: 'pending' } }
}

/** Удаление навсегда: скрыть → удалить файл → удалить запись. Повторный вызов безопасен. */
async function remove(deps: AdminDeps, id: string): Promise<AdminResult> {
  const row = await deps.getRow(id)
  if (!row) return { status: 200, body: { ok: true, deleted: true, already: true } }
  if (row.status !== 'rejected') {
    await deps.setStatus(id, ['pending', 'approved'], 'rejected')
  }
  if (row.image_path) {
    try {
      await deps.removeFile(row.image_path)
      await deps.setImagePath(id, null)
    } catch {
      deps.log('delete_file_failed')
      return err(500, 'partial', 'Запись скрыта, но фото удалить не удалось. Повтори удаление.')
    }
  }
  try {
    await deps.deleteRow(id)
  } catch {
    deps.log('delete_row_failed')
    return err(500, 'partial', 'Фото удалено, но запись осталась (скрыта). Повтори удаление.')
  }
  deps.log('admin_deleted')
  return { status: 200, body: { ok: true, deleted: true } }
}

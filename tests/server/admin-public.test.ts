import { describe, expect, it, vi } from 'vitest'
import { handleAdmin, type AdminDeps, type AdminRow, type Status } from '../../supabase/functions/_shared/admin-core.ts'
import { handlePublicRead, type ApprovedRow, type PublicDeps } from '../../supabase/functions/_shared/public-core.ts'

const ID = '11111111-2222-4333-8444-555555555555'
const ADMIN = 'admin-user'
const USER = 'regular-user'

function row(status: Status, extra: Partial<AdminRow> = {}): AdminRow {
  return {
    id: ID,
    inventory_number: status === 'approved' ? 1 : null,
    title: 'Ключ',
    story: 'Ключ от квартиры, где мы жили до переезда.',
    author_name: null,
    kept_since: null,
    image_alt: 'Латунный ключ',
    image_path: `pending/${ID}.jpg`,
    status,
    created_at: '2026-11-01T10:00:00Z',
    approved_at: null,
    ...extra,
  }
}

function makeAdmin(initial: AdminRow | null, over: Partial<AdminDeps> = {}) {
  const state = { row: initial ? { ...initial } : null, files: new Set(initial?.image_path ? [initial.image_path] : []) }
  const deps: AdminDeps = {
    ttlSeconds: 600,
    getUserId: vi.fn(async (t: string) => (t === 'admin-token' ? ADMIN : t === 'user-token' ? USER : null)),
    isAdmin: vi.fn(async (u: string) => u === ADMIN),
    list: vi.fn(async () => ({ items: state.row ? [state.row] : [], total: state.row ? 1 : 0 })),
    getRow: vi.fn(async () => (state.row ? { ...state.row } : null)),
    setStatus: vi.fn(async (_id: string, from: Status[], to: Status) => {
      if (!state.row || !from.includes(state.row.status)) return false
      state.row.status = to
      return true
    }),
    approve: vi.fn(async () => {
      if (state.row?.status !== 'pending') return false
      state.row.status = 'approved'
      return true
    }),
    setImagePath: vi.fn(async (_id: string, p: string | null) => {
      if (state.row) state.row.image_path = p
    }),
    removeFile: vi.fn(async (p: string) => {
      state.files.delete(p) // удаление отсутствующего файла — не ошибка (как в Supabase Storage)
    }),
    moveFile: vi.fn(async (a: string, b: string) => {
      if (!state.files.has(a)) throw new Error('not found')
      state.files.delete(a)
      state.files.add(b)
    }),
    deleteRow: vi.fn(async () => {
      state.row = null
    }),
    signUrl: vi.fn(async (p: string) => `https://signed/${p}`),
    randomSuffix: () => 'abcdef0123456789',
    log: () => {},
    ...over,
  }
  return { deps, state }
}

const call = (deps: AdminDeps, body: Record<string, unknown>, token = 'admin-token') =>
  handleAdmin(deps, token ? `Bearer ${token}` : null, body)

describe('админ: авторизация', () => {
  it('без токена — 401', async () => {
    const { deps } = makeAdmin(row('pending'))
    expect((await call(deps, { action: 'list', status: 'pending' }, '')).status).toBe(401)
  })
  it('невалидный токен — 401', async () => {
    const { deps } = makeAdmin(row('pending'))
    expect((await call(deps, { action: 'list', status: 'pending' }, 'garbage')).status).toBe(401)
  })
  it('обычный authenticated-пользователь — 403 на любые действия', async () => {
    const { deps, state } = makeAdmin(row('pending'))
    for (const action of ['list', 'approve', 'reject', 'unpublish', 'delete']) {
      const r = await call(deps, { action, id: ID, status: 'pending' }, 'user-token')
      expect(r.status, action).toBe(403)
    }
    expect(state.row?.status).toBe('pending')
    expect(deps.list).not.toHaveBeenCalled()
  })
})

describe('админ: модерация', () => {
  it('одобрить pending', async () => {
    const { deps, state } = makeAdmin(row('pending'))
    expect((await call(deps, { action: 'approve', id: ID })).status).toBe(200)
    expect(state.row?.status).toBe('approved')
  })
  it('отклонить: статус rejected, файл удалён, путь обнулён', async () => {
    const { deps, state } = makeAdmin(row('pending'))
    expect((await call(deps, { action: 'reject', id: ID })).status).toBe(200)
    expect(state.row?.status).toBe('rejected')
    expect(state.row?.image_path).toBeNull()
    expect(state.files.size).toBe(0)
  })
  it('отклонение повторяемо после сбоя удаления файла', async () => {
    let fail = true
    const { deps, state } = makeAdmin(row('pending'), {})
    const orig = deps.removeFile
    deps.removeFile = vi.fn(async (p: string) => {
      if (fail) throw new Error('storage down')
      return orig(p)
    })
    const first = await call(deps, { action: 'reject', id: ID })
    expect(first.status).toBe(500)
    expect(first.body.ok).toBe(false)
    expect(state.row?.status).toBe('rejected')
    fail = false
    expect((await call(deps, { action: 'reject', id: ID })).status).toBe(200)
    expect(state.row?.image_path).toBeNull()
  })
  it('снять с публикации: статус pending, файл перенесён (старые ссылки ломаются)', async () => {
    const { deps, state } = makeAdmin(row('approved'))
    expect((await call(deps, { action: 'unpublish', id: ID })).status).toBe(200)
    expect(state.row?.status).toBe('pending')
    expect(state.row?.image_path).toBe(`pending/${ID}-abcdef0123456789.jpg`)
    expect(state.files.has(`pending/${ID}.jpg`)).toBe(false)
  })
  it('удалить: запись и файл; повтор безопасен', async () => {
    const { deps, state } = makeAdmin(row('approved'))
    expect((await call(deps, { action: 'delete', id: ID })).status).toBe(200)
    expect(state.row).toBeNull()
    expect(state.files.size).toBe(0)
    const again = await call(deps, { action: 'delete', id: ID })
    expect(again.status).toBe(200)
    expect(again.body.already).toBe(true)
  })
  it('удаление без оставшегося файла', async () => {
    const { deps, state } = makeAdmin(row('rejected', { image_path: null }))
    expect((await call(deps, { action: 'delete', id: ID })).status).toBe(200)
    expect(state.row).toBeNull()
  })
  it('сбой удаления записи после удаления файла — не сообщает успех; повтор доводит', async () => {
    const { deps, state } = makeAdmin(row('pending'))
    let fail = true
    const orig = deps.deleteRow
    deps.deleteRow = vi.fn(async (id: string) => {
      if (fail) throw new Error('db down')
      return orig(id)
    })
    const r = await call(deps, { action: 'delete', id: ID })
    expect(r.status).toBe(500)
    expect(state.row?.status).toBe('rejected') // скрыта
    fail = false
    expect((await call(deps, { action: 'delete', id: ID })).status).toBe(200)
    expect(state.row).toBeNull()
  })
  it('нельзя отклонить опубликованное без снятия', async () => {
    const { deps } = makeAdmin(row('approved'))
    expect((await call(deps, { action: 'reject', id: ID })).status).toBe(409)
  })
  it('неверные параметры', async () => {
    const { deps } = makeAdmin(row('pending'))
    expect((await call(deps, { action: 'approve', id: 'nope' })).status).toBe(400)
    expect((await call(deps, { action: 'list', status: 'all' })).status).toBe(400)
    expect((await call(deps, { action: 'drop_table', id: ID })).status).toBe(400)
  })
})

describe('публичное чтение', () => {
  const approved: ApprovedRow = {
    id: ID,
    inventory_number: 3,
    title: 'Камень',
    story: 'Подобрала на берегу в первый день отпуска.',
    author_name: 'Аня',
    kept_since: null,
    image_alt: 'Серый камень',
    image_path: `pending/${ID}.jpg`,
    image_width: 1200,
    image_height: 900,
    others_exist: true,
  }
  function deps(over: Partial<PublicDeps> = {}): PublicDeps {
    return {
      ttlSeconds: 3600,
      now: () => 0,
      getApprovedById: vi.fn(async (id: string) => (id === ID ? approved : null)),
      getRandomApproved: vi.fn(async () => approved),
      signUrl: vi.fn(async (p: string) => `https://signed/${p}`),
      ...over,
    }
  }
  it('approved по ID — только безопасные поля', async () => {
    const r = await handlePublicRead(deps(), new URLSearchParams({ id: ID }))
    expect(r.status).toBe(200)
    const ex = r.body.exhibit as Record<string, unknown>
    expect(Object.keys(ex).sort()).toEqual(
      ['authorName', 'id', 'imageAlt', 'imageHeight', 'imageUrl', 'imageUrlExpiresAt', 'imageWidth', 'keptSince', 'number', 'story', 'title'].sort(),
    )
    expect(JSON.stringify(r.body)).not.toContain('image_path')
  })
  it('pending/rejected/неизвестный ID — одинаковый 404 без ссылки на фото', async () => {
    const d = deps()
    for (const id of ['22222222-2222-4333-8444-555555555555', 'not-a-uuid', '']) {
      const r = await handlePublicRead(d, new URLSearchParams({ id }))
      expect(r.status).toBe(404)
      expect(r.body).toEqual({ ok: false, error: 'not_found' })
    }
    expect(d.signUrl).not.toHaveBeenCalled()
  })
  it('пустая коллекция', async () => {
    const r = await handlePublicRead(deps({ getRandomApproved: vi.fn(async () => null) }), new URLSearchParams({ random: '1' }))
    expect(r.body).toEqual({ ok: true, exhibit: null, hasOthers: false })
  })
  it('exclude передаётся только если это UUID', async () => {
    const d = deps()
    await handlePublicRead(d, new URLSearchParams({ random: '1', exclude: 'x; drop' }))
    expect(d.getRandomApproved).toHaveBeenCalledWith(null)
  })
})

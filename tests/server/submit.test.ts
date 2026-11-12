import { describe, expect, it, vi } from 'vitest'
import { readConfig } from '../../supabase/functions/_shared/config.ts'
import { ImageRejectedError } from '../../supabase/functions/_shared/image-normalize.ts'
import { handleSubmission, type PendingRow, type SubmitDeps, type SubmitInput } from '../../supabase/functions/_shared/submit-core.ts'

const SUB_ID = '11111111-2222-4333-8444-555555555555'

const env = {
  SUBMISSIONS_ENABLED: 'true',
  TURNSTILE_SECRET_KEY: 'test-secret',
  TURNSTILE_EXPECTED_HOSTNAMES: 'museum.example',
  RATE_LIMIT_HMAC_SECRET: 'x'.repeat(40),
  ALLOWED_ORIGINS: 'https://museum.example',
}

function makeDeps(overrides: Partial<SubmitDeps> = {}, envOverride: Record<string, string | undefined> = {}) {
  const store = { files: new Map<string, Uint8Array>(), rows: [] as PendingRow[] }
  const deps: SubmitDeps = {
    config: readConfig((k) => ({ ...env, ...envOverride } as Record<string, string | undefined>)[k]),
    verifyTurnstile: vi.fn(async () => ({ success: true, hostname: 'museum.example', action: 'submit_exhibit' })),
    hashKey: vi.fn(async (v: string) => `hash(${v})`),
    submissionExists: vi.fn(async (id: string) => store.rows.some((r) => r.submission_id === id)),
    consumeQuota: vi.fn(async () => ({ allowed: true as const })),
    normalizeImage: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' as const, width: 800, height: 600 })),
    uploadImage: vi.fn(async (path: string, bytes: Uint8Array) => {
      store.files.set(path, bytes)
    }),
    removeImage: vi.fn(async (path: string) => {
      store.files.delete(path)
    }),
    insertPending: vi.fn(async (row: PendingRow) => {
      if (store.rows.some((r) => r.submission_id === row.submission_id)) return 'duplicate' as const
      store.rows.push(row)
      return 'ok' as const
    }),
    newId: () => crypto.randomUUID(),
    log: () => {},
    ...overrides,
  }
  return { deps, store }
}

function input(over: Partial<SubmitInput> = {}, fields: Record<string, unknown> = {}): SubmitInput {
  return {
    fields: {
      title: 'Чашка с отбитой ручкой',
      story: 'Из неё бабушка поила меня чаем каждое лето.',
      authorName: '',
      keptSince: 'С детства',
      imageAlt: 'Белая чашка без ручки на деревянном столе',
      consent: 'true',
      ...fields,
    },
    file: new Uint8Array([0xff, 0xd8, 0xff]),
    turnstileToken: 'token',
    submissionId: SUB_ID,
    honeypot: '',
    clientIp: '203.0.113.7',
    ...over,
  }
}

describe('приём закрыт', () => {
  it('выключен по умолчанию', async () => {
    const { deps } = makeDeps({}, { SUBMISSIONS_ENABLED: undefined })
    expect((await handleSubmission(deps, input())).status).toBe(503)
  })
  it('без Turnstile secret — закрыт, а не без проверки', async () => {
    const { deps } = makeDeps({}, { TURNSTILE_SECRET_KEY: '' })
    const r = await handleSubmission(deps, input())
    expect(r.status).toBe(503)
    expect(deps.verifyTurnstile).not.toHaveBeenCalled()
    expect(deps.uploadImage).not.toHaveBeenCalled()
  })
  it('без HMAC-секрета или слишком короткий — закрыт', async () => {
    expect((await handleSubmission(makeDeps({}, { RATE_LIMIT_HMAC_SECRET: '' }).deps, input())).status).toBe(503)
    expect((await handleSubmission(makeDeps({}, { RATE_LIMIT_HMAC_SECRET: 'short' }).deps, input())).status).toBe(503)
  })
})

describe('защита от ботов', () => {
  it('невалидный Turnstile', async () => {
    const { deps, store } = makeDeps({ verifyTurnstile: vi.fn(async () => ({ success: false, errorCodes: ['invalid-input-response'] })) })
    const r = await handleSubmission(deps, input())
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('bot_check_failed')
    expect(store.rows).toHaveLength(0)
  })
  it('неверный hostname или action', async () => {
    for (const ts of [
      { success: true, hostname: 'evil.example', action: 'submit_exhibit' },
      { success: true, hostname: 'museum.example', action: 'login' },
    ]) {
      const { deps } = makeDeps({ verifyTurnstile: vi.fn(async () => ts) })
      expect((await handleSubmission(deps, input())).status).toBe(400)
    }
  })
  it('пустой токен', async () => {
    const { deps } = makeDeps()
    expect((await handleSubmission(deps, input({ turnstileToken: '' }))).status).toBe(400)
    expect(deps.verifyTurnstile).not.toHaveBeenCalled()
  })
  it('Turnstile недоступен — ошибка, а не пропуск', async () => {
    const { deps } = makeDeps({ verifyTurnstile: vi.fn(async () => Promise.reject(new Error('down'))) })
    expect((await handleSubmission(deps, input())).status).toBe(503)
    expect(deps.uploadImage).not.toHaveBeenCalled()
  })
  it('honeypot', async () => {
    const { deps } = makeDeps()
    expect((await handleSubmission(deps, input({ honeypot: 'http://spam' }))).status).toBe(400)
  })
})

describe('лимиты', () => {
  it('превышение лимита → 429, файл не загружается', async () => {
    const { deps } = makeDeps({ consumeQuota: vi.fn(async () => ({ allowed: false as const, reason: 'per_hour' as const })) })
    const r = await handleSubmission(deps, input())
    expect(r.status).toBe(429)
    expect(r.body.error).toBe('rate_limited')
    expect(deps.uploadImage).not.toHaveBeenCalled()
  })
  it('общий суточный лимит', async () => {
    const { deps } = makeDeps({ consumeQuota: vi.fn(async () => ({ allowed: false as const, reason: 'global_day' as const })) })
    expect((await handleSubmission(deps, input())).body.error).toBe('daily_limit')
  })
  it('ключ лимита — HMAC от IP с версией, сырой IP не уходит в базу', async () => {
    const { deps } = makeDeps()
    await handleSubmission(deps, input())
    expect(deps.hashKey).toHaveBeenCalledWith('v1:203.0.113.7')
    expect(deps.consumeQuota).toHaveBeenCalledWith('hash(v1:203.0.113.7)')
  })
  it('без доверенного IP все попадают в общий строгий ключ', async () => {
    const { deps } = makeDeps()
    await handleSubmission(deps, input({ clientIp: null }))
    expect(deps.hashKey).toHaveBeenCalledWith('v1:unknown-ip')
  })
})

describe('валидация на сервере', () => {
  it('отсутствие согласия', async () => {
    const { deps } = makeDeps()
    const r = await handleSubmission(deps, input({}, { consent: 'false' }))
    expect(r.status).toBe(422)
    expect((r.body.fields as Record<string, string>).consent).toBeTruthy()
  })
  it('без фото', async () => {
    const { deps } = makeDeps()
    expect((await handleSubmission(deps, input({ file: null }))).status).toBe(422)
  })
  it('повреждённое фото — понятное сообщение', async () => {
    const { deps } = makeDeps({ normalizeImage: vi.fn(async () => Promise.reject(new ImageRejectedError('corrupt'))) })
    const r = await handleSubmission(deps, input())
    expect(r.status).toBe(422)
    expect(r.body.error).toBe('image_rejected')
  })
  it('status, image_path и прочие лишние поля из запроса игнорируются', async () => {
    const { deps, store } = makeDeps()
    await handleSubmission(deps, input({}, { status: 'approved', image_path: '../../secret.jpg', id: 'x' }))
    expect(store.rows).toHaveLength(1)
    const row = store.rows[0] as unknown as Record<string, unknown>
    expect(row.status).toBeUndefined()
    expect(row.image_path).toMatch(/^pending\/[0-9a-f-]{36}\.jpg$/)
    expect(row.author_name).toBeNull()
  })
  it('неверный submission ID', async () => {
    const { deps } = makeDeps()
    expect((await handleSubmission(deps, input({ submissionId: '../etc' }))).status).toBe(400)
  })
})

describe('сбои и повторы', () => {
  it('успех: файл и запись созданы', async () => {
    const { deps, store } = makeDeps()
    const r = await handleSubmission(deps, input())
    expect(r.status).toBe(201)
    expect(store.files.size).toBe(1)
    expect(store.rows).toHaveLength(1)
  })
  it('сбой БД после загрузки — файл удаляется, успех не сообщается', async () => {
    const { deps, store } = makeDeps({ insertPending: vi.fn(async () => Promise.reject(new Error('db down'))) })
    const r = await handleSubmission(deps, input())
    expect(r.status).toBe(500)
    expect(r.body.ok).toBe(false)
    expect(store.files.size).toBe(0)
  })
  it('сбой загрузки файла — запись не создаётся', async () => {
    const { deps, store } = makeDeps({ uploadImage: vi.fn(async () => Promise.reject(new Error('storage down'))) })
    expect((await handleSubmission(deps, input())).status).toBe(500)
    expect(store.rows).toHaveLength(0)
  })
  it('повтор того же submission ID не создаёт дубль', async () => {
    const { deps, store } = makeDeps()
    expect((await handleSubmission(deps, input())).status).toBe(201)
    const second = await handleSubmission(deps, input())
    expect(second.status).toBe(200)
    expect(second.body.ok).toBe(true)
    expect(store.rows).toHaveLength(1)
    expect(store.files.size).toBe(1)
  })
  it('конкурентные запросы с одним submission ID → одна запись, лишний файл удалён', async () => {
    const { deps, store } = makeDeps({ submissionExists: vi.fn(async () => false) })
    const [a, b] = await Promise.all([handleSubmission(deps, input()), handleSubmission(deps, input())])
    expect([a.status, b.status].sort()).toEqual([200, 201])
    expect(store.rows).toHaveLength(1)
    expect(store.files.size).toBe(1)
  })
})

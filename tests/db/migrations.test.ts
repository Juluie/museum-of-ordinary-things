// Миграции на настоящем Postgres (PGlite, в памяти) с имитацией ролей Supabase.
// Проверяет права доступа, триггеры, ограничения и атомарные лимиты.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')
const stub = readFileSync(join(import.meta.dirname, 'supabase-stub.sql'), 'utf8')
const migrations = readdirSync(join(root, 'supabase', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(root, 'supabase', 'migrations', f), 'utf8'))

let db: PGlite

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const PATH = (n: number) => `pending/${UUID(n)}.jpg`

async function as<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${role}`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

async function insertExhibit(n: number, extra: Record<string, unknown> = {}) {
  const row = {
    id: UUID(n),
    submission_id: UUID(1000 + n),
    title: `Вещь ${n}`,
    story: 'Эта вещь со мной уже очень давно, и я её храню.',
    image_alt: 'Фотография предмета на столе',
    image_path: PATH(n),
    consent_version: 'test',
    ...extra,
  }
  const cols = Object.keys(row)
  const vals = Object.values(row)
  await as('service_role', () =>
    db.query(
      `insert into public.exhibits (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
      vals,
    ),
  )
}

async function expectDenied(role: string, sql: string) {
  await expect(as(role, () => db.exec(sql))).rejects.toThrow(/permission denied|row-level security/i)
}

beforeEach(async () => {
  db = new PGlite()
  await db.exec(stub)
  for (const m of migrations) await db.exec(m)
})

describe('права доступа', () => {
  for (const role of ['anon', 'authenticated']) {
    it(`${role}: нет SELECT/INSERT/UPDATE/DELETE на exhibits`, async () => {
      await insertExhibit(1)
      await expectDenied(role, 'select * from public.exhibits')
      await expectDenied(
        role,
        `insert into public.exhibits (submission_id,title,story,image_alt,image_path,consent_version)
         values ('${UUID(99)}','Тест','Достаточно длинная история для проверки.','alt','${PATH(99)}','x')`,
      )
      await expectDenied(role, `update public.exhibits set status = 'approved'`)
      await expectDenied(role, 'delete from public.exhibits')
    })

    it(`${role}: нет доступа к admins и лимитам`, async () => {
      await expectDenied(role, 'select * from public.admins')
      await expectDenied(role, `insert into public.admins (user_id) values ('${UUID(5)}')`)
      await expectDenied(role, 'select * from public.submission_rate_limits')
    })

    it(`${role}: не может вызывать серверные функции`, async () => {
      await expectDenied(role, `select public.approve_exhibit('${UUID(1)}')`)
      await expectDenied(role, 'select * from public.get_random_approved_exhibit(null)')
      await expectDenied(role, `select public.consume_submission_quota('${'a'.repeat(64)}', 3, 10, 100)`)
    })
  }

  it('RLS включён на всех прикладных таблицах', async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`,
    )
    expect(r.rows.length).toBeGreaterThanOrEqual(3)
    for (const row of r.rows) expect(row.relrowsecurity, row.relname).toBe(true)
  })

  it('bucket создаётся приватным', async () => {
    const r = await db.query<{ public: boolean }>(`select public from storage.buckets where id = 'exhibit-images'`)
    expect(r.rows[0].public).toBe(false)
  })
})

describe('доверенные значения при создании', () => {
  it('подмена status, номера и дат не работает', async () => {
    await insertExhibit(1, {
      status: 'approved',
      inventory_number: 7,
      approved_at: '2020-01-01',
      created_at: '2000-01-01',
    })
    const r = await db.query<{ status: string; inventory_number: number | null; approved_at: unknown; created_at: Date }>(
      `select status, inventory_number, approved_at, created_at from public.exhibits`,
    )
    expect(r.rows[0].status).toBe('pending')
    expect(r.rows[0].inventory_number).toBeNull()
    expect(r.rows[0].approved_at).toBeNull()
    expect(new Date(r.rows[0].created_at).getFullYear()).toBeGreaterThan(2020)
  })

  it('произвольный image_path отклоняется', async () => {
    for (const bad of ['../../etc/passwd', 'approved/x.jpg', `pending/${UUID(1)}.svg`, 'https://evil.example/x.jpg']) {
      await expect(insertExhibit(1, { image_path: bad })).rejects.toThrow(/check constraint/)
    }
  })

  it('ограничения длины продублированы в базе', async () => {
    await expect(insertExhibit(1, { title: 'A' })).rejects.toThrow(/check constraint/)
    await expect(insertExhibit(2, { story: 'коротко' })).rejects.toThrow(/check constraint/)
    await expect(insertExhibit(3, { story: 'я'.repeat(1501) })).rejects.toThrow(/check constraint/)
    await expect(insertExhibit(4, { author_name: 'я'.repeat(51) })).rejects.toThrow(/check constraint/)
    await insertExhibit(5, { story: 'я'.repeat(1500), title: 'я'.repeat(80) })
  })

  it('повтор submission_id даёт конфликт уникальности', async () => {
    await insertExhibit(1)
    await expect(insertExhibit(2, { submission_id: UUID(1001) })).rejects.toThrow(/duplicate key/)
  })
})

describe('модерация', () => {
  it('одобрение выдаёт номер; снятие с публикации и повторное одобрение сохраняют номер', async () => {
    await insertExhibit(1)
    await insertExhibit(2)
    const ok = await as('service_role', () => db.query<{ a: boolean }>(`select public.approve_exhibit($1) as a`, [UUID(2)]))
    expect(ok.rows[0].a).toBe(true)
    const again = await as('service_role', () => db.query<{ a: boolean }>(`select public.approve_exhibit($1) as a`, [UUID(2)]))
    expect(again.rows[0].a).toBe(false) // уже не pending

    const num = async () =>
      (await db.query<{ n: number; a: unknown; s: string }>(`select inventory_number n, approved_at a, status s from public.exhibits where id=$1`, [UUID(2)])).rows[0]
    expect((await num()).n).toBe(1)

    await as('service_role', () => db.query(`update public.exhibits set status='pending' where id=$1`, [UUID(2)]))
    expect((await num()).a).toBeNull()
    await as('service_role', () => db.query(`select public.approve_exhibit($1)`, [UUID(2)]))
    expect((await num()).n).toBe(1)
  })

  it('нельзя одобрить запись без фото и нельзя оставить pending без фото', async () => {
    await insertExhibit(1)
    await expect(
      as('service_role', () => db.query(`update public.exhibits set image_path = null where id=$1`, [UUID(1)])),
    ).rejects.toThrow(/check constraint/)
    await as('service_role', () =>
      db.query(`update public.exhibits set status='rejected', image_path = null where id=$1`, [UUID(1)]),
    )
    const r = await as('service_role', () => db.query<{ a: boolean }>(`select public.approve_exhibit($1) as a`, [UUID(1)]))
    expect(r.rows[0].a).toBe(false)
  })

  it('текст экспоната неизменяем', async () => {
    await insertExhibit(1)
    await expect(
      as('service_role', () => db.query(`update public.exhibits set story = 'Совсем другая история про вещь' where id=$1`, [UUID(1)])),
    ).rejects.toThrow(/immutable/)
  })
})

describe('случайный экспонат', () => {
  const random = (exclude: string | null) =>
    as('service_role', () =>
      db.query<{ id: string; others_exist: boolean; image_path: string }>(
        `select * from public.get_random_approved_exhibit($1)`,
        [exclude],
      ),
    )

  it('пустая коллекция — ноль строк', async () => {
    await insertExhibit(1) // pending не считается
    expect((await random(null)).rows).toHaveLength(0)
  })

  it('один экспонат: возвращается он же, others_exist=false', async () => {
    await insertExhibit(1)
    await as('service_role', () => db.query(`select public.approve_exhibit($1)`, [UUID(1)]))
    const r = await random(UUID(1))
    expect(r.rows[0].id).toBe(UUID(1))
    expect(r.rows[0].others_exist).toBe(false)
  })

  it('несколько: exclude соблюдается, pending не попадает', async () => {
    for (const n of [1, 2, 3]) await insertExhibit(n)
    for (const n of [1, 2]) await as('service_role', () => db.query(`select public.approve_exhibit($1)`, [UUID(n)]))
    for (let i = 0; i < 20; i++) {
      const r = await random(UUID(1))
      expect(r.rows[0].id).toBe(UUID(2))
      expect(r.rows[0].others_exist).toBe(true)
    }
  })
})

describe('лимиты отправки', () => {
  const key = 'b'.repeat(64)
  const consume = (k = key, hour = 3, day = 10, global = 100) =>
    as('service_role', async () =>
      (await db.query<{ r: string }>(`select public.consume_submission_quota($1,$2,$3,$4) as r`, [k, hour, day, global])).rows[0].r,
    )

  it('3 в час, затем отказ; отказ не увеличивает счётчик', async () => {
    expect(await consume()).toBe('ok')
    expect(await consume()).toBe('ok')
    expect(await consume()).toBe('ok')
    expect(await consume()).toBe('per_hour')
    expect(await consume()).toBe('per_hour')
    const r = await db.query<{ hits: number }>(`select hits from public.submission_rate_limits where bucket = $1`, [`h:${key}`])
    expect(r.rows[0].hits).toBe(3)
  })

  it('суточный лимит на ключ и общий лимит', async () => {
    expect(await consume(key, 100, 2, 100)).toBe('ok')
    expect(await consume(key, 100, 2, 100)).toBe('ok')
    expect(await consume(key, 100, 2, 100)).toBe('per_day')
    const other = 'c'.repeat(64)
    expect(await consume(other, 100, 100, 3)).toBe('ok')
    expect(await consume(other, 100, 100, 3)).toBe('global_day')
  })

  it('отклоняет ключ, похожий на сырой IP', async () => {
    await expect(consume('203.0.113.5')).rejects.toThrow(/invalid rate limit key/)
  })

  it('очистка удаляет старые окна', async () => {
    await consume()
    await db.exec(`update public.submission_rate_limits set window_start = now() - interval '3 days'`)
    const r = await as('service_role', () => db.query<{ n: number }>(`select public.cleanup_submission_rate_limits() n`))
    expect(r.rows[0].n).toBe(3)
  })
})

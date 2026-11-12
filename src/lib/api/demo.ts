// Demo-режим: вымышленные экспонаты из src/demo, никаких сетевых запросов.
import { DEMO_EXHIBITS } from '../../demo/exhibits.ts'
import type { AdminExhibit, ExhibitStatus } from '../../types/exhibit.ts'
import type { AdminAction, AdminApi, AdminList, MuseumApi, RandomResult, SubmitOutcome } from './types.ts'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function createDemoApi(exhibits = DEMO_EXHIBITS, delay = 250): MuseumApi {
  return {
    mode: 'demo',
    async getRandom(excludeId) {
      await wait(delay)
      if (exhibits.length === 0) return { exhibit: null, hasOthers: false } satisfies RandomResult
      const pool = exhibits.filter((e) => e.id !== excludeId)
      const list = pool.length ? pool : exhibits
      const exhibit = list[Math.floor(Math.random() * list.length)]
      return { exhibit, hasOthers: exhibits.length > 1 }
    },
    async getById(id) {
      await wait(delay)
      return exhibits.find((e) => e.id === id) ?? null
    },
    async submit(): Promise<SubmitOutcome> {
      await wait(delay * 3)
      // Ничего не отправляется и не сохраняется.
      return { kind: 'demo' }
    },
  }
}

/** Незащищённый макет админки: данные в памяти вкладки, сбрасываются при перезагрузке. */
export function createDemoAdminApi(): AdminApi {
  const rows: AdminExhibit[] = DEMO_EXHIBITS.map((e, i) => ({
    id: e.id,
    number: i < 4 ? e.number : null,
    title: e.title,
    story: e.story,
    authorName: e.authorName,
    keptSince: e.keptSince,
    imageAlt: e.imageAlt,
    imageUrl: e.imageUrl,
    status: (i < 4 ? 'approved' : 'pending') as ExhibitStatus,
    createdAt: new Date(Date.UTC(2026, 9, 1 + i * 3, 10, 0)).toISOString(),
    approvedAt: i < 4 ? new Date(Date.UTC(2026, 9, 2 + i * 3, 10, 0)).toISOString() : null,
  }))
  return {
    mode: 'demo',
    async whoami() {},
    async list(status, page): Promise<AdminList> {
      await wait(200)
      const items = rows.filter((r) => r.status === status)
      return { items: items.slice((page - 1) * 12, page * 12), total: items.length, page, pageSize: 12 }
    },
    async act(action: AdminAction, id: string) {
      await wait(200)
      const i = rows.findIndex((r) => r.id === id)
      if (i < 0) return
      if (action === 'delete') rows.splice(i, 1)
      else if (action === 'approve') {
        // Номер выдаётся один раз при первой публикации и больше не меняется.
        const number = rows[i].number ?? Math.max(0, ...rows.map((r) => r.number ?? 0)) + 1
        rows[i] = { ...rows[i], status: 'approved', number, approvedAt: new Date().toISOString() }
      }
      else if (action === 'reject') rows[i] = { ...rows[i], status: 'rejected', imageUrl: null }
      else if (action === 'unpublish') rows[i] = { ...rows[i], status: 'pending', approvedAt: null }
    },
  }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError, type AdminAction, type AdminApi, type AdminList } from './types.ts'

export function createLiveAdminApi(client: SupabaseClient, supabaseUrl: string, publishableKey: string): AdminApi {
  async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data } = await client.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new ApiError('unauthorized', 'Сессия закончилась. Войди снова.')
    let res: Response
    try {
      res = await fetch(`${supabaseUrl}/functions/v1/admin-exhibits`, {
        method: 'POST',
        headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      throw new ApiError('network', 'Нет связи с сервером. Попробуй ещё раз.')
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (res.status === 401) throw new ApiError('unauthorized', 'Сессия закончилась. Войди снова.')
    if (res.status === 403) throw new ApiError('forbidden', 'У этого аккаунта нет прав администратора.')
    if (res.status === 409) throw new ApiError('conflict', String(json.message ?? 'Статус записи изменился. Обнови список.'))
    if (!res.ok || json.ok !== true)
      throw new ApiError('server', String(json.message ?? 'Операция не выполнена. Попробуй ещё раз.'))
    return json
  }

  return {
    mode: 'live',
    async whoami() {
      await call({ action: 'whoami' })
    },
    async list(status, page) {
      return (await call({ action: 'list', status, page })) as unknown as AdminList
    },
    async act(action: AdminAction, id: string) {
      await call({ action, id })
    },
  }
}

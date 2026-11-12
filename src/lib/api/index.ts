import type { AppConfig } from '../config.ts'
import { createDemoApi } from './demo.ts'
import { createLiveApi } from './live.ts'
import type { MuseumApi } from './types.ts'

export function createApi(config: AppConfig): MuseumApi {
  if (config.mode === 'demo') return createDemoApi()
  return createLiveApi({ supabaseUrl: config.supabaseUrl, publishableKey: config.publishableKey })
}

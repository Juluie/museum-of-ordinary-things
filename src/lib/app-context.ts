import { createContext, useContext } from 'react'
import type { MuseumApi } from './api/types.ts'
import type { AppConfig } from './config.ts'

export type AppContextValue = { config: AppConfig; api: MuseumApi }

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const v = useContext(AppContext)
  if (!v) throw new Error('useApp outside AppContext')
  return v
}

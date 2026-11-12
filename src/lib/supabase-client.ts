// Supabase-клиент нужен только для входа администратора. Загружается лениво.
import type { SupabaseClient } from '@supabase/supabase-js'

let clientPromise: Promise<SupabaseClient> | null = null

export function getSupabase(url: string, publishableKey: string): Promise<SupabaseClient> {
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    }),
  )
  return clientPromise
}

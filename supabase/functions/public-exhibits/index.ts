// GET /functions/v1/public-exhibits?id=<uuid>
// GET /functions/v1/public-exhibits?random=1&exclude=<uuid>
// Отдаёт только approved-экспонаты и временную ссылку на фото.

import { readConfig } from '../_shared/config.ts'
import { log, serviceClient } from '../_shared/deno-deps.ts'
import { corsHeaders, json } from '../_shared/http.ts'
import { handlePublicRead, type ApprovedRow } from '../_shared/public-core.ts'

const logger = log('public-exhibits')
const SAFE_COLUMNS =
  'id, inventory_number, title, story, author_name, kept_since, image_alt, image_path, image_width, image_height'

Deno.serve(async (req) => {
  const config = readConfig((k) => Deno.env.get(k))
  const cors = corsHeaders(req.headers.get('origin'), config.allowedOrigins)

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'GET') return json(405, { ok: false, error: 'method_not_allowed' }, cors)

  const supabase = serviceClient()
  const bucket = supabase.storage.from(config.bucket)

  try {
    const result = await handlePublicRead(
      {
        ttlSeconds: config.publicSignedUrlTtl,
        now: () => Date.now(),
        async getApprovedById(id) {
          const { data, error } = await supabase
            .from('exhibits')
            .select(SAFE_COLUMNS)
            .eq('id', id)
            .eq('status', 'approved')
            .not('image_path', 'is', null)
            .maybeSingle()
          if (error) throw error
          return (data as ApprovedRow | null) ?? null
        },
        async getRandomApproved(excludeId) {
          const { data, error } = await supabase.rpc('get_random_approved_exhibit', { p_exclude: excludeId })
          if (error) throw error
          const rows = (data ?? []) as ApprovedRow[]
          return rows[0] ?? null
        },
        async signUrl(path, ttl) {
          const { data, error } = await bucket.createSignedUrl(path, ttl)
          if (error || !data) throw error ?? new Error('sign failed')
          return data.signedUrl
        },
      },
      new URL(req.url).searchParams,
    )
    return json(result.status, result.body, cors)
  } catch (e) {
    logger('read_failed', { message: e instanceof Error ? e.message.slice(0, 200) : 'unknown' })
    return json(500, { ok: false, error: 'server_error' }, cors)
  }
})

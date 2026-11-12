// POST /functions/v1/admin-exhibits  { action, ... }
// Только для пользователей из таблицы public.admins.

import { readConfig } from '../_shared/config.ts'
import { log, serviceClient } from '../_shared/deno-deps.ts'
import { handleAdmin, type AdminRow } from '../_shared/admin-core.ts'
import { BodyTooLargeError, corsHeaders, isOriginAllowed, json, readLimitedBody } from '../_shared/http.ts'

const logger = log('admin-exhibits')
const COLUMNS =
  'id, inventory_number, title, story, author_name, kept_since, image_alt, image_path, status, created_at, approved_at'

Deno.serve(async (req) => {
  const config = readConfig((k) => Deno.env.get(k))
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin, config.allowedOrigins)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: isOriginAllowed(origin, config.allowedOrigins) ? 204 : 403, headers: cors })
  }
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, cors)
  if (!isOriginAllowed(origin, config.allowedOrigins)) return json(403, { ok: false, error: 'forbidden_origin' }, cors)

  let body: Record<string, unknown>
  try {
    const raw = await readLimitedBody(req, 16 * 1024)
    body = JSON.parse(new TextDecoder().decode(raw))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
  } catch (e) {
    if (e instanceof BodyTooLargeError) return json(413, { ok: false, error: 'payload_too_large' }, cors)
    return json(400, { ok: false, error: 'bad_request' }, cors)
  }

  const supabase = serviceClient()
  const bucket = supabase.storage.from(config.bucket)

  try {
    const result = await handleAdmin(
      {
        ttlSeconds: config.adminSignedUrlTtl,
        async getUserId(token) {
          const { data, error } = await supabase.auth.getUser(token)
          if (error || !data.user) return null
          return data.user.id
        },
        async isAdmin(userId) {
          const { data, error } = await supabase.from('admins').select('user_id').eq('user_id', userId).maybeSingle()
          if (error) throw error
          return !!data
        },
        async list(status, offset, limit) {
          const { data, error, count } = await supabase
            .from('exhibits')
            .select(COLUMNS, { count: 'exact' })
            .eq('status', status)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1)
          if (error) throw error
          return { items: (data ?? []) as AdminRow[], total: count ?? 0 }
        },
        async getRow(id) {
          const { data, error } = await supabase.from('exhibits').select(COLUMNS).eq('id', id).maybeSingle()
          if (error) throw error
          return (data as AdminRow | null) ?? null
        },
        async setStatus(id, from, to) {
          const { data, error } = await supabase
            .from('exhibits')
            .update({ status: to })
            .eq('id', id)
            .in('status', from)
            .select('id')
          if (error) throw error
          return (data ?? []).length === 1
        },
        async approve(id) {
          const { data, error } = await supabase.rpc('approve_exhibit', { p_id: id })
          if (error) throw error
          return data === true
        },
        async setImagePath(id, path) {
          const { error } = await supabase.from('exhibits').update({ image_path: path }).eq('id', id)
          if (error) throw error
        },
        async removeFile(path) {
          const { error } = await bucket.remove([path])
          if (error) throw error
        },
        async moveFile(from, to) {
          const { error } = await bucket.move(from, to)
          if (error) throw error
        },
        async deleteRow(id) {
          const { error } = await supabase.from('exhibits').delete().eq('id', id)
          if (error) throw error
        },
        async signUrl(path, ttl) {
          const { data, error } = await bucket.createSignedUrl(path, ttl)
          if (error || !data) throw error ?? new Error('sign failed')
          return data.signedUrl
        },
        randomSuffix: () => crypto.randomUUID().replaceAll('-', '').slice(0, 16),
        log: logger,
      },
      req.headers.get('authorization'),
      body,
    )
    return json(result.status, result.body, cors)
  } catch (e) {
    logger('admin_failed', { message: e instanceof Error ? e.message.slice(0, 200) : 'unknown' })
    return json(500, { ok: false, error: 'server_error' }, cors)
  }
})

// Worker do Gestão à Vista: serve o app (assets do Vite, com fallback de SPA),
// expõe as rotas internas da integração com o Santarém Sistemas e roda os Cron Triggers.

import type { Env, ExecutionContext, ScheduledController } from './types'
import { Supabase, SupabaseError, eq } from './supabase/client'
import { ErpClient, ErpError } from './erp/client'
import { buildSalesQuery, isIsoDate, validateRange } from './erp/queries'
import { INTEGRATION_ID, TIME_ZONE, activeMappings, dailyRange, loadIntegration, publishRange, recurringRange, runSync, todayIn, type Trigger } from './erp/sync'

export const CRON_RECURRING = '*/5 * * * *'
export const CRON_DAILY = '30 9 * * *' // 06:30 em Belém

class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })

/** Rotas administrativas: sessão Supabase válida + perfil admin ativo. */
async function requireAdmin(request: Request, db: Supabase) {
  const auth = request.headers.get('Authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) throw new HttpError(401, 'Sessão ausente. Entre novamente no admin.')
  const user = await db.getUser(token)
  if (!user) throw new HttpError(401, 'Sessão inválida ou expirada. Entre novamente no admin.')
  const [profile] = await db.select<{ role: string; active: boolean }>('profiles', `id=eq.${eq(user.id)}&select=role,active`)
  if (!profile || profile.role !== 'admin' || profile.active !== true) throw new HttpError(403, 'Acesso restrito a administradores ativos.')
  return user
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) return {}
  const text = await request.text()
  if (text.length > 10000) throw new HttpError(413, 'Corpo da requisição grande demais.')
  try { const v = text ? JSON.parse(text) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {} } catch { throw new HttpError(400, 'JSON inválido.') }
}

const nextRun = (now = new Date()) => { const t = new Date(now); t.setUTCSeconds(0, 0); t.setUTCMinutes(Math.floor(t.getUTCMinutes() / 5) * 5 + 5); return t.toISOString() }

async function status(env: Env, db: Supabase) {
  const integration = await loadIntegration(db)
  const [mapped, unmatchedRows, unmatchedOpen, staged, published, errors, last] = await Promise.all([
    db.count('erp_seller_mappings', `integration_id=eq.${INTEGRATION_ID}&active=is.true&select=id`),
    db.count('erp_unmatched_sales', `integration_id=eq.${INTEGRATION_ID}&resolved_at=is.null&select=id`),
    db.selectAll<{ erp_employee_id: string }>('erp_unmatched_sales', `integration_id=eq.${INTEGRATION_ID}&resolved_at=is.null&select=erp_employee_id`),
    db.count('erp_sales_daily', `integration_id=eq.${INTEGRATION_ID}&select=id`),
    db.count('sales_daily', `source=eq.erp&select=id`),
    db.select('erp_sync_logs', `status=eq.error&order=started_at.desc&limit=5&select=id,trigger,started_at,error`),
    db.select('erp_sync_logs', `trigger=not.in.(test,query)&order=started_at.desc&limit=1&select=id,trigger,status,started_at,finished_at,rows_staged,rows_published,error`),
  ])
  const { lock_until, ...rest } = integration
  return {
    integration: { ...rest, running: Boolean(lock_until && lock_until > new Date().toISOString()) },
    secrets: { ERP_TOKEN: Boolean(env.ERP_TOKEN), SUPABASE_URL: Boolean(env.SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SUPABASE_SERVICE_ROLE_KEY) },
    config: { api_url: env.ERP_API_URL || 'padrão', auth_scheme: env.ERP_AUTH_SCHEME || 'Authentication', send_x_token: env.ERP_SEND_X_TOKEN === 'true', pagination: env.ERP_PAGINATION === 'body' ? 'body' : 'query', page_size: Number(env.ERP_PAGE_SIZE || 100) },
    counts: { mapped, unmatched_rows: unmatchedRows, unmatched_employees: new Set(unmatchedOpen.map(r => r.erp_employee_id)).size, staged, published },
    schedule: { time_zone: TIME_ZONE, today: todayIn(), recurring: 'a cada 5 minutos (ontem e hoje)', daily: `06:30, reprocessa os últimos ${integration.reprocess_days} dias`, next_run: integration.enabled ? nextRun() : null },
    last_run: last[0] ?? null,
    recent_errors: errors,
  }
}

/** Testa autenticação e formato da resposta com a consulta de hoje, 1 registro. */
async function testConnection(env: Env, db: Supabase, userId: string) {
  const integration = await loadIntegration(db)
  const started = Date.now()
  const t = todayIn()
  const [log] = await db.insert<{ id: string }>('erp_sync_logs', { trigger: 'test', status: 'running', range_start: t, range_end: t, requested_by: userId })
  try {
    const erp = new ErpClient(env)
    const page = await erp.page(buildSalesQuery({ start: t, end: t }, integration.company_id), 0, 1)
    const out = { ok: true, http_status: page.status, duration_ms: Date.now() - started, response: page.shape, rows_in_sample: page.rows.length, expected_columns: ['idpessoafuncionario', 'dia', 'nome', 'valtotalbruto', 'valdescontoliquido', 'valdescontocashback', 'valacrescimo', 'valtotalliquido', 'valordevolucao', 'valortotal', 'quantidade_vendas', 'valor_medio_venda'] }
    const missing = page.rows.length ? out.expected_columns.filter(c => !page.shape.columns.map(x => x.toLowerCase()).includes(c)) : []
    await db.update('erp_sync_logs', `id=eq.${eq(log.id)}`, { status: missing.length ? 'partial' : 'success', finished_at: new Date().toISOString(), duration_ms: out.duration_ms, requests: erp.requests, pages: 1, rows_received: page.rows.length, details: { shape: page.shape, missing } })
    return { ...out, missing_columns: missing, message: missing.length ? 'Conectou, mas faltam colunas: ' + missing.join(', ') : page.rows.length ? 'Conexão e formato OK.' : 'Conexão OK. Sem vendas hoje para conferir as colunas.' }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await db.update('erp_sync_logs', `id=eq.${eq(log.id)}`, { status: 'error', finished_at: new Date().toISOString(), duration_ms: Date.now() - started, error: message, details: { kind: e instanceof ErpError ? e.kind : 'internal' } })
    return { ok: false, kind: e instanceof ErpError ? e.kind : 'internal', http_status: e instanceof ErpError ? e.status : 0, duration_ms: Date.now() - started, message }
  }
}

async function unmatched(db: Supabase) {
  const rows = await db.selectAll<{ erp_employee_id: string; erp_employee_name: string | null; sale_date: string; valortotal: number; quantidade_vendas: number }>('erp_unmatched_sales', `integration_id=eq.${INTEGRATION_ID}&resolved_at=is.null&order=sale_date.desc&select=erp_employee_id,erp_employee_name,sale_date,valortotal,quantidade_vendas`)
  const byEmployee = new Map<string, { erp_employee_id: string; erp_employee_name: string; days: number; first_date: string; last_date: string; valortotal: number; quantidade_vendas: number }>()
  for (const r of rows) {
    const cur = byEmployee.get(r.erp_employee_id) ?? { erp_employee_id: r.erp_employee_id, erp_employee_name: r.erp_employee_name || 'NENHUM', days: 0, first_date: r.sale_date, last_date: r.sale_date, valortotal: 0, quantidade_vendas: 0 }
    cur.days++; cur.valortotal = Math.round((cur.valortotal + Number(r.valortotal)) * 100) / 100; cur.quantidade_vendas += Number(r.quantidade_vendas)
    if (r.sale_date < cur.first_date) cur.first_date = r.sale_date
    if (r.sale_date > cur.last_date) cur.last_date = r.sale_date
    byEmployee.set(r.erp_employee_id, cur)
  }
  return { employees: [...byEmployee.values()].sort((a, b) => b.valortotal - a.valortotal) }
}

/** Associa um código de funcionário do ERP a uma colaboradora existente (nunca cria colaboradora). */
async function saveMapping(db: Supabase, body: Record<string, unknown>, userId: string) {
  const code = String(body.erp_employee_id ?? '').trim()
  const sellerId = String(body.seller_id ?? '').trim()
  if (!/^\d{1,18}$/.test(code) || code === '0') throw new HttpError(400, 'Código do funcionário inválido.')
  if (!/^[0-9a-f-]{36}$/i.test(sellerId)) throw new HttpError(400, 'Colaboradora inválida.')
  const [seller] = await db.select<{ id: string; full_name: string; active: boolean; sector: string | null }>('sellers', `id=eq.${eq(sellerId)}&select=id,full_name,active,sector`)
  if (!seller) throw new HttpError(404, 'Colaboradora não encontrada.')
  if (!seller.active) throw new HttpError(400, 'Colaboradora inativa.')
  const [staged] = await db.select<{ erp_employee_name: string }>('erp_sales_daily', `integration_id=eq.${INTEGRATION_ID}&erp_employee_id=eq.${eq(code)}&select=erp_employee_name&limit=1`)
  await db.upsert('erp_seller_mappings', [{ integration_id: INTEGRATION_ID, erp_employee_id: code, erp_employee_name: staged?.erp_employee_name ?? (typeof body.erp_employee_name === 'string' ? body.erp_employee_name.slice(0, 120) : null), seller_id: sellerId, active: true, created_by: userId }], 'integration_id,erp_employee_id')
  await db.update('erp_sales_daily', `integration_id=eq.${INTEGRATION_ID}&erp_employee_id=eq.${eq(code)}`, { seller_id: sellerId })
  const resolved = await db.update('erp_unmatched_sales', `integration_id=eq.${INTEGRATION_ID}&erp_employee_id=eq.${eq(code)}&resolved_at=is.null`, { resolved_at: new Date().toISOString() })
  const integration = await loadIntegration(db)
  let published = 0
  if (integration.publish_enabled && integration.publish_from) {
    const t = todayIn()
    const start = integration.publish_from > t ? t : integration.publish_from
    published = await publishRange(db, { start, end: t }, integration.publish_from, await activeMappings(db), [code])
  }
  await db.insert('erp_sync_logs', { trigger: 'mapping', status: 'success', finished_at: new Date().toISOString(), duration_ms: 0, rows_published: published, requested_by: userId, details: { erp_employee_id: code, seller_id: sellerId, resolved: resolved.length } })
  return { ok: true, message: `Código ${code} vinculado a ${seller.full_name}. ${resolved.length} pendência(s) resolvida(s)${published ? `, ${published} dia(s) publicado(s) no ranking` : ''}. O setor da colaboradora não foi alterado.` }
}

async function removeMapping(db: Supabase, body: Record<string, unknown>) {
  const code = String(body.erp_employee_id ?? '').trim()
  if (!/^\d{1,18}$/.test(code)) throw new HttpError(400, 'Código do funcionário inválido.')
  await db.update('erp_seller_mappings', `integration_id=eq.${INTEGRATION_ID}&erp_employee_id=eq.${eq(code)}`, { active: false })
  await db.update('erp_sales_daily', `integration_id=eq.${INTEGRATION_ID}&erp_employee_id=eq.${eq(code)}`, { seller_id: null })
  return { ok: true, message: `Vínculo do código ${code} desativado. Os dados já publicados no ranking foram mantidos.` }
}

async function saveSettings(db: Supabase, body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {}
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (body.reprocess_days !== undefined) { const n = Number(body.reprocess_days); if (!Number.isInteger(n) || n < 1 || n > 31) throw new HttpError(400, 'Reprocessamento: de 1 a 31 dias.'); patch.reprocess_days = n }
  if (body.publish_from !== undefined) { if (body.publish_from !== null && !isIsoDate(body.publish_from)) throw new HttpError(400, 'Data de início da publicação inválida.'); patch.publish_from = body.publish_from }
  if (typeof body.publish_enabled === 'boolean') {
    if (body.publish_enabled && body.confirm !== 'PUBLICAR') throw new HttpError(400, 'Para publicar no ranking, confirme digitando PUBLICAR.')
    patch.publish_enabled = body.publish_enabled
  }
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nada para alterar.')
  const current = await loadIntegration(db)
  if ((patch.publish_enabled ?? current.publish_enabled) && !(patch.publish_from ?? current.publish_from)) throw new HttpError(400, 'Informe a partir de qual data o ERP passa a alimentar o ranking.')
  patch.updated_at = new Date().toISOString()
  await db.update('erp_integrations', `id=eq.${INTEGRATION_ID}`, patch)
  return { ok: true, message: 'Configuração salva.' }
}

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  const db = new Supabase(env)
  const user = await requireAdmin(request, db)
  const method = request.method
  const url = new URL(request.url)
  if (path === '/api/erp/status' && method === 'GET') return json(await status(env, db))
  if (path === '/api/erp/test' && method === 'POST') return json(await testConnection(env, db, user.id))
  if (path === '/api/erp/sync' && method === 'POST') {
    const body = await readJson(request)
    const mode = body.mode === 'query' ? 'query' : body.mode === 'initial' ? 'initial' : 'manual'
    let range
    try { range = validateRange(body.start ?? todayIn(), body.end ?? body.start ?? todayIn()) } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : 'Período inválido.') }
    if (mode === 'query' && range.end > todayIn()) throw new HttpError(400, 'Período no futuro.')
    const result = await runSync(env, { trigger: mode as Trigger, range, requestedBy: user.id })
    return json(result, result.status === 'error' ? 502 : 200)
  }
  if (path === '/api/erp/logs' && method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 200)
    return json({ logs: await db.select('erp_sync_logs', `order=started_at.desc&limit=${limit}&select=id,trigger,status,range_start,range_end,started_at,finished_at,duration_ms,requests,pages,rows_received,rows_staged,rows_unmatched,rows_published,error,details`) })
  }
  if (path === '/api/erp/unmatched' && method === 'GET') return json(await unmatched(db))
  if (path === '/api/erp/mappings' && method === 'GET') return json({ mappings: await db.select('erp_seller_mappings', `integration_id=eq.${INTEGRATION_ID}&active=is.true&order=erp_employee_id.asc&select=erp_employee_id,erp_employee_name,seller_id,created_at`) })
  if (path === '/api/erp/mappings' && method === 'POST') return json(await saveMapping(db, await readJson(request), user.id))
  if (path === '/api/erp/mappings' && method === 'DELETE') return json(await removeMapping(db, await readJson(request)))
  if (path === '/api/erp/settings' && method === 'POST') return json(await saveSettings(db, await readJson(request)))
  throw new HttpError(404, 'Rota não encontrada.')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      try {
        if (!url.pathname.startsWith('/api/erp/')) throw new HttpError(404, 'Rota não encontrada.')
        return await handleApi(request, env, url.pathname)
      } catch (e) {
        if (e instanceof HttpError) return json({ ok: false, message: e.message }, e.status)
        if (e instanceof SupabaseError) return json({ ok: false, message: e.message }, 500)
        return json({ ok: false, message: e instanceof Error ? e.message : 'Erro interno.' }, 500)
      }
    }
    // App (Vite). O próprio binding aplica o fallback de SPA configurado em wrangler.jsonc.
    return env.ASSETS.fetch(request)
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.ERP_TOKEN || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return
    const run = async () => {
      const now = new Date(controller.scheduledTime)
      if (controller.cron === CRON_DAILY) {
        const integration = await loadIntegration(new Supabase(env))
        await runSync(env, { trigger: 'daily', range: dailyRange(integration.reprocess_days, now) })
      } else await runSync(env, { trigger: 'cron', range: recurringRange(now) })
    }
    ctx.waitUntil(run().catch(e => console.error('Sincronização ERP falhou:', e instanceof Error ? e.message : e)))
  },
}

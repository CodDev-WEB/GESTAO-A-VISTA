// Sincronização Santarém Sistemas -> Supabase.
//
// 1. Consulta o ERP (consulta fixa, paginada, com controle de taxa).
// 2. Valida cada registro. Qualquer registro inválido ou página faltando = nada é gravado em sales_daily.
// 3. Grava o espelho em erp_sales_daily e as pendências em erp_unmatched_sales.
// 4. Só se a publicação estiver ativa: consolida por colaboradora e dia e faz UPSERT em sales_daily
//    (restrição única seller_id + sale_date), apenas a partir de publish_from.
// Nada é apagado: registros que sumiram do ERP num período consultado por completo são zerados.

import type { Env } from '../types'
import { Supabase, eq, type Row } from '../supabase/client'
import { ErpClient, ErpError, type RawRow } from './client'
import { addDays, buildRecentSalesQuery, buildSalesQuery, isIsoDate, splitRange, validateRange, type DateRange } from './queries'

export const INTEGRATION_ID = 'santarem'
export const TIME_ZONE = 'America/Belem'
const LOCK_MINUTES = 10

export type Trigger = 'cron' | 'daily' | 'manual' | 'initial' | 'test' | 'query' | 'mapping'

export type Integration = {
  id: string; company_id: number; enabled: boolean; publish_enabled: boolean; publish_from: string | null; reprocess_days: number
  last_sync_at: string | null; last_success_at: string | null; last_status: string | null; last_error: string | null; lock_until: string | null
}

export type ErpSale = {
  erp_employee_id: string; erp_employee_name: string; sale_date: string
  valtotalbruto: number; valdescontoliquido: number; valdescontocashback: number; valacrescimo: number
  valtotalliquido: number; valordevolucao: number; valortotal: number; quantidade_vendas: number; valor_medio_venda: number
}

type Mapping = { erp_employee_id: string; seller_id: string; active: boolean }

/** Data de hoje no fuso da loja (America/Belem, UTC-3 o ano todo). */
export function todayIn(tz = TIME_ZONE, at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Número vindo do ERP: aceita 1234.5, "1234.5" e "1.234,56". */
export function toNumber(value: unknown, field: string): number {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') { if (Number.isFinite(value)) return value; throw new Error(`${field} não é um número finito.`) }
  if (typeof value === 'string') {
    let s = value.trim()
    if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(s) || /^-?\d+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
    const n = Number(s)
    if (s !== '' && Number.isFinite(n)) return n
  }
  throw new Error(`${field} inválido: ${JSON.stringify(value)}`)
}

/** Data vinda do ERP: "2026-11-10", "2026-11-10T00:00:00…" ou "10/11/2026". */
export function toDate(value: unknown): string {
  const s = String(value ?? '').trim()
  const iso = s.slice(0, 10)
  if (isIsoDate(iso)) return iso
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br && isIsoDate(`${br[3]}-${br[2]}-${br[1]}`)) return `${br[3]}-${br[2]}-${br[1]}`
  throw new Error(`dia inválido: ${JSON.stringify(value)}`)
}

const pick = (row: RawRow, key: string) => row[key] ?? row[key.toUpperCase()] ?? row[key.replace('ca', 'ça')]

/** Converte e valida um registro. Lança erro com o motivo quando algo não confere. */
export function parseRow(row: RawRow, range: DateRange): ErpSale {
  const id = String(pick(row, 'idpessoafuncionario') ?? '').trim().replace(/\.0+$/, '')
  if (!/^\d+$/.test(id)) throw new Error(`idpessoafuncionario inválido: ${JSON.stringify(pick(row, 'idpessoafuncionario'))}`)
  const sale_date = toDate(pick(row, 'dia'))
  if (sale_date < range.start || sale_date > range.end) throw new Error(`dia ${sale_date} fora do período consultado`)
  const n = (k: string) => toNumber(pick(row, k), k)
  const sale: ErpSale = {
    erp_employee_id: id,
    erp_employee_name: String(pick(row, 'nome') ?? '').trim() || 'NENHUM',
    sale_date,
    valtotalbruto: round2(n('valtotalbruto')),
    valdescontoliquido: round2(n('valdescontoliquido')),
    valdescontocashback: round2(n('valdescontocashback')),
    valacrescimo: round2(n('valacrescimo')),
    valtotalliquido: round2(n('valtotalliquido')),
    valordevolucao: round2(Math.abs(n('valordevolucao'))),
    valortotal: round2(n('valortotal')),
    quantidade_vendas: n('quantidade_vendas'),
    valor_medio_venda: round2(n('valor_medio_venda')),
  }
  if (!Number.isInteger(sale.quantidade_vendas) || sale.quantidade_vendas < 0) throw new Error(`quantidade_vendas inválida: ${sale.quantidade_vendas}`)
  // Garante que a devolução foi subtraída exatamente uma vez.
  if (Math.abs(sale.valortotal - (sale.valtotalliquido - sale.valordevolucao)) > 0.02) throw new Error(`valortotal (${sale.valortotal}) ≠ valtotalliquido (${sale.valtotalliquido}) − valordevolucao (${sale.valordevolucao})`)
  if (sale.valtotalliquido < 0) throw new Error(`valtotalliquido negativo (${sale.valtotalliquido})`)
  return sale
}

/**
 * A consulta agrupa por funcionário e dia, então cada par aparece uma vez só.
 * Repetição indica páginas sobrepostas: somar duplicaria o faturamento, por isso vira erro.
 */
function findDuplicates(sales: ErpSale[]): string[] {
  const seen = new Set<string>(), dup: string[] = []
  for (const s of sales) { const key = s.erp_employee_id + '|' + s.sale_date; if (seen.has(key)) dup.push(`Funcionário ${s.erp_employee_id} repetido em ${s.sale_date} (paginação inconsistente)`); seen.add(key) }
  return dup
}

export type RecentSale = { at: string; employee_id: string; name: string; value: number }

/** Lê as últimas vendas e guarda a lista curta para o rodapé da TV. Falha aqui não afeta a sincronização. */
export async function refreshRecentSales(db: Supabase, erp: ErpClient, companyId: number, mappings: Map<string, string>): Promise<number> {
  const { rows } = await erp.page(buildRecentSalesQuery(todayIn(), companyId), 0, 5)
  const sellerIds = [...new Set(rows.map(r => mappings.get(String(pick(r, 'idpessoafuncionario') ?? '').replace(/\.0+$/, ''))).filter(Boolean))] as string[]
  const names = new Map<string, string>()
  if (sellerIds.length) for (const s of await db.select<{ id: string; full_name: string }>('sellers', `id=in.(${sellerIds.map(eq).join(',')})&select=id,full_name`)) names.set(s.id, s.full_name)
  const list: RecentSale[] = rows.slice(0, 5).map(r => {
    const id = String(pick(r, 'idpessoafuncionario') ?? '').trim().replace(/\.0+$/, '')
    const at = String(pick(r, 'datahora') ?? '').trim()
    if (!/^\d+$/.test(id) || !/^\d{4}-\d{2}-\d{2}|^\d{2}\/\d{2}\/\d{4}/.test(at)) throw new Error('Última venda com dados inválidos.')
    const seller = mappings.get(id)
    return { at: at.slice(0, 19), employee_id: id, name: (seller && names.get(seller)) || String(pick(r, 'nome') ?? '').trim() || 'NENHUM', value: round2(toNumber(pick(r, 'valor'), 'valor')) }
  })
  await db.update('erp_integrations', `id=eq.${INTEGRATION_ID}`, { recent_sales: list, recent_sales_at: new Date().toISOString() })
  return list.length
}

export async function loadIntegration(db: Supabase): Promise<Integration> {
  const [row] = await db.select<Integration>('erp_integrations', `id=eq.${INTEGRATION_ID}&select=*`)
  if (!row) throw new Error('Integração não cadastrada. Execute a migração 20261113150000_erp_integration.sql.')
  return row
}

async function acquireLock(db: Supabase, owner: string): Promise<boolean> {
  const now = new Date()
  const until = new Date(now.getTime() + LOCK_MINUTES * 60000).toISOString()
  const rows = await db.update('erp_integrations', `id=eq.${INTEGRATION_ID}&or=(lock_until.is.null,lock_until.lt.${eq(now.toISOString())})`, { lock_until: until, lock_owner: owner })
  return rows.length === 1
}

async function releaseLock(db: Supabase, owner: string) {
  await db.update('erp_integrations', `id=eq.${INTEGRATION_ID}&lock_owner=eq.${eq(owner)}`, { lock_until: null, lock_owner: null })
}

export async function activeMappings(db: Supabase): Promise<Map<string, string>> {
  const rows = await db.selectAll<Mapping>('erp_seller_mappings', `integration_id=eq.${INTEGRATION_ID}&active=is.true&select=erp_employee_id,seller_id,active`)
  return new Map(rows.map(r => [r.erp_employee_id, r.seller_id]))
}

export type SyncOptions = { trigger: Trigger; range: DateRange; requestedBy?: string; fetcher?: typeof fetch }
export type SyncResult = {
  status: 'success' | 'partial' | 'error' | 'skipped'; logId?: string; message: string
  range: DateRange; requests: number; pages: number; received: number; staged: number; unmatched: number; published: number
  rows?: (ErpSale & { seller_id: string | null })[]; errors?: string[]
}

/** Consulta o ERP (todas as páginas, em blocos de até 31 dias) e valida os registros. */
export async function fetchErpSales(erp: ErpClient, range: DateRange, companyId: number) {
  const out: ErpSale[] = []
  const errors: string[] = []
  let pages = 0, complete = true
  const notes: string[] = []
  for (const chunk of splitRange(range)) {
    const res = await erp.all(buildSalesQuery(chunk, companyId))
    pages += res.pages
    if (!res.complete) complete = false
    if (res.note) notes.push(`${chunk.start}..${chunk.end}: ${res.note}`)
    res.rows.forEach((raw, i) => {
      try { out.push(parseRow(raw, chunk)) } catch (e) { errors.push(`Registro ${i + 1} (${chunk.start}..${chunk.end}): ${e instanceof Error ? e.message : String(e)}`) }
    })
  }
  errors.push(...findDuplicates(out))
  return { sales: out, received: out.length + errors.length, errors, pages, complete, notes }
}

/**
 * Executa uma sincronização. trigger 'query' só consulta (nada é gravado além do log).
 * cron/daily não rodam com a integração desligada.
 */
export async function runSync(env: Env, opts: SyncOptions): Promise<SyncResult> {
  const range = validateRange(opts.range.start, opts.range.end)
  const db = new Supabase(env)
  const integration = await loadIntegration(db)
  const base = { range, requests: 0, pages: 0, received: 0, staged: 0, unmatched: 0, published: 0 }
  if ((opts.trigger === 'cron' || opts.trigger === 'daily') && !integration.enabled) return { ...base, status: 'skipped', message: 'Sincronização automática desligada.' }

  const owner = crypto.randomUUID()
  if (!(await acquireLock(db, owner))) {
    if (opts.trigger !== 'cron') await db.insert('erp_sync_logs', { trigger: opts.trigger, status: 'skipped', range_start: range.start, range_end: range.end, finished_at: new Date().toISOString(), duration_ms: 0, error: 'Outra sincronização em andamento.', requested_by: opts.requestedBy ?? null })
    return { ...base, status: 'skipped', message: 'Outra sincronização está em andamento. Tente de novo em alguns minutos.' }
  }

  const started = Date.now()
  const [log] = await db.insert<{ id: string }>('erp_sync_logs', { trigger: opts.trigger, status: 'running', range_start: range.start, range_end: range.end, requested_by: opts.requestedBy ?? null })
  const result: SyncResult = { ...base, status: 'success', logId: log.id, message: '' }
  const details: Record<string, unknown> = {}
  try {
    const erp = new ErpClient(env, opts.fetcher)
    const fetched = await fetchErpSales(erp, range, integration.company_id).finally(() => { result.requests = erp.requests })
    result.pages = fetched.pages
    result.received = fetched.received
    if (fetched.notes.length) details.notes = fetched.notes
    if (fetched.errors.length) {
      result.errors = fetched.errors.slice(0, 20)
      throw new Error(`${fetched.errors.length} registro(s) do ERP com dados inválidos. Nada foi gravado. ${fetched.errors[0]}`)
    }

    const mappings = await activeMappings(db)
    const rows = fetched.sales.map(s => ({ ...s, seller_id: mappings.get(s.erp_employee_id) ?? null }))

    if (opts.trigger === 'query') {
      result.rows = rows
      result.message = `${rows.length} registro(s) consultado(s). Nada foi gravado.`
    } else {
      const now = new Date().toISOString()
      // Espelho do ERP.
      result.staged = await db.upsert('erp_sales_daily', rows.map(r => ({ ...r, integration_id: INTEGRATION_ID, synced_at: now, sync_log_id: log.id })), 'integration_id,erp_employee_id,sale_date')
      // Zera no espelho o que sumiu do ERP (só com o período lido por completo).
      if (fetched.complete) {
        const present = new Set(rows.map(r => r.erp_employee_id + '|' + r.sale_date))
        const stale = (await db.selectAll<{ erp_employee_id: string; sale_date: string; erp_employee_name: string | null; seller_id: string | null }>('erp_sales_daily', `integration_id=eq.${INTEGRATION_ID}&sale_date=gte.${eq(range.start)}&sale_date=lte.${eq(range.end)}&or=(valortotal.neq.0,quantidade_vendas.neq.0,valtotalliquido.neq.0,valordevolucao.neq.0)&select=erp_employee_id,sale_date,erp_employee_name,seller_id`))
          .filter(r => !present.has(r.erp_employee_id + '|' + r.sale_date))
        if (stale.length) {
          await db.upsert('erp_sales_daily', stale.map(r => ({ integration_id: INTEGRATION_ID, erp_employee_id: r.erp_employee_id, sale_date: r.sale_date, erp_employee_name: r.erp_employee_name, seller_id: mappings.get(r.erp_employee_id) ?? null, valtotalbruto: 0, valdescontoliquido: 0, valdescontocashback: 0, valacrescimo: 0, valtotalliquido: 0, valordevolucao: 0, valortotal: 0, quantidade_vendas: 0, valor_medio_venda: 0, synced_at: now, sync_log_id: log.id })), 'integration_id,erp_employee_id,sale_date')
          details.zeroed = stale.length
        }
      }
      // Pendências: funcionários sem vínculo com movimento.
      const pending = rows.filter(r => !r.seller_id && (r.valortotal !== 0 || r.quantidade_vendas > 0 || r.valordevolucao !== 0))
      if (pending.length) await db.upsert('erp_unmatched_sales', pending.map(r => ({ integration_id: INTEGRATION_ID, erp_employee_id: r.erp_employee_id, erp_employee_name: r.erp_employee_name, sale_date: r.sale_date, valortotal: r.valortotal, quantidade_vendas: r.quantidade_vendas, last_seen_at: now, resolved_at: null })), 'integration_id,erp_employee_id,sale_date')
      result.unmatched = pending.length

      // Publicação nos rankings.
      if (!fetched.complete) {
        result.status = 'partial'
        details.publish = 'Não publicado: leitura do ERP incompleta.'
      } else if (integration.publish_enabled && integration.publish_from) {
        result.published = await publishRange(db, { start: range.start, end: range.end }, integration.publish_from, mappings)
      } else details.publish = 'Publicação desligada: dados ficaram só no espelho do ERP.'
      result.message = `${result.staged} registro(s) do ERP gravado(s); ${result.unmatched} sem vínculo; ${result.published} publicado(s) no ranking.`
      // Rodapé da TV: últimas vendas (só nas sincronizações que incluem hoje).
      if (range.end >= todayIn()) {
        try { details.recent_sales = await refreshRecentSales(db, erp, integration.company_id, mappings) }
        catch (e) { details.recent_sales_error = e instanceof Error ? e.message : String(e) }
        result.requests = erp.requests
      }
    }

    const finished = new Date().toISOString()
    await db.update('erp_sync_logs', `id=eq.${eq(log.id)}`, { status: result.status, finished_at: finished, duration_ms: Date.now() - started, requests: result.requests, pages: result.pages, rows_received: result.received, rows_staged: result.staged, rows_unmatched: result.unmatched, rows_published: result.published, details })
    if (opts.trigger !== 'query') await db.update('erp_integrations', `id=eq.${INTEGRATION_ID}`, { last_sync_at: finished, last_status: result.status, last_error: result.status === 'partial' ? String(details.notes ?? 'Leitura incompleta') : null, ...(result.status === 'success' ? { last_success_at: finished } : {}), updated_at: finished })
    return result
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const kind = e instanceof ErpError ? e.kind : 'internal'
    const finished = new Date().toISOString()
    await db.update('erp_sync_logs', `id=eq.${eq(log.id)}`, { status: 'error', finished_at: finished, duration_ms: Date.now() - started, requests: result.requests, pages: result.pages, rows_received: result.received, error: message, details: { ...details, kind, errors: result.errors ?? [] } }).catch(() => undefined)
    await db.update('erp_integrations', `id=eq.${INTEGRATION_ID}`, { last_sync_at: finished, last_status: 'error', last_error: message, updated_at: finished }).catch(() => undefined)
    return { ...result, status: 'error', message }
  } finally {
    await releaseLock(db, owner).catch(() => undefined)
  }
}

/**
 * Consolida o espelho do ERP por colaboradora e dia e grava em sales_daily.
 * Só datas >= publish_from. O setor da colaboradora nunca é alterado.
 * revenue = Σ valortotal (líquido de devoluções), gross_revenue = Σ valtotalliquido (antes das devoluções),
 * refund_amount = Σ valordevolucao, sales_count = Σ quantidade_vendas.
 */
export async function publishRange(db: Supabase, range: DateRange, publishFrom: string, mappings: Map<string, string>, onlyEmployees?: string[]): Promise<number> {
  const start = range.start > publishFrom ? range.start : publishFrom
  if (start > range.end || !mappings.size) return 0
  const filterEmployees = onlyEmployees?.length ? `&erp_employee_id=in.(${onlyEmployees.map(eq).join(',')})` : ''
  const staged = await db.selectAll<ErpSale>('erp_sales_daily', `integration_id=eq.${INTEGRATION_ID}&sale_date=gte.${eq(start)}&sale_date=lte.${eq(range.end)}${filterEmployees}&select=erp_employee_id,sale_date,valtotalliquido,valordevolucao,valortotal,quantidade_vendas`)
  const totals = new Map<string, { seller_id: string; sale_date: string; revenue: number; gross_revenue: number; refund_amount: number; sales_count: number }>()
  for (const s of staged) {
    const seller = mappings.get(s.erp_employee_id)
    if (!seller) continue
    const key = seller + '|' + s.sale_date
    const cur = totals.get(key) ?? { seller_id: seller, sale_date: s.sale_date, revenue: 0, gross_revenue: 0, refund_amount: 0, sales_count: 0 }
    cur.revenue = round2(cur.revenue + Number(s.valortotal))
    cur.gross_revenue = round2(cur.gross_revenue + Number(s.valtotalliquido))
    cur.refund_amount = round2(cur.refund_amount + Math.abs(Number(s.valordevolucao)))
    cur.sales_count += Number(s.quantidade_vendas)
    totals.set(key, cur)
  }
  if (onlyEmployees?.length) {
    // Ao vincular um funcionário, soma com o que outros códigos da mesma colaboradora já têm no dia.
    const sellers = [...new Set([...totals.values()].map(t => t.seller_id))]
    const otherCodes = [...mappings.entries()].filter(([code, seller]) => sellers.includes(seller) && !onlyEmployees.includes(code)).map(([code]) => code)
    if (otherCodes.length) {
      const extra = await db.selectAll<ErpSale>('erp_sales_daily', `integration_id=eq.${INTEGRATION_ID}&sale_date=gte.${eq(start)}&sale_date=lte.${eq(range.end)}&erp_employee_id=in.(${otherCodes.map(eq).join(',')})&select=erp_employee_id,sale_date,valtotalliquido,valordevolucao,valortotal,quantidade_vendas`)
      for (const s of extra) {
        const key = mappings.get(s.erp_employee_id) + '|' + s.sale_date
        const cur = totals.get(key)
        if (!cur) continue
        cur.revenue = round2(cur.revenue + Number(s.valortotal)); cur.gross_revenue = round2(cur.gross_revenue + Number(s.valtotalliquido)); cur.refund_amount = round2(cur.refund_amount + Math.abs(Number(s.valordevolucao))); cur.sales_count += Number(s.quantidade_vendas)
      }
    }
  }
  const rows = [...totals.values()]
  for (const r of rows) if (r.gross_revenue < 0 || r.refund_amount < 0 || r.sales_count < 0) throw new Error(`Totais inválidos para ${r.sale_date}: publicação cancelada.`)
  if (!rows.length) return 0
  const now = new Date().toISOString()
  await db.upsert('sales_daily', rows.map(r => ({ ...r, source: 'erp', import_key: `erp:${INTEGRATION_ID}`, erp_synced_at: now })), 'seller_id,sale_date')
  await db.update('erp_sales_daily', `integration_id=eq.${INTEGRATION_ID}&sale_date=gte.${eq(start)}&sale_date=lte.${eq(range.end)}&seller_id=not.is.null${filterEmployees}`, { published_at: now })
  return rows.length
}

/** Período da atualização recorrente (a cada 5 min): ontem e hoje, para pegar vendas fechadas perto da meia-noite. */
export function recurringRange(now = new Date()): DateRange { const t = todayIn(TIME_ZONE, now); return { start: addDays(t, -1), end: t } }

/** Período do reprocessamento diário: últimos N dias até hoje (correções e devoluções). */
export function dailyRange(days: number, now = new Date()): DateRange { const t = todayIn(TIME_ZONE, now); return { start: addDays(t, -Math.max(1, Math.min(31, days))), end: t } }

export type { Row }

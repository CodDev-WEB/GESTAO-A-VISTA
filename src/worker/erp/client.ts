// Cliente HTTP da API pública do Santarém Sistemas (Meu ERP Online).
// POST https://api.meuerponline.com.br/publica/api/consulta/sql/v1  corpo {"sql": "..."}
// Limite do fornecedor: 20 requisições por minuto.

import type { Env } from '../types'

export const DEFAULT_ERP_URL = 'https://api.meuerponline.com.br/publica/api/consulta/sql/v1'

export class ErpError extends Error {
  constructor(message: string, public kind: 'auth' | 'rate_limit' | 'unavailable' | 'bad_response' | 'config', public status = 0) { super(message) }
}

export type RawRow = Record<string, unknown>
export type Page = { rows: RawRow[]; status: number; shape: ResponseShape }
export type ResponseShape = { type: 'array' | 'object' | 'other'; keys: string[]; rowsKey: string | null; columns: string[] }

// Controle de taxa compartilhado pelo isolate: no máximo 18 requisições por minuto
// (margem sobre o limite de 20) e pelo menos 3,1 s entre elas.
const limits = { maxPerWindow: 18, windowMs: 60000, minIntervalMs: 3100 }
const recent: number[] = []

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

async function throttle(now: () => number = Date.now) {
  for (;;) {
    const t = now()
    while (recent.length && t - recent[0] >= limits.windowMs) recent.shift()
    const last = recent[recent.length - 1]
    const waitInterval = last !== undefined ? limits.minIntervalMs - (t - last) : 0
    const waitWindow = recent.length >= limits.maxPerWindow ? limits.windowMs - (t - recent[0]) : 0
    const wait = Math.max(waitInterval, waitWindow)
    if (wait <= 0) { recent.push(t); return }
    await sleep(wait)
  }
}

/** Só para testes: zera o histórico e, opcionalmente, troca os limites. */
export function resetThrottle(next?: Partial<typeof limits>) { recent.length = 0; if (next) Object.assign(limits, next) }
export { throttle as _throttle }

/** Encontra a lista de registros na resposta (o formato exato é validado na rota de teste). */
export function extractRows(body: unknown): { rows: RawRow[]; shape: ResponseShape } {
  if (Array.isArray(body)) return { rows: body as RawRow[], shape: { type: 'array', keys: [], rowsKey: null, columns: columnsOf(body) } }
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>
    const keys = Object.keys(obj)
    for (const key of ['data', 'dados', 'registros', 'rows', 'result', 'resultado', 'results', 'items', 'itens', 'content', 'records']) {
      const value = obj[key] ?? obj[key.toUpperCase()]
      if (Array.isArray(value)) return { rows: value as RawRow[], shape: { type: 'object', keys, rowsKey: key, columns: columnsOf(value) } }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = extractRows(value)
        if (nested.shape.columns.length || nested.rows.length) return { rows: nested.rows, shape: { ...nested.shape, type: 'object', keys, rowsKey: key + (nested.shape.rowsKey ? '.' + nested.shape.rowsKey : '') } }
      }
    }
    const arrays = keys.filter(k => Array.isArray(obj[k]))
    if (arrays.length === 1) return { rows: obj[arrays[0]] as RawRow[], shape: { type: 'object', keys, rowsKey: arrays[0], columns: columnsOf(obj[arrays[0]] as unknown[]) } }
    throw new ErpError('Resposta do ERP sem lista de registros reconhecível. Chaves: ' + keys.join(', '), 'bad_response')
  }
  throw new ErpError('Resposta do ERP em formato inesperado.', 'bad_response')
}

function columnsOf(list: unknown[]): string[] {
  const first = list.find(x => x && typeof x === 'object')
  return first ? Object.keys(first as object) : []
}

export class ErpClient {
  private url: string
  private token: string
  private scheme: string
  private sendX: boolean
  private pagination: 'query' | 'body'
  readonly pageSize: number
  requests = 0

  // O fetch do Workers não pode ser chamado como método de outro objeto ("Illegal invocation"):
  // por isso a função padrão chama o fetch global diretamente.
  constructor(env: Env, private fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    if (!env.ERP_TOKEN) throw new ErpError('Secret ERP_TOKEN não configurado.', 'config')
    this.url = env.ERP_API_URL || DEFAULT_ERP_URL
    if (!/^https:\/\//.test(this.url)) throw new ErpError('ERP_API_URL precisa usar https.', 'config')
    this.token = env.ERP_TOKEN
    this.scheme = (env.ERP_AUTH_SCHEME || 'Authentication').trim()
    this.sendX = env.ERP_SEND_X_TOKEN === 'true'
    this.pagination = env.ERP_PAGINATION === 'body' ? 'body' : 'query'
    const size = Number(env.ERP_PAGE_SIZE || 100)
    this.pageSize = Number.isInteger(size) && size >= 1 && size <= 5000 ? size : 100
  }

  /** Uma página da consulta. Repete uma vez em 429 e em falhas temporárias. */
  async page(sql: string, offset: number, limit = this.pageSize): Promise<Page> {
    const target = new URL(this.url)
    const body: Record<string, unknown> = { sql }
    if (this.pagination === 'query') { target.searchParams.set('offset', String(offset)); target.searchParams.set('limit', String(limit)) }
    else { body.offset = offset; body.limit = limit }
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `${this.scheme} ${this.token}` }
    if (this.sendX) headers['X-ERP-Token'] = this.token

    let lastError: ErpError | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      await throttle()
      this.requests++
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 25000)
      let res: Response
      try {
        res = await this.fetcher(target.toString(), { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
      } catch (e) {
        lastError = new ErpError('ERP indisponível: ' + (e instanceof Error && e.name === 'AbortError' ? 'tempo esgotado (25 s)' : e instanceof Error ? e.message : 'falha de rede'), 'unavailable')
        await sleep(3000)
        continue
      } finally { clearTimeout(timer) }

      if (res.status === 401 || res.status === 403) throw new ErpError(`Autenticação recusada pelo ERP (HTTP ${res.status}). Confira o ERP_TOKEN e o formato do cabeçalho.`, 'auth', res.status)
      if (res.status === 429) {
        const retry = Math.min(Number(res.headers.get('retry-after')) || 30, 60)
        lastError = new ErpError('Limite de requisições do ERP atingido (HTTP 429).', 'rate_limit', 429)
        await sleep(retry * 1000)
        continue
      }
      if (res.status >= 500) { lastError = new ErpError(`ERP indisponível (HTTP ${res.status}).`, 'unavailable', res.status); await sleep(3000); continue }
      const text = await res.text()
      if (!res.ok) throw new ErpError(`ERP recusou a consulta (HTTP ${res.status}): ${text.slice(0, 300)}`, 'bad_response', res.status)
      let json: unknown
      try { json = JSON.parse(text) } catch { throw new ErpError('ERP respondeu algo que não é JSON: ' + text.slice(0, 200), 'bad_response', res.status) }
      const { rows, shape } = extractRows(json)
      return { rows, status: res.status, shape }
    }
    throw lastError ?? new ErpError('ERP indisponível.', 'unavailable')
  }

  /**
   * Todas as páginas da consulta.
   * A API pode devolver menos registros que o limit pedido (o ERP limita a 100 por consulta),
   * então "página menor que o limit" NÃO significa fim: só uma página vazia encerra a leitura.
   * Se a API repetir a mesma página (offset ignorado), a leitura é marcada como incompleta.
   */
  async all(sql: string, maxPages = 60): Promise<{ rows: RawRow[]; pages: number; complete: boolean; note?: string }> {
    const rows: RawRow[] = []
    let previousFirst = ''
    for (let p = 0; p < maxPages; p++) {
      const { rows: page } = await this.page(sql, rows.length)
      if (!page.length) return { rows, pages: p + 1, complete: true }
      const first = JSON.stringify(page[0])
      if (p > 0 && first === previousFirst) return { rows, pages: p + 1, complete: false, note: 'A API repetiu a mesma página: offset não foi respeitado.' }
      previousFirst = first
      rows.push(...page)
    }
    return { rows, pages: maxPages, complete: false, note: `Mais de ${maxPages} páginas: consulta interrompida.` }
  }
}

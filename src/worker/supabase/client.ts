// Cliente mínimo do Supabase (PostgREST + Auth) para o Worker.
// Usa a chave service_role, que existe só como Secret do Worker.

import type { Env } from '../types'

export class SupabaseError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export type Row = Record<string, unknown>

export class Supabase {
  private url: string
  private key: string

  constructor(env: Env) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new SupabaseError('Secrets SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configurados.', 500)
    this.url = env.SUPABASE_URL.replace(/\/+$/, '')
    this.key = env.SUPABASE_SERVICE_ROLE_KEY
  }

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...extra }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const res = await fetch(`${this.url}${path}`, init)
    if (!res.ok) {
      let detail = ''
      try { const body = await res.json() as { message?: string; hint?: string }; detail = [body.message, body.hint].filter(Boolean).join(' ') } catch { /* corpo vazio */ }
      throw new SupabaseError(`Supabase ${res.status}: ${detail || res.statusText}`, res.status)
    }
    return res
  }

  async select<T = Row>(table: string, query: string): Promise<T[]> {
    const res = await this.request(`/rest/v1/${table}?${query}`, { headers: this.headers() })
    return await res.json() as T[]
  }

  /** Lê todas as páginas (1000 por vez). */
  async selectAll<T = Row>(table: string, query: string): Promise<T[]> {
    const out: T[] = []
    for (let from = 0; ; from += 1000) {
      const res = await this.request(`/rest/v1/${table}?${query}`, { headers: this.headers({ Range: `${from}-${from + 999}`, 'Range-Unit': 'items' }) })
      const page = await res.json() as T[]
      out.push(...page)
      if (page.length < 1000) return out
    }
  }

  async count(table: string, query: string): Promise<number> {
    const res = await this.request(`/rest/v1/${table}?${query}`, { method: 'HEAD', headers: this.headers({ Prefer: 'count=exact', Range: '0-0' }) })
    const range = res.headers.get('content-range') || ''
    const total = Number(range.split('/')[1])
    return Number.isFinite(total) ? total : 0
  }

  async insert<T = Row>(table: string, rows: Row | Row[]): Promise<T[]> {
    const res = await this.request(`/rest/v1/${table}`, { method: 'POST', headers: this.headers({ Prefer: 'return=representation' }), body: JSON.stringify(rows) })
    return await res.json() as T[]
  }

  /** UPSERT idempotente em lotes. */
  async upsert(table: string, rows: Row[], onConflict: string, batchSize = 500): Promise<number> {
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      await this.request(`/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
        method: 'POST',
        headers: this.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(batch),
      })
    }
    return rows.length
  }

  async update<T = Row>(table: string, filter: string, values: Row): Promise<T[]> {
    const res = await this.request(`/rest/v1/${table}?${filter}`, { method: 'PATCH', headers: this.headers({ Prefer: 'return=representation' }), body: JSON.stringify(values) })
    return await res.json() as T[]
  }

  /** Usuário dono do token de sessão (JWT do Supabase Auth) ou null. */
  async getUser(accessToken: string): Promise<{ id: string; email?: string } | null> {
    const res = await fetch(`${this.url}/auth/v1/user`, { headers: { apikey: this.key, Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) return null
    const user = await res.json() as { id?: string; email?: string }
    return user.id ? { id: user.id, email: user.email } : null
  }
}

/** Valor seguro para filtros do PostgREST (só datas, UUIDs, números e códigos já validados). */
export function eq(value: string) {
  if (!/^[0-9A-Za-z_.:+-]+$/.test(value)) throw new SupabaseError('Valor de filtro inválido.', 400)
  return encodeURIComponent(value)
}

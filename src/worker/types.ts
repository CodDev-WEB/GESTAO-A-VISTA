// Tipos mínimos do runtime do Cloudflare Workers usados pelo projeto
// (evita uma dependência extra só para tipos).

export interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}

export interface Env {
  ASSETS: AssetsBinding
  // Secrets (wrangler secret put …). Nunca vão para o navegador.
  ERP_TOKEN?: string
  SUPABASE_URL?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  // Variáveis de configuração (vars do wrangler.jsonc).
  ERP_API_URL?: string
  /** Esquema do cabeçalho Authorization. Padrão: "Authentication" (Authorization: Authentication TOKEN). */
  ERP_AUTH_SCHEME?: string
  /** "true" para enviar também X-ERP-Token. */
  ERP_SEND_X_TOKEN?: string
  /** Registros por página (offset/limit). */
  ERP_PAGE_SIZE?: string
  /** Onde enviar offset/limit: "query" (padrão) ou "body". */
  ERP_PAGINATION?: string
}

export interface ScheduledController {
  cron: string
  scheduledTime: number
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

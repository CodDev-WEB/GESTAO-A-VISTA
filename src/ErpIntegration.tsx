// Admin → Integrações → Santarém Sistemas.
// Conversa só com as rotas /api/erp/* do Worker; o token do ERP e a chave service_role nunca chegam aqui.
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Plug, RefreshCw, Users, Clock, Link2, Database } from 'lucide-react'
import { supabase } from './lib/supabase'

type SellerLite = { id: string; full_name: string; active: boolean; sector?: string | null }
type Status = {
  integration: { enabled: boolean; publish_enabled: boolean; publish_from: string | null; reprocess_days: number; last_sync_at: string | null; last_success_at: string | null; last_status: string | null; last_error: string | null; running: boolean }
  secrets: Record<string, boolean>
  config: { auth_scheme: string; send_x_token: boolean; pagination: string; page_size: number }
  counts: { mapped: number; unmatched_rows: number; unmatched_employees: number; staged: number; published: number }
  schedule: { today: string; recurring: string; daily: string; next_run: string | null }
  last_run: { status: string; finished_at: string | null; rows_staged: number; rows_published: number; error: string | null } | null
  recent_errors: { id: string; trigger: string; started_at: string; error: string }[]
}
type Log = { id: string; trigger: string; status: string; range_start: string | null; range_end: string | null; started_at: string; duration_ms: number | null; requests: number; rows_received: number; rows_staged: number; rows_unmatched: number; rows_published: number; error: string | null }
type Pending = { erp_employee_id: string; erp_employee_name: string; days: number; first_date: string; last_date: string; valortotal: number; quantidade_vendas: number }
type Mapping = { erp_employee_id: string; erp_employee_name: string | null; seller_id: string }
type QueryRow = { erp_employee_id: string; erp_employee_name: string; sale_date: string; valtotalbruto: number; valdescontoliquido: number; valdescontocashback: number; valacrescimo: number; valtotalliquido: number; valordevolucao: number; valortotal: number; quantidade_vendas: number; valor_medio_venda: number; seller_id: string | null }
type TestResult = { ok: boolean; message: string; http_status?: number; duration_ms?: number; kind?: string; response?: { type: string; keys: string[]; rowsKey: string | null; columns: string[] }; missing_columns?: string[] }

const money = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Belem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const day = (iso: string | null) => iso ? iso.split('-').reverse().join('/') : '—'
const sectorName = (s?: string | null) => s === 'salao' ? 'Salão' : s === 'digital' ? 'Digital' : s === 'checkout' ? 'Checkout' : 'Sem setor'
const triggerName: Record<string, string> = { cron: 'Automática (5 min)', daily: 'Reprocessamento diário', manual: 'Manual', initial: 'Inicial', test: 'Teste de conexão', query: 'Consulta', mapping: 'Associação' }
const statusName: Record<string, string> = { success: 'Sucesso', partial: 'Parcial', error: 'Erro', skipped: 'Ignorada', running: 'Em andamento' }
const todayBelem = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date())

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null
  if (!session) throw new Error('Sessão expirada. Entre novamente.')
  const res = await fetch(path, { method: init.method || 'GET', headers: { Authorization: `Bearer ${session.access_token}`, ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: init.body !== undefined ? JSON.stringify(init.body) : undefined })
  const type = res.headers.get('content-type') || ''
  if (!type.includes('application/json')) throw new Error('As rotas da integração só respondem no Worker publicado (Cloudflare). No modo de desenvolvimento do Vite elas não existem.')
  const data = await res.json() as T & { message?: string; ok?: boolean }
  if (!res.ok && res.status !== 502) throw new Error(data.message || `Erro ${res.status}`)
  return data
}

function Card({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <div className="metric-card"><div className={'metric-icon ' + tone}>{icon}</div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

export default function ErpIntegration({ sellers, onPublished }: { sellers: SellerLite[]; onPublished: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [logs, setLogs] = useState<Log[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [test, setTest] = useState<TestResult | null>(null)
  const [rows, setRows] = useState<QueryRow[] | null>(null)
  const [start, setStart] = useState(todayBelem()), [end, setEnd] = useState(todayBelem())
  const [busy, setBusy] = useState(''), [message, setMessage] = useState(''), [error, setError] = useState('')
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [manualCode, setManualCode] = useState(''), [manualSeller, setManualSeller] = useState('')
  const [publishFrom, setPublishFrom] = useState(''), [confirmText, setConfirmText] = useState(''), [days, setDays] = useState(7)
  const [showLogs, setShowLogs] = useState(false)

  const activeSellers = sellers.filter(s => s.active).sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))
  const sellerById = new Map(sellers.map(s => [s.id, s]))

  const refresh = useCallback(async () => {
    try {
      const [s, l, u, m] = await Promise.all([api<Status>('/api/erp/status'), api<{ logs: Log[] }>('/api/erp/logs?limit=40'), api<{ employees: Pending[] }>('/api/erp/unmatched'), api<{ mappings: Mapping[] }>('/api/erp/mappings')])
      setStatus(s); setLogs(l.logs); setPending(u.employees); setMappings(m.mappings)
      setPublishFrom(p => p || s.integration.publish_from || ''); setDays(s.integration.reprocess_days)
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao carregar a integração.') }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label); setMessage(''); setError('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : 'Falha.') } finally { setBusy(''); void refresh() }
  }

  const doTest = () => run('test', async () => { const r = await api<TestResult>('/api/erp/test', { method: 'POST' }); setTest(r); if (!r.ok) setError(r.message) })
  const doQuery = () => run('query', async () => { const r = await api<{ status: string; message: string; rows?: QueryRow[] }>('/api/erp/sync', { method: 'POST', body: { mode: 'query', start, end } }); if (r.status === 'error' || r.status === 'skipped') throw new Error(r.message); setRows(r.rows || []); setMessage(r.message) })
  const doSync = () => run('sync', async () => {
    const r = await api<{ status: string; message: string; published: number }>('/api/erp/sync', { method: 'POST', body: { mode: 'manual', start, end } })
    if (r.status === 'error' || r.status === 'skipped') throw new Error(r.message)
    setMessage((r.status === 'partial' ? 'Sincronização parcial: ' : 'Sincronização concluída: ') + r.message)
    if (r.published) onPublished()
  })
  const link = (code: string, sellerId: string) => run('map-' + code, async () => {
    if (!sellerId) throw new Error('Escolha a colaboradora.')
    const r = await api<{ message: string }>('/api/erp/mappings', { method: 'POST', body: { erp_employee_id: code, seller_id: sellerId } })
    setMessage(r.message); setManualCode(''); setManualSeller(''); onPublished()
  })
  const unlink = (code: string) => run('unmap-' + code, async () => { const r = await api<{ message: string }>('/api/erp/mappings', { method: 'DELETE', body: { erp_employee_id: code } }); setMessage(r.message) })
  const saveSettings = (body: Record<string, unknown>, ok: string) => run('settings', async () => { await api('/api/erp/settings', { method: 'POST', body }); setMessage(ok); setConfirmText('') })

  function submitManual(e: FormEvent) { e.preventDefault(); void link(manualCode.trim(), manualSeller) }

  const it = status?.integration
  const missingSecrets = status ? Object.entries(status.secrets).filter(([, v]) => !v).map(([k]) => k) : []
  const connection = !status ? 'Carregando…' : missingSecrets.length ? 'Configurar Secrets' : test ? (test.ok ? 'Conectado' : 'Falha') : it?.last_status === 'error' ? 'Com erro' : it?.last_success_at ? 'Conectado' : 'Não testada'

  return <>
    {message && <div className="success-message"><CheckCircle2 size={16} />{message}</div>}
    {error && <div className="error-box">{error}</div>}
    {missingSecrets.length > 0 && <div className="error-box">Secrets ausentes no Worker: {missingSecrets.join(', ')}. Veja o passo a passo no README (seção Integração Santarém Sistemas).</div>}

    <div className="admin-cards erp-cards">
      <Card icon={<Plug />} label="CONEXÃO" value={connection} detail={test?.duration_ms ? `Resposta em ${test.duration_ms} ms` : it?.enabled ? 'Sincronização automática ligada' : 'Sincronização automática desligada'} tone={connection === 'Conectado' ? 'green' : connection === 'Falha' || connection === 'Com erro' || connection === 'Configurar Secrets' ? 'purple' : 'blue'} />
      <Card icon={<Clock />} label="ÚLTIMA SINCRONIZAÇÃO" value={when(it?.last_sync_at)} detail={it?.last_status ? (statusName[it.last_status] || it.last_status) + (it.last_success_at ? ' · último sucesso ' + when(it.last_success_at) : '') : 'Nunca executada'} tone="blue" />
      <Card icon={<RefreshCw />} label="PRÓXIMA SINCRONIZAÇÃO" value={status?.schedule.next_run ? when(status.schedule.next_run) : 'Desligada'} detail={status ? status.schedule.recurring + '; ' + status.schedule.daily : ''} tone="gold" />
      <Card icon={<Users />} label="FUNCIONÁRIOS VINCULADOS" value={String(status?.counts.mapped ?? '—')} detail={`${status?.counts.unmatched_employees ?? 0} com pendência (${status?.counts.unmatched_rows ?? 0} dias)`} tone={status?.counts.unmatched_employees ? 'purple' : 'green'} />
    </div>
    <div className="admin-cards erp-cards">
      <Card icon={<Database />} label="REGISTROS IMPORTADOS" value={String(status?.counts.staged ?? '—')} detail="Funcionário × dia guardados do ERP" tone="blue" />
      <Card icon={<Link2 />} label="NO RANKING" value={String(status?.counts.published ?? '—')} detail={it?.publish_enabled ? `Publicação ativa desde ${day(it.publish_from)}` : 'Publicação desligada'} tone={it?.publish_enabled ? 'green' : 'gold'} />
      <Card icon={<AlertCircle />} label="ERROS RECENTES" value={String(status?.recent_errors.length ?? 0)} detail={status?.recent_errors[0] ? when(status.recent_errors[0].started_at) + ' · ' + status.recent_errors[0].error.slice(0, 60) : 'Nenhum erro registrado'} tone={status?.recent_errors.length ? 'purple' : 'green'} />
      <Card icon={<Plug />} label="AUTENTICAÇÃO" value={status ? status.config.auth_scheme : '—'} detail={status ? `X-ERP-Token: ${status.config.send_x_token ? 'sim' : 'não'} · paginação ${status.config.pagination}, ${status.config.page_size}/página` : ''} tone="blue" />
    </div>

    <div className="admin-panel">
      <div className="panel-head"><div><h2>Santarém Sistemas</h2><p>Consulta fixa no Worker, limite de 20 requisições por minuto, fuso America/Belem.</p></div><button className="btn secondary" onClick={() => void refresh()}><RefreshCw size={15} /> Atualizar</button></div>
      <div className="inline-form">
        <label>De<input type="date" value={start} max={todayBelem()} onChange={e => setStart(e.target.value)} /></label>
        <label>Até<input type="date" value={end} max={todayBelem()} onChange={e => setEnd(e.target.value)} /></label>
        <button className="btn secondary" disabled={!!busy} onClick={doTest}>{busy === 'test' ? 'Testando…' : 'Testar conexão'}</button>
        <button className="btn secondary" disabled={!!busy} onClick={doQuery}>{busy === 'query' ? 'Consultando…' : 'Consultar vendas'}</button>
        <button className="btn primary" disabled={!!busy || it?.running} onClick={doSync}>{busy === 'sync' ? 'Sincronizando…' : it?.running ? 'Sincronização em andamento' : 'Sincronizar agora'}</button>
      </div>
      <div className="format-hint">
        <strong>Consultar vendas</strong> só lê o ERP e mostra a tabela abaixo, sem gravar nada. <strong>Sincronizar agora</strong> grava o espelho do ERP e as pendências; o ranking só recebe os dados se a publicação estiver ativa. Período máximo de 92 dias por vez.
      </div>
      {test && <div className={test.ok ? 'erp-test ok' : 'erp-test fail'}>
        <span><strong>{test.ok ? 'Conexão OK' : 'Falha na conexão'}</strong> · {test.message}{test.http_status ? ` · HTTP ${test.http_status}` : ''}</span>
        {test.response && <small>Formato da resposta: {test.response.type === 'array' ? 'lista' : `objeto (lista em "${test.response.rowsKey}")`}{test.response.columns.length ? ' · colunas: ' + test.response.columns.join(', ') : ''}</small>}
      </div>}
    </div>

    {rows && <div className="admin-panel">
      <div className="panel-head"><div><h2>Vendas no ERP · {day(start)} a {day(end)}</h2><p>Compare com o relatório oficial do Santarém Sistemas antes de ativar a publicação.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>DIA</th><th>CÓDIGO</th><th>FUNCIONÁRIO (ERP)</th><th>COLABORADORA</th><th>BRUTO</th><th>DESC. LÍQ.</th><th>CASHBACK</th><th>ACRÉSC.</th><th>LÍQUIDO</th><th>DEVOLUÇÃO</th><th>TOTAL</th><th>VENDAS</th><th>MÉDIO</th></tr></thead>
        <tbody>{rows.length ? rows.map(r => <tr key={r.erp_employee_id + r.sale_date}><td>{day(r.sale_date)}</td><td>{r.erp_employee_id}</td><td>{r.erp_employee_name}</td><td>{r.seller_id ? sellerById.get(r.seller_id)?.full_name || 'Vinculada' : <span className="erp-pending-chip">Sem vínculo</span>}</td><td>{money(r.valtotalbruto)}</td><td>{money(r.valdescontoliquido)}</td><td>{money(r.valdescontocashback)}</td><td>{money(r.valacrescimo)}</td><td>{money(r.valtotalliquido)}</td><td>{money(r.valordevolucao)}</td><td className="money-cell">{money(r.valortotal)}</td><td>{r.quantidade_vendas}</td><td>{money(r.valor_medio_venda)}</td></tr>) : <tr><td colSpan={13} className="empty-state">Nenhuma venda no período.</td></tr>}</tbody>
        {rows.length > 0 && <tfoot><tr><td colSpan={4}><b>Total</b></td>{(['valtotalbruto', 'valdescontoliquido', 'valdescontocashback', 'valacrescimo', 'valtotalliquido', 'valordevolucao', 'valortotal'] as const).map(k => <td key={k} className="money-cell">{money(rows.reduce((n, r) => n + Number(r[k]), 0))}</td>)}<td><b>{rows.reduce((n, r) => n + r.quantidade_vendas, 0)}</b></td><td /></tr></tfoot>}
      </table></div>
    </div>}

    <div className="admin-panel">
      <div className="panel-head"><div><h2>Pendências · {pending.length}</h2><p>Funcionários do ERP com movimento e sem colaboradora associada. Eles não entram no ranking até serem associados.</p></div></div>
      {pending.length ? <div className="table-wrap"><table><thead><tr><th>CÓDIGO</th><th>NOME NO ERP</th><th>DIAS</th><th>PERÍODO</th><th>TOTAL</th><th>VENDAS</th><th>ASSOCIAR A</th><th /></tr></thead>
        <tbody>{pending.map(p => <tr key={p.erp_employee_id}><td>{p.erp_employee_id}</td><td>{p.erp_employee_name}</td><td>{p.days}</td><td>{day(p.first_date)} a {day(p.last_date)}</td><td className="money-cell">{money(p.valortotal)}</td><td>{p.quantidade_vendas}</td>
          <td><select className="erp-select" aria-label={'Colaboradora para o código ' + p.erp_employee_id} value={choice[p.erp_employee_id] || ''} onChange={e => setChoice({ ...choice, [p.erp_employee_id]: e.target.value })}><option value="">Selecione</option>{activeSellers.map(s => <option key={s.id} value={s.id}>{s.full_name} · {sectorName(s.sector)}</option>)}</select></td>
          <td><button className="btn primary" disabled={!!busy || !choice[p.erp_employee_id]} onClick={() => void link(p.erp_employee_id, choice[p.erp_employee_id])}>Associar</button></td></tr>)}</tbody></table></div>
        : <p className="erp-muted">Nenhuma pendência.</p>}
    </div>

    <div className="admin-panel">
      <div className="panel-head"><div><h2>Funcionários vinculados · {mappings.length}</h2><p>Associação feita pelo código do funcionário no ERP. O setor é o do cadastro da colaboradora e não muda na sincronização.</p></div></div>
      <form className="inline-form" onSubmit={submitManual}>
        <label>Código do funcionário no ERP<input inputMode="numeric" pattern="[0-9]+" value={manualCode} onChange={e => setManualCode(e.target.value.replace(/\D/g, ''))} placeholder="Ex.: 1234" required /></label>
        <label>Colaboradora<select value={manualSeller} onChange={e => setManualSeller(e.target.value)} required><option value="">Selecione</option>{activeSellers.map(s => <option key={s.id} value={s.id}>{s.full_name} · {sectorName(s.sector)}</option>)}</select></label>
        <button className="btn primary" disabled={!!busy}>Associar funcionário</button>
      </form>
      {mappings.length > 0 && <div className="table-wrap erp-gap"><table><thead><tr><th>CÓDIGO</th><th>NOME NO ERP</th><th>COLABORADORA</th><th>SETOR</th><th /></tr></thead>
        <tbody>{mappings.map(m => { const s = sellerById.get(m.seller_id); return <tr key={m.erp_employee_id}><td>{m.erp_employee_id}</td><td>{m.erp_employee_name || '—'}</td><td>{s?.full_name || 'Colaboradora removida'}</td><td>{sectorName(s?.sector)}</td><td><button className="btn secondary" disabled={!!busy} onClick={() => void unlink(m.erp_employee_id)}>Desvincular</button></td></tr> })}</tbody></table></div>}
    </div>

    <div className="admin-panel">
      <div className="panel-head"><div><h2>Configuração</h2><p>Comece com tudo desligado: teste, consulte e compare com o relatório do ERP. Depois ligue a sincronização automática e, por último, a publicação no ranking.</p></div></div>
      <div className="erp-settings">
        <div><strong>Sincronização automática</strong><small>A cada 5 minutos (ontem e hoje) e reprocessamento diário às 06:30.</small>
          <button className={it?.enabled ? 'btn secondary' : 'btn primary'} disabled={!!busy || !status} onClick={() => void saveSettings({ enabled: !it?.enabled }, it?.enabled ? 'Sincronização automática desligada.' : 'Sincronização automática ligada.')}>{it?.enabled ? 'Desligar' : 'Ligar'}</button></div>
        <div><strong>Reprocessar os últimos</strong><small>Dias revisados todo dia para capturar correções e devoluções.</small>
          <span className="erp-row"><input type="number" min={1} max={31} value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Dias de reprocessamento" /> dias <button className="btn secondary" disabled={!!busy} onClick={() => void saveSettings({ reprocess_days: days }, 'Reprocessamento atualizado.')}>Salvar</button></span></div>
        <div><strong>Publicar no ranking</strong><small>{it?.publish_enabled ? `Ativa: o ERP alimenta o ranking a partir de ${day(it.publish_from)}. Importações manuais anteriores ficam como estão.` : 'Desligada: os dados do ERP ficam só no espelho, sem alterar o ranking.'}</small>
          {it?.publish_enabled
            ? <button className="btn secondary" disabled={!!busy} onClick={() => void saveSettings({ publish_enabled: false }, 'Publicação desligada. O ranking não recebe mais dados do ERP.')}>Desligar publicação</button>
            : <span className="erp-row"><label>A partir de<input type="date" value={publishFrom} onChange={e => setPublishFrom(e.target.value)} /></label><label>Digite PUBLICAR<input value={confirmText} onChange={e => setConfirmText(e.target.value.toUpperCase())} placeholder="PUBLICAR" /></label>
              <button className="btn primary" disabled={!!busy || confirmText !== 'PUBLICAR' || !publishFrom} onClick={() => void saveSettings({ publish_enabled: true, publish_from: publishFrom, confirm: 'PUBLICAR' }, 'Publicação ativada. Rode "Sincronizar agora" para preencher o ranking.')}>Ativar publicação</button></span>}
        </div>
      </div>
    </div>

    <div className="admin-panel">
      <div className="panel-head"><div><h2>Histórico</h2><p>Execuções, duração, registros e erros.</p></div><button className="btn secondary" onClick={() => setShowLogs(!showLogs)}>{showLogs ? 'Ocultar' : 'Visualizar histórico'}</button></div>
      {status?.recent_errors.length ? <div className="erp-errors">{status.recent_errors.map(e => <div key={e.id}><AlertCircle size={14} /><span>{when(e.started_at)} · {triggerName[e.trigger] || e.trigger}</span><p>{e.error}</p></div>)}</div> : null}
      {showLogs && <div className="table-wrap erp-gap"><table><thead><tr><th>INÍCIO</th><th>TIPO</th><th>SITUAÇÃO</th><th>PERÍODO</th><th>DURAÇÃO</th><th>REQ.</th><th>RECEBIDOS</th><th>GRAVADOS</th><th>SEM VÍNCULO</th><th>PUBLICADOS</th><th>ERRO</th></tr></thead>
        <tbody>{logs.map(l => <tr key={l.id}><td>{when(l.started_at)}</td><td>{triggerName[l.trigger] || l.trigger}</td><td><span className={'erp-status ' + l.status}>{statusName[l.status] || l.status}</span></td><td>{l.range_start ? `${day(l.range_start)} a ${day(l.range_end)}` : '—'}</td><td>{l.duration_ms !== null ? (l.duration_ms / 1000).toFixed(1) + ' s' : '—'}</td><td>{l.requests}</td><td>{l.rows_received}</td><td>{l.rows_staged}</td><td>{l.rows_unmatched}</td><td>{l.rows_published}</td><td className="erp-error-cell" title={l.error || ''}>{l.error || ''}</td></tr>)}</tbody></table></div>}
    </div>
  </>
}

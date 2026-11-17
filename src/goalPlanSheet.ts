// Planilha do plano de metas: modelo para baixar e leitura para importar.
// Aba "Semanas": uma linha por semana. Aba "Mês": meta mensal, bônus e aumento por setor.
import * as XLSX from 'xlsx'

export type PlanGoal = { month: string; monthly_target: number; daily_target: number; bonus_meta?: number; bonus_super?: number; bonus_diamante?: number; growth_salao?: number | null; growth_digital?: number | null; growth_checkout?: number | null }
export type PlanWeek = { month: string; week_number: number; start_date: string; end_date: string; store_target: number; salao_revenue_target: number; digital_revenue_target: number; salao_sales_target: number; digital_conversions_target: number; checkout_ticket_target: number; salao_meta: number; salao_super: number; salao_diamante: number; digital_meta: number; digital_super: number; digital_diamante: number; checkout_meta: number; checkout_super: number; checkout_diamante: number }

type WeekNumberField = Exclude<keyof PlanWeek, 'month' | 'week_number' | 'start_date' | 'end_date'>
/** Colunas da aba Semanas, na ordem do plano impresso. */
export const WEEK_COLUMNS: [WeekNumberField, string][] = [
  ['store_target', 'Meta da loja (R$)'],
  ['salao_revenue_target', 'Venda salão (R$)'],
  ['digital_revenue_target', 'Venda digital (R$)'],
  ['salao_sales_target', 'Salão · qtd. de vendas'],
  ['digital_conversions_target', 'Digital · conversões'],
  ['checkout_ticket_target', 'Checkout · ticket médio (R$)'],
  ['salao_meta', 'Salão · Meta (R$ por pessoa)'],
  ['salao_super', 'Salão · Super (R$ por pessoa)'],
  ['salao_diamante', 'Salão · Diamante (R$ por pessoa)'],
  ['digital_meta', 'Digital · Meta (R$ por pessoa)'],
  ['digital_super', 'Digital · Super (R$ por pessoa)'],
  ['digital_diamante', 'Digital · Diamante (R$ por pessoa)'],
  ['checkout_meta', 'Checkout · Meta (R$ da equipe)'],
  ['checkout_super', 'Checkout · Super (R$ da equipe)'],
  ['checkout_diamante', 'Checkout · Diamante (R$ da equipe)'],
]
type MonthField = Exclude<keyof PlanGoal, 'month'>
const MONTH_FIELDS: [MonthField, string][] = [
  ['monthly_target', 'Meta mensal da loja (R$)'],
  ['daily_target', 'Meta diária (R$)'],
  ['bonus_meta', 'Bônus Meta (R$)'],
  ['bonus_super', 'Bônus Super (R$)'],
  ['bonus_diamante', 'Bônus Diamante (R$)'],
  ['growth_salao', 'Aumento Salão (%)'],
  ['growth_digital', 'Aumento Digital (%)'],
  ['growth_checkout', 'Aumento Checkout (%)'],
]

const brDate = (iso: string) => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''
const monthBr = (month: string) => month.slice(5, 7) + '/' + month.slice(0, 4)

/** Planilha com o plano do mês (serve de modelo para o próximo). */
export function buildPlanWorkbook(goal: PlanGoal, weeks: PlanWeek[]) {
  const wb = XLSX.utils.book_new()
  const rows = weeks.map((w, i) => {
    const r: Record<string, string | number> = { Semana: i + 1, 'Início': brDate(w.start_date), Fim: brDate(w.end_date) }
    for (const [k, label] of WEEK_COLUMNS) r[label] = Number(w[k] || 0)
    return r
  })
  const header = ['Semana', 'Início', 'Fim', ...WEEK_COLUMNS.map(c => c[1])]
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}], { header })
  ws['!cols'] = header.map((h, i) => ({ wch: i < 3 ? 12 : Math.max(14, h.length + 2) }))
  XLSX.utils.book_append_sheet(wb, ws, 'Semanas')
  const monthRows: (string | number)[][] = [['Campo', 'Valor'], ['Mês (MM/AAAA)', monthBr(goal.month)]]
  for (const [k, label] of MONTH_FIELDS) { const v = goal[k]; monthRows.push([label, v === null || v === undefined ? '' : Number(v)]) }
  const ms = XLSX.utils.aoa_to_sheet(monthRows)
  ms['!cols'] = [{ wch: 28 }, { wch: 16 }]
  XLSX.utils.book_append_sheet(wb, ms, 'Mês')
  const help = XLSX.utils.aoa_to_sheet([
    ['Como usar'],
    ['1. Na aba "Semanas", uma linha por semana do plano, com as datas de início e fim (DD/MM/AAAA).'],
    ['2. Valores em reais podem ser digitados com ou sem R$ e separador de milhar (ex.: 13.000 ou 13000,50).'],
    ['3. Na aba "Mês", informe o mês (MM/AAAA), a meta mensal, os bônus e o aumento por setor.'],
    ['4. No admin, em Metas, use "Importar planilha", confira os valores na tela e clique em "Salvar plano".'],
  ])
  help['!cols'] = [{ wch: 110 }]
  XLSX.utils.book_append_sheet(wb, help, 'Instruções')
  return wb
}

export function downloadPlanWorkbook(goal: PlanGoal, weeks: PlanWeek[]) {
  XLSX.writeFile(buildPlanWorkbook(goal, weeks), `plano-de-metas_${goal.month.slice(0, 7)}.xlsx`)
}

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const pad = (n: number) => String(n).padStart(2, '0')
const validIso = (y: number, m: number, d: number) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100 ? `${y}-${pad(m)}-${pad(d)}` : null }

/** Data em qualquer formato comum da planilha: Date, número serial do Excel, DD/MM/AAAA ou AAAA-MM-DD. */
export function cellDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) { const local = new Date(v.getTime() + 12 * 3600000); return validIso(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate()) }
  if (typeof v === 'number' && v > 20000 && v < 80000) { const ms = Math.round((v - 25569) * 86400000); const d = new Date(ms); return validIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) }
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return validIso(y, Number(m[2]), Number(m[1])) }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return validIso(Number(m[1]), Number(m[2]), Number(m[3]))
  return null
}

/** Número: 13000, "13.000", "R$ 13.000,50", "13000.5", "7%". Vazio = null. */
export function cellNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN
  let s = String(v ?? '').replace(/R\$|%|\s/g, '')
  if (!s) return null
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

function cellMonth(v: unknown): string | null {
  if (v instanceof Date || typeof v === 'number') { const d = cellDate(v); return d ? d.slice(0, 7) + '-01' : null }
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{1,2})[/.-](\d{4})$/); if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${pad(Number(m[1]))}-01`
  m = s.match(/^(\d{4})-(\d{1,2})/); if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${pad(Number(m[2]))}-01`
  const d = cellDate(s); return d ? d.slice(0, 7) + '-01' : null
}

export type PlanImport = { month: string; goal: Partial<PlanGoal>; weeks: PlanWeek[]; warnings: string[] }

/** Lê a planilha do plano. Lança Error com a lista de problemas encontrados. */
export function parsePlanWorkbook(wb: XLSX.WorkBook): PlanImport {
  const errors: string[] = [], warnings: string[] = []
  const sheetName = wb.SheetNames.find(n => norm(n) === 'semanas') || wb.SheetNames[0]
  if (!sheetName) throw new Error('A planilha está vazia.')
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: '', raw: true, blankrows: false })
  // Linha de cabeçalho: a primeira que tenha "Início" e "Fim".
  const headerIndex = grid.findIndex(r => r.some(c => norm(c) === 'inicio') && r.some(c => norm(c) === 'fim'))
  if (headerIndex < 0) throw new Error('Não encontrei o cabeçalho da aba "Semanas" (colunas "Início" e "Fim"). Baixe a planilha modelo e use as mesmas colunas.')
  const header = grid[headerIndex].map(norm)
  const col = (label: string) => header.indexOf(norm(label))
  const iStart = col('Início'), iEnd = col('Fim')
  const numCols = WEEK_COLUMNS.map(([k, label]) => [k, label, col(label)] as const)
  const missing = numCols.filter(c => c[2] < 0).map(c => c[1])
  if (missing.length) throw new Error('Colunas que faltam na aba "Semanas": ' + missing.join(', ') + '. Baixe a planilha modelo e use as mesmas colunas.')

  const weeks: PlanWeek[] = []
  grid.slice(headerIndex + 1).forEach((r, idx) => {
    const line = headerIndex + idx + 2
    if (r.every(c => String(c ?? '').trim() === '')) return
    const start = cellDate(r[iStart]), end = cellDate(r[iEnd])
    if (!start) { errors.push(`Linha ${line}: data de início inválida ("${String(r[iStart] ?? '')}").`); return }
    if (!end) { errors.push(`Linha ${line}: data de fim inválida ("${String(r[iEnd] ?? '')}").`); return }
    if (end < start) { errors.push(`Linha ${line}: o fim (${brDate(end)}) é antes do início (${brDate(start)}).`); return }
    const w = { month: '', week_number: weeks.length + 1, start_date: start, end_date: end } as PlanWeek
    for (const [k, label, i] of numCols) {
      const n = cellNumber(r[i])
      if (n === null) { w[k] = 0; continue }
      if (Number.isNaN(n) || n < 0) { errors.push(`Linha ${line}: "${label}" inválido ("${String(r[i])}").`); continue }
      w[k] = Math.round(n * 100) / 100
    }
    weeks.push(w)
  })
  if (!weeks.length && !errors.length) errors.push('Nenhuma semana encontrada na aba "Semanas".')
  weeks.sort((a, b) => a.start_date.localeCompare(b.start_date))
  weeks.forEach((w, i) => { w.week_number = i + 1; if (i > 0 && w.start_date <= weeks[i - 1].end_date) errors.push(`${i + 1}ª semana (${brDate(w.start_date)}) começa antes do fim da ${i}ª semana (${brDate(weeks[i - 1].end_date)}).`) })

  // Aba Mês (opcional).
  const goal: Partial<PlanGoal> = {}
  let month: string | null = null
  const monthSheet = wb.SheetNames.find(n => norm(n) === 'mes')
  if (monthSheet) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[monthSheet], { header: 1, defval: '', raw: true, blankrows: false })
    for (const r of rows) {
      const key = norm(r[0])
      if (!key || key === 'campo') continue
      if (key.startsWith('mes')) { month = cellMonth(r[1]); if (!month && String(r[1] ?? '').trim()) errors.push(`Aba "Mês": mês inválido ("${String(r[1])}"). Use MM/AAAA.`); continue }
      const field = MONTH_FIELDS.find(([, label]) => norm(label) === key)
      if (!field) continue
      const n = cellNumber(r[1])
      if (n === null) { if (field[0].startsWith('growth_')) (goal as Record<string, number | null>)[field[0]] = null; continue }
      if (Number.isNaN(n) || (n < 0 && !field[0].startsWith('growth_'))) { errors.push(`Aba "Mês": "${field[1]}" inválido ("${String(r[1])}").`); continue }
      ;(goal as Record<string, number>)[field[0]] = Math.round(n * 100) / 100
    }
  } else warnings.push('A planilha não tem a aba "Mês": meta mensal e bônus ficam como estão.')

  // Sem mês informado: o mês com mais dias dentro das semanas.
  if (!month && weeks.length) {
    const count = new Map<string, number>()
    for (const w of weeks) for (let d = new Date(w.start_date + 'T12:00:00'); d <= new Date(w.end_date + 'T12:00:00'); d.setDate(d.getDate() + 1)) { const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`; count.set(k, (count.get(k) || 0) + 1) }
    month = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }
  if (errors.length) throw new Error('A planilha tem problemas:\n• ' + errors.slice(0, 12).join('\n• ') + (errors.length > 12 ? `\n• e mais ${errors.length - 12}.` : ''))
  if (!month) throw new Error('Não consegui identificar o mês do plano. Informe-o na aba "Mês" (MM/AAAA).')
  weeks.forEach(w => { w.month = month! })
  return { month, goal, weeks, warnings }
}

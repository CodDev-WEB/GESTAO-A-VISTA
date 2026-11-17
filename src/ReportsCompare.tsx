// Relatórios → Comparativo: semanas de um mês contra as semanas de outro mês, e evolução mês a mês.
import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { ArrowDown, ArrowUp, FileSpreadsheet } from 'lucide-react'

type Sale = { seller_id: string; sale_date: string; revenue: number; sales_count: number; gross_revenue?: number }
type GoalWeek = { month: string; week_number: number; start_date: string; end_date: string }
type Split = 'plan' | 'fixed'
export type Period = { label: string; start: string; end: string }

const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const shortMoney = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const num = (n: number) => n.toLocaleString('pt-BR')
const pct = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d) }
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000) + 1
const shortBr = (s: string) => s.slice(8, 10) + '/' + s.slice(5, 7)
const monthEnd = (m: string) => iso(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0))
const prevMonth = (m: string) => iso(new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1)).slice(0, 7)
const monthLabel = (m: string) => { const s = new Date(m + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1) }
const monthShort = (m: string) => { const s = new Date(m + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''); return s.charAt(0).toUpperCase() + s.slice(1) + '/' + m.slice(2, 4) }
const round = (n: number) => Math.round(n * 100) / 100

/** Semanas do mês: as do plano de metas (quando houver) ou dias fixos 1–7, 8–14, 15–21, 22–fim. */
export function monthWeeks(month: string, plan: GoalWeek[], split: Split): Period[] {
  const own = plan.filter(w => (w.month || w.start_date).slice(0, 7) === month).sort((a, b) => a.start_date.localeCompare(b.start_date))
  if (split === 'plan' && own.length) return own.map((w, i) => ({ label: `${i + 1}ª semana`, start: w.start_date, end: w.end_date }))
  const e = monthEnd(month)
  return [['01', '07'], ['08', '14'], ['15', '21'], ['22', e.slice(8, 10)]].map(([a, b], i) => ({ label: `${i + 1}ª semana`, start: `${month}-${a}`, end: `${month}-${b}` }))
}

/** Dias já passados de um período (0 = ainda não começou). */
const elapsed = (p: Period, today: string) => p.start > today ? 0 : daysBetween(p.start, p.end < today ? p.end : today)

/**
 * Período comparável: se um dos lados ainda está em andamento, os dois são cortados
 * no mesmo número de dias (ex.: 15 a 17/11 contra 15 a 17/10).
 */
export function equivalent(a: Period, b: Period, today: string, same: boolean): { a: Period; b: Period; partial: boolean; started: boolean } {
  const ea = elapsed(a, today), eb = elapsed(b, today)
  const la = daysBetween(a.start, a.end), lb = daysBetween(b.start, b.end)
  const started = ea > 0 && eb > 0
  if (!same || !started || (ea === la && eb === lb)) return { a, b, partial: false, started }
  const n = Math.min(ea, eb)
  return { a: { ...a, end: addDays(a.start, Math.min(n, la) - 1) }, b: { ...b, end: addDays(b.start, Math.min(n, lb) - 1) }, partial: true, started }
}

type Totals = { revenue: number; count: number; gross: number }

export default function ReportsCompare({ sales, goalWeeks, today, scope }: { sales: Sale[]; goalWeeks: GoalWeek[]; today: string; scope: string }) {
  const months = useMemo(() => {
    const first = sales.reduce((m, s) => s.sale_date < m ? s.sale_date : m, today).slice(0, 7)
    const list: string[] = []
    for (let m = today.slice(0, 7); m >= first && list.length < 36; m = prevMonth(m)) list.push(m)
    return list
  }, [sales, today])
  const [monthA, setMonthA] = useState(today.slice(0, 7))
  const [monthB, setMonthB] = useState(prevMonth(today.slice(0, 7)))
  const [split, setSplit] = useState<Split>('plan')
  const [same, setSame] = useState(true)

  // Soma por dia para consultas rápidas por intervalo.
  const byDay = useMemo(() => {
    const m = new Map<string, Totals>()
    for (const s of sales) { const t = m.get(s.sale_date) || { revenue: 0, count: 0, gross: 0 }; t.revenue += Number(s.revenue); t.count += Number(s.sales_count); t.gross += Number(s.gross_revenue ?? Math.max(Number(s.revenue), 0)); m.set(s.sale_date, t) }
    return m
  }, [sales])
  const sumRange = (p: Period): Totals => {
    const t = { revenue: 0, count: 0, gross: 0 }
    for (let d = p.start; d <= p.end; d = addDays(d, 1)) { const x = byDay.get(d); if (x) { t.revenue += x.revenue; t.count += x.count; t.gross += x.gross } }
    return t
  }

  const wa = monthWeeks(monthA, goalWeeks, split), wb = monthWeeks(monthB, goalWeeks, split)
  const monthPeriod = (m: string): Period => ({ label: monthLabel(m), start: m + '-01', end: monthEnd(m) })
  const rows = Array.from({ length: Math.max(wa.length, wb.length) }, (_, i) => {
    const a = wa[i], b = wb[i]
    if (!a || !b) return { label: (a || b)!.label, a: a || null, b: b || null, ta: a ? sumRange(a) : null, tb: b ? sumRange(b) : null, partial: false, started: false }
    const eq = equivalent(a, b, today, same)
    return { label: a.label, a: eq.a, b: eq.b, ta: elapsed(a, today) ? sumRange(eq.a) : null, tb: elapsed(b, today) ? sumRange(eq.b) : null, partial: eq.partial, started: eq.started, fullA: a, fullB: b }
  })
  const mEq = equivalent(monthPeriod(monthA), monthPeriod(monthB), today, same)
  const totA = sumRange(mEq.a), totB = sumRange(mEq.b)

  // Evolução mensal: cada mês contra o anterior (mês corrente comparado com os mesmos dias do anterior).
  const evolution = useMemo(() => months.slice(0, 12).map(m => {
    const eq = equivalent(monthPeriod(m), monthPeriod(prevMonth(m)), today, same)
    return { m, cur: sumRange(eq.a), prev: sumRange(eq.b), partial: eq.partial, until: eq.a.end }
  }), [months, byDay, today, same]) // eslint-disable-line react-hooks/exhaustive-deps

  const variation = (a: number, b: number) => b ? (a - b) / Math.abs(b) * 100 : null
  const Var = ({ a, b }: { a: number; b: number }) => {
    const v = variation(a, b)
    if (v === null) return <span className="rep-sub">—</span>
    return <b className={'cmp-var ' + (v >= 0 ? 'up' : 'down')}>{v >= 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}{v >= 0 ? '+' : '−'}{pct(Math.abs(v))}</b>
  }
  const diff = (a: number, b: number) => (a - b >= 0 ? '+' : '−') + money(Math.abs(a - b))
  const range = (p: Period | null) => p ? `${shortBr(p.start)} a ${shortBr(p.end)}` : ''
  const nameA = monthShort(monthA), nameB = monthShort(monthB)
  const maxBar = Math.max(1, ...rows.flatMap(r => [r.ta?.revenue || 0, r.tb?.revenue || 0]))

  function exportXlsx() {
    const wb = XLSX.utils.book_new()
    const weeks = rows.map(r => ({
      Semana: r.label,
      [`Período ${nameA}`]: range(r.a), [`Faturamento ${nameA}`]: r.ta ? round(r.ta.revenue) : '', [`Vendas ${nameA}`]: r.ta ? r.ta.count : '',
      [`Período ${nameB}`]: range(r.b), [`Faturamento ${nameB}`]: r.tb ? round(r.tb.revenue) : '', [`Vendas ${nameB}`]: r.tb ? r.tb.count : '',
      'Diferença (R$)': r.ta && r.tb ? round(r.ta.revenue - r.tb.revenue) : '',
      'Variação (%)': r.ta && r.tb && r.tb.revenue ? round(variation(r.ta.revenue, r.tb.revenue)!) : '',
      Observação: r.partial ? 'Semana em andamento: mesmos dias nos dois meses' : '',
    }))
    weeks.push({ Semana: 'Mês', [`Período ${nameA}`]: range(mEq.a), [`Faturamento ${nameA}`]: round(totA.revenue), [`Vendas ${nameA}`]: totA.count, [`Período ${nameB}`]: range(mEq.b), [`Faturamento ${nameB}`]: round(totB.revenue), [`Vendas ${nameB}`]: totB.count, 'Diferença (R$)': round(totA.revenue - totB.revenue), 'Variação (%)': totB.revenue ? round(variation(totA.revenue, totB.revenue)!) : '', Observação: mEq.partial ? 'Mês em andamento: mesmos dias nos dois meses' : '' })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(weeks), 'Semanas')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(evolution.map(e => ({ Mês: monthLabel(e.m), Faturamento: round(e.cur.revenue), Vendas: e.cur.count, 'Ticket médio': round(e.cur.count ? e.cur.gross / e.cur.count : 0), 'Mês anterior': round(e.prev.revenue), 'Variação (%)': e.prev.revenue ? round(variation(e.cur.revenue, e.prev.revenue)!) : '', Observação: e.partial ? `Até o dia ${e.until.slice(8, 10)} nos dois meses` : '' }))), 'Meses')
    XLSX.writeFile(wb, `comparativo_${monthA}_x_${monthB}.xlsx`)
  }

  return <>
    <div className="admin-panel cmp-panel">
      <div className="panel-head"><div><h2>Comparativo de semanas · {monthLabel(monthA)} × {monthLabel(monthB)}</h2><p>Faturamento de cada semana de um mês contra a mesma semana do outro mês, em valores e em percentual. {scope}</p></div>
        <div className="rep-actions"><button className="btn secondary" onClick={exportXlsx}><FileSpreadsheet size={15} /> Excel</button></div></div>
      <div className="rep-grid">
        <label>Mês<select value={monthA} onChange={e => setMonthA(e.target.value)}>{months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
        <label>Comparar com<select value={monthB} onChange={e => setMonthB(e.target.value)}>{months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
        <label>Divisão das semanas<select value={split} onChange={e => setSplit(e.target.value as Split)}><option value="plan">Plano de metas (quando houver)</option><option value="fixed">Dias fixos: 1–7, 8–14, 15–21, 22–fim</option></select></label>
      </div>
      <div className="rep-checks"><label><input type="checkbox" checked={same} onChange={e => setSame(e.target.checked)} /> Semana ou mês em andamento: comparar só os mesmos dias nos dois meses</label></div>

      <div className="cmp-cards">
        <div><span>{monthLabel(monthA)}</span><strong>{money(totA.revenue)}</strong><small>{range(mEq.a)} · {num(totA.count)} vendas</small></div>
        <div><span>{monthLabel(monthB)}</span><strong>{money(totB.revenue)}</strong><small>{range(mEq.b)} · {num(totB.count)} vendas</small></div>
        <div><span>Diferença</span><strong>{diff(totA.revenue, totB.revenue)}</strong><small><Var a={totA.revenue} b={totB.revenue} />{mEq.partial ? ` · mesmos ${daysBetween(mEq.a.start, mEq.a.end)} dias` : ''}</small></div>
      </div>

      <div className="cmp-chart" role="img" aria-label={`Faturamento por semana: ${monthLabel(monthA)} contra ${monthLabel(monthB)}`}>
        {rows.map(r => <div key={r.label} className="cmp-group">
          <div className="cmp-bars">
            <i className={'cmp-a' + (r.ta ? '' : ' is-empty')} style={{ height: ((r.ta?.revenue || 0) / maxBar * 100) + '%' }} title={`${nameA} · ${r.label}: ${r.ta ? money(r.ta.revenue) : 'sem dados'}`}><em>{r.ta ? shortMoney(r.ta.revenue) : ''}</em></i>
            <i className={'cmp-b' + (r.tb ? '' : ' is-empty')} style={{ height: ((r.tb?.revenue || 0) / maxBar * 100) + '%' }} title={`${nameB} · ${r.label}: ${r.tb ? money(r.tb.revenue) : 'sem dados'}`}><em>{r.tb ? shortMoney(r.tb.revenue) : ''}</em></i>
          </div>
          <small><span>{r.label}</span>{r.ta && r.tb ? <Var a={r.ta.revenue} b={r.tb.revenue} /> : null}</small>
        </div>)}
      </div>
      <div className="cmp-legend"><span><i className="cmp-a" />{monthLabel(monthA)}</span><span><i className="cmp-b" />{monthLabel(monthB)}</span></div>

      <div className="table-wrap"><table className="rep-table cmp-table">
        <thead><tr><th>Semana</th><th>{nameA}</th><th>{nameB}</th><th>Diferença</th><th>Variação</th><th>Vendas {nameA} × {nameB}</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.label}>
          <td data-label="Semana"><strong className="rep-name">{r.label}</strong>{r.partial && <small className="rep-sub">em andamento · mesmos {daysBetween(r.a!.start, r.a!.end)} dias</small>}</td>
          <td data-label={nameA}>{r.ta ? <><b className="money-cell">{money(r.ta.revenue)}</b><small className="rep-sub">{range(r.a)}</small></> : r.a ? <small className="rep-sub">começa em {shortBr(r.a.start)}</small> : <small className="rep-sub">—</small>}</td>
          <td data-label={nameB}>{r.tb ? <><b className="money-cell">{money(r.tb.revenue)}</b><small className="rep-sub">{range(r.b)}</small></> : r.b ? <small className="rep-sub">começa em {shortBr(r.b.start)}</small> : <small className="rep-sub">—</small>}</td>
          <td data-label="Diferença">{r.ta && r.tb ? <span className={r.ta.revenue >= r.tb.revenue ? 'rep-hit' : 'cmp-neg'}>{diff(r.ta.revenue, r.tb.revenue)}</span> : '—'}</td>
          <td data-label="Variação">{r.ta && r.tb ? <Var a={r.ta.revenue} b={r.tb.revenue} /> : '—'}</td>
          <td data-label="Vendas">{r.ta && r.tb ? <>{num(r.ta.count)} × {num(r.tb.count)} <Var a={r.ta.count} b={r.tb.count} /></> : '—'}</td>
        </tr>)}</tbody>
        <tfoot><tr><td data-label="Total"><b>Mês</b>{mEq.partial && <small className="rep-sub">até o dia {mEq.a.end.slice(8, 10)} nos dois</small>}</td><td data-label={nameA} className="money-cell"><b>{money(totA.revenue)}</b></td><td data-label={nameB} className="money-cell"><b>{money(totB.revenue)}</b></td><td data-label="Diferença"><b className={totA.revenue >= totB.revenue ? 'rep-hit' : 'cmp-neg'}>{diff(totA.revenue, totB.revenue)}</b></td><td data-label="Variação"><Var a={totA.revenue} b={totB.revenue} /></td><td data-label="Vendas">{num(totA.count)} × {num(totB.count)} <Var a={totA.count} b={totB.count} /></td></tr></tfoot>
      </table></div>
    </div>

    <div className="admin-panel">
      <div className="panel-head"><div><h2>Evolução mês a mês</h2><p>Cada mês contra o mês anterior.{same ? ' O mês em andamento é comparado com os mesmos dias do mês anterior.' : ''}</p></div></div>
      <div className="table-wrap"><table className="rep-table cmp-table cmp-evo">
        <thead><tr><th>Mês</th><th>Faturamento</th><th>Vendas</th><th>Ticket médio</th><th>Mês anterior</th><th>Variação</th></tr></thead>
        <tbody>{evolution.map(e => <tr key={e.m}>
          <td data-label="Mês"><strong className="rep-name">{monthLabel(e.m)}</strong>{e.partial && <small className="rep-sub">até o dia {e.until.slice(8, 10)}</small>}</td>
          <td data-label="Faturamento" className="money-cell">{money(e.cur.revenue)}</td><td data-label="Vendas">{num(e.cur.count)}</td><td data-label="Ticket médio">{money(e.cur.count ? e.cur.gross / e.cur.count : 0)}</td>
          <td data-label="Mês anterior">{e.prev.revenue ? money(e.prev.revenue) : '—'}</td><td data-label="Variação"><Var a={e.cur.revenue} b={e.prev.revenue} /></td>
        </tr>)}</tbody>
      </table></div>
    </div>
  </>
}

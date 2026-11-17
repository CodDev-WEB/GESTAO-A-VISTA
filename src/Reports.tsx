// Admin → Relatórios: todos os dados de vendas com filtros, comparação, gráfico, tabela e exportação.
import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { ArrowDown, ArrowUp, Download, FileSpreadsheet, Printer, ShoppingBag, Star, Target, TrendingUp, Undo2 } from 'lucide-react'
import { supabase } from './lib/supabase'
import ReportsCompare from './ReportsCompare'

type Sector = 'salao' | 'digital' | 'checkout'
type Seller = { id: string; full_name: string; active: boolean; can_sell?: boolean; sector?: Sector | null }
type Sale = { seller_id: string; sale_date: string; revenue: number; sales_count: number; gross_revenue?: number; refund_amount?: number }
type Recognition = { seller_id: string; stars: number; recognized_at: string }
type GoalWeek = { month: string; week_number: number; start_date: string; end_date: string; store_target: number; salao_revenue_target: number; digital_revenue_target: number } & Record<string, unknown>
type ErpRow = { seller_id: string | null; sale_date: string; valtotalbruto: number; valdescontoliquido: number; valdescontocashback: number; valacrescimo: number }
type Tier = 'meta' | 'super' | 'diamante'

type PresetKey = 'today' | 'yesterday' | 'week' | 'plan-week' | 'month' | 'last-month' | 'custom'
type GroupKey = 'seller' | 'sector' | 'day' | 'week' | 'month'
type SortKey = 'label' | 'revenue' | 'count' | 'ticket' | 'refund' | 'share' | 'goalPct' | 'stars'

const sectors: Sector[] = ['salao', 'digital', 'checkout']
const sectorName = (s?: Sector | null) => s === 'salao' ? 'Salão' : s === 'digital' ? 'Digital' : s === 'checkout' ? 'Checkout' : 'Sem setor'
const lowerWords = new Set(['da', 'das', 'de', 'do', 'dos', 'e'])
const nameOf = (n: string) => n.trim().split(/\s+/).map((w, i) => { const l = w.toLocaleLowerCase('pt-BR'); return i > 0 && lowerWords.has(l) ? l : l.charAt(0).toLocaleUpperCase('pt-BR') + l.slice(1) }).join(' ')
const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const shortMoney = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const num = (n: number) => n.toLocaleString('pt-BR')
const pct = (n: number, d = 1) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%'
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayIso = () => iso(new Date())
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d) }
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000) + 1
const br = (s: string) => s.split('-').reverse().join('/')
const shortBr = (s: string) => s.slice(8, 10) + '/' + s.slice(5, 7)
const weekday = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
const mondayOf = (s: string) => { const d = new Date(s + 'T12:00:00'); return addDays(s, -((d.getDay() + 6) % 7)) }
const monthName = (s: string) => new Date(s.slice(0, 7) + '-15T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
const tierLabel = (t: Tier) => t === 'diamante' ? 'Diamante' : t === 'super' ? 'Super' : 'Meta'
const tierOf = (v: number, t: { meta: number; super: number; diamante: number }): Tier | null => t.meta <= 0 ? null : v >= t.diamante && t.diamante > 0 ? 'diamante' : v >= t.super && t.super > 0 ? 'super' : v >= t.meta ? 'meta' : null
const overlap = (aS: string, aE: string, bS: string, bE: string) => { const s = aS > bS ? aS : bS, e = aE < bE ? aE : bE; return e < s ? 0 : daysBetween(s, e) }

/** Metas do plano para o período: cada semana entra na proporção dos dias em comum. */
function planFor(weeks: GoalWeek[], start: string, end: string) {
  const ind: Record<Sector, { meta: number; super: number; diamante: number }> = { salao: { meta: 0, super: 0, diamante: 0 }, digital: { meta: 0, super: 0, diamante: 0 }, checkout: { meta: 0, super: 0, diamante: 0 } }
  let store = 0, covered = false
  for (const w of weeks) {
    const d = overlap(w.start_date, w.end_date, start, end); if (!d) continue
    covered = true
    const f = d / daysBetween(w.start_date, w.end_date)
    store += Number(w.store_target) * f
    for (const s of sectors) { ind[s].meta += Number(w[`${s}_meta`] || 0) * f; ind[s].super += Number(w[`${s}_super`] || 0) * f; ind[s].diamante += Number(w[`${s}_diamante`] || 0) * f }
  }
  return { covered, store, ind }
}

function presetRange(key: PresetKey, weeks: GoalWeek[], planWeek: string, custom: [string, string]): [string, string] {
  const t = todayIso()
  if (key === 'today') return [t, t]
  if (key === 'yesterday') return [addDays(t, -1), addDays(t, -1)]
  if (key === 'week') { const m = mondayOf(t); return [m, addDays(m, 6)] }
  if (key === 'plan-week') { const w = weeks.find(x => x.start_date === planWeek) || weeks.find(x => x.start_date <= t && x.end_date >= t); return w ? [w.start_date, w.end_date] : [mondayOf(t), addDays(mondayOf(t), 6)] }
  if (key === 'month') { const s = t.slice(0, 8) + '01'; const e = iso(new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 0)); return [s, e] }
  if (key === 'last-month') { const d = new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 2, 1); const s = iso(d); return [s, iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))] }
  return custom[0] <= custom[1] ? custom : [custom[1], custom[0]]
}

type Row = { key: string; label: string; sub: string; sector: Sector | null; revenue: number; gross: number; count: number; refund: number; stars: number; goal: number; tier: Tier | null; erp: { bruto: number; desc: number; cash: number; acres: number } | null }

export default function Reports({ sellers, sales, recognitions, goalWeeks }: { sellers: Seller[]; sales: Sale[]; recognitions: Recognition[]; goalWeeks: GoalWeek[] }) {
  const t = todayIso()
  const [view, setView] = useState<'period' | 'compare'>('period')
  const [preset, setPreset] = useState<PresetKey>('month')
  const [planWeek, setPlanWeek] = useState('')
  const [custom, setCustom] = useState<[string, string]>([t.slice(0, 8) + '01', t])
  const [sector, setSector] = useState<'all' | Sector | 'none'>('all')
  const [sellerId, setSellerId] = useState('all')
  const [group, setGroup] = useState<GroupKey>('seller')
  const [includeNonSellers, setIncludeNonSellers] = useState(false)
  const [showErp, setShowErp] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'revenue', dir: -1 })
  const [erpRows, setErpRows] = useState<ErpRow[] | null>(null)
  const [erpError, setErpError] = useState('')

  const weeks = useMemo(() => [...goalWeeks].sort((a, b) => a.start_date.localeCompare(b.start_date)), [goalWeeks])
  const [start, end] = presetRange(preset, weeks, planWeek, custom)
  const span = daysBetween(start, end)
  const [prevStart, prevEnd] = [addDays(start, -span), addDays(start, -1)]
  const sellerById = useMemo(() => new Map(sellers.map(s => [s.id, s])), [sellers])

  // Quem entra no relatório (setor/colaboradora/participação nas vendas).
  const included = useMemo(() => sellers.filter(s =>
    (includeNonSellers || s.can_sell !== false) &&
    (sector === 'all' || (sector === 'none' ? !s.sector : s.sector === sector)) &&
    (sellerId === 'all' || s.id === sellerId)), [sellers, includeNonSellers, sector, sellerId])
  const ids = useMemo(() => new Set(included.map(s => s.id)), [included])
  const inRange = (s: Sale, a: string, b: string) => ids.has(s.seller_id) && s.sale_date >= a && s.sale_date <= b
  const scopedSales = useMemo(() => sales.filter(s => ids.has(s.seller_id)), [sales, ids])
  const rows = useMemo(() => sales.filter(s => inRange(s, start, end)), [sales, ids, start, end]) // eslint-disable-line react-hooks/exhaustive-deps
  const prevRows = useMemo(() => sales.filter(s => inRange(s, prevStart, prevEnd)), [sales, ids, prevStart, prevEnd]) // eslint-disable-line react-hooks/exhaustive-deps

  // Detalhes financeiros do ERP (bruto, descontos, cashback, acréscimo) para o período.
  useEffect(() => {
    let alive = true
    setErpRows(null); setErpError('')
    if (!supabase) { setErpRows([]); return }
    void (async () => {
      const all: ErpRow[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase!.from('erp_sales_daily').select('seller_id,sale_date,valtotalbruto,valdescontoliquido,valdescontocashback,valacrescimo').gte('sale_date', start).lte('sale_date', end).range(from, from + 999)
        if (error) { if (alive) { setErpError('Detalhes do ERP indisponíveis: ' + error.message); setErpRows([]) } return }
        all.push(...(data as ErpRow[])); if (!data || data.length < 1000) break
      }
      if (alive) setErpRows(all)
    })()
    return () => { alive = false }
  }, [start, end])

  const sum = (list: Sale[]) => list.reduce((a, s) => ({ revenue: a.revenue + Number(s.revenue), gross: a.gross + Number(s.gross_revenue ?? Math.max(Number(s.revenue), 0)), count: a.count + Number(s.sales_count), refund: a.refund + Number(s.refund_amount || 0) }), { revenue: 0, gross: 0, count: 0, refund: 0 })
  const total = sum(rows), prev = sum(prevRows)
  const ticket = total.count ? total.gross / total.count : 0, prevTicket = prev.count ? prev.gross / prev.count : 0
  const plan = planFor(weeks, start, end)
  const storeGoal = sector === 'all' && sellerId === 'all' ? plan.store : 0
  const starsIn = (sid: string) => recognitions.filter(r => r.seller_id === sid && r.recognized_at.slice(0, 10) >= start && r.recognized_at.slice(0, 10) <= end).reduce((n, r) => n + Number(r.stars), 0)
  const totalStars = included.reduce((n, s) => n + starsIn(s.id), 0)

  const erpBySellerDay = useMemo(() => {
    const m = new Map<string, ErpRow[]>()
    for (const r of erpRows || []) { if (!r.seller_id || !ids.has(r.seller_id)) continue; const k = r.seller_id + '|' + r.sale_date; m.set(k, [...(m.get(k) || []), r]) }
    return m
  }, [erpRows, ids])
  const erpFor = (list: Sale[]) => {
    let found = false; const e = { bruto: 0, desc: 0, cash: 0, acres: 0 }
    for (const s of list) for (const r of erpBySellerDay.get(s.seller_id + '|' + s.sale_date) || []) { found = true; e.bruto += Number(r.valtotalbruto); e.desc += Number(r.valdescontoliquido); e.cash += Number(r.valdescontocashback); e.acres += Number(r.valacrescimo) }
    return found ? e : null
  }

  // Linhas agrupadas.
  const table: Row[] = useMemo(() => {
    const out: Row[] = []
    const make = (key: string, label: string, sub: string, list: Sale[], extra: Partial<Row> = {}): Row => { const s = sum(list); return { key, label, sub, sector: null, ...s, stars: 0, goal: 0, tier: null, erp: erpFor(list), ...extra } }
    if (group === 'seller') {
      const checkoutMembers = sellers.filter(s => s.active && s.can_sell !== false && s.sector === 'checkout').length || 1
      const teamCheckout = rows.filter(r => sellerById.get(r.seller_id)?.sector === 'checkout').reduce((n, r) => n + Number(r.revenue), 0)
      for (const s of included) {
        const list = rows.filter(r => r.seller_id === s.id)
        const stars = starsIn(s.id)
        if (!list.length && !stars && !s.active) continue
        const g = s.sector && plan.covered ? plan.ind[s.sector] : null
        const isTeam = s.sector === 'checkout'
        const goal = g ? (isTeam ? g.meta / checkoutMembers : g.meta) : 0
        const rev = sum(list).revenue
        out.push(make(s.id, nameOf(s.full_name), sectorName(s.sector) + (s.can_sell === false ? ' · fora das vendas' : '') + (s.active ? '' : ' · inativa'), list, { sector: s.sector || null, stars, goal, tier: g ? tierOf(isTeam ? teamCheckout : rev, g) : null }))
      }
    } else if (group === 'sector') {
      for (const sec of [...sectors, null]) {
        const members = included.filter(s => (s.sector || null) === sec)
        if (!members.length) continue
        const set = new Set(members.map(m => m.id))
        const list = rows.filter(r => set.has(r.seller_id))
        const g = sec && plan.covered ? plan.ind[sec] : null
        const goal = !g ? 0 : sec === 'checkout' ? g.meta : sec === 'salao' ? planRevenue('salao_revenue_target') : planRevenue('digital_revenue_target')
        out.push(make(String(sec), sectorName(sec), members.length + (members.length === 1 ? ' pessoa' : ' pessoas'), list, { sector: sec, stars: members.reduce((n, m) => n + starsIn(m.id), 0), goal, tier: sec === 'checkout' && g ? tierOf(sum(list).revenue, g) : null }))
      }
    } else {
      const keyOf = (d: string) => group === 'day' ? d : group === 'month' ? d.slice(0, 7) : (weeks.find(w => w.start_date <= d && w.end_date >= d)?.start_date || mondayOf(d))
      const keys: string[] = []
      for (let d = start; d <= end; d = addDays(d, 1)) { const k = keyOf(d); if (!keys.includes(k)) keys.push(k) }
      for (const k of keys) {
        const list = rows.filter(r => keyOf(r.sale_date) === k)
        let label = k, sub = ''
        if (group === 'day') { label = br(k); sub = weekday(k) }
        else if (group === 'month') { label = monthName(k + '-01'); sub = '' }
        else { const w = weeks.find(x => x.start_date === k); const e = w ? w.end_date : addDays(k, 6); label = (w ? w.week_number + 'ª semana' : 'Semana') ; sub = shortBr(w ? w.start_date : k) + ' a ' + shortBr(e) }
        const [a, b] = group === 'day' ? [k, k] : group === 'month' ? [k + '-01', iso(new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)), 0))] : [k, weeks.find(x => x.start_date === k)?.end_date || addDays(k, 6)]
        const goal = sector === 'all' && sellerId === 'all' ? planFor(weeks, a > start ? a : start, b < end ? b : end).store : 0
        out.push(make(k, label, sub, list, { goal, stars: recognitions.filter(r => ids.has(r.seller_id) && keyOf(r.recognized_at.slice(0, 10)) === k && r.recognized_at.slice(0, 10) >= start && r.recognized_at.slice(0, 10) <= end).reduce((n, r) => n + Number(r.stars), 0) }))
      }
    }
    return out
    function planRevenue(field: string) { return weeks.reduce((n, w) => { const d = overlap(w.start_date, w.end_date, start, end); return n + (d ? Number(w[field] || 0) * d / daysBetween(w.start_date, w.end_date) : 0) }, 0) }
  }, [group, rows, included, recognitions, weeks, start, end, plan.covered, erpBySellerDay, sector, sellerId]) // eslint-disable-line react-hooks/exhaustive-deps

  const value = (r: Row, k: SortKey): number | string => k === 'label' ? r.label : k === 'ticket' ? (r.count ? r.gross / r.count : 0) : k === 'share' ? r.revenue : k === 'goalPct' ? (r.goal > 0 ? r.revenue / r.goal : -1) : r[k]
  const keepOrder = group === 'day' || group === 'week' || group === 'month'
  const sorted = useMemo(() => {
    if (keepOrder && sort.key === 'label') return sort.dir === 1 ? table : [...table].reverse()
    return [...table].sort((a, b) => { const x = value(a, sort.key), y = value(b, sort.key); return (typeof x === 'string' ? x.localeCompare(String(y), 'pt-BR') : x - Number(y)) * sort.dir })
  }, [table, sort, keepOrder]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSort(keepOrder ? { key: 'label', dir: 1 } : { key: 'revenue', dir: -1 }) }, [keepOrder])

  // Gráfico diário.
  const daily = useMemo(() => {
    const list: { d: string; v: number; c: number }[] = []
    for (let d = start; d <= end && list.length < 92; d = addDays(d, 1)) { const r = rows.filter(x => x.sale_date === d); list.push({ d, v: r.reduce((n, x) => n + Number(x.revenue), 0), c: r.reduce((n, x) => n + Number(x.sales_count), 0) }) }
    return list
  }, [rows, start, end])
  const maxDay = Math.max(1, ...daily.map(x => x.v))
  const dailyGoal = storeGoal > 0 ? storeGoal / span : 0

  const erpTotal = erpFor(rows)
  const headers: [SortKey | null, string][] = [['label', group === 'seller' ? 'Colaboradora' : group === 'sector' ? 'Setor' : group === 'day' ? 'Dia' : group === 'week' ? 'Semana' : 'Mês'], ['revenue', 'Faturamento'], ['count', 'Vendas'], ['ticket', 'Ticket médio'], ['refund', 'Devoluções'], ['share', 'Participação'], ['goalPct', 'Meta · %'], ['stars', 'Estrelas']]

  function exportRows() {
    return sorted.map(r => {
      const o: Record<string, string | number> = { [headers[0][1]]: r.label, Detalhe: r.sub, Faturamento: round(r.revenue), Vendas: r.count, 'Ticket médio': round(r.count ? r.gross / r.count : 0), Devoluções: round(r.refund), 'Participação (%)': round(total.revenue ? r.revenue / total.revenue * 100 : 0), Meta: round(r.goal), '% da meta': r.goal > 0 ? round(r.revenue / r.goal * 100) : '', Nível: r.tier ? tierLabel(r.tier) : '', Estrelas: r.stars }
      if (showErp) Object.assign(o, { 'Bruto (ERP)': r.erp ? round(r.erp.bruto) : '', 'Desconto líquido (ERP)': r.erp ? round(r.erp.desc) : '', 'Cashback (ERP)': r.erp ? round(r.erp.cash) : '', 'Acréscimo (ERP)': r.erp ? round(r.erp.acres) : '' })
      return o
    })
  }
  const fileBase = `relatorio-vendas_${start}_a_${end}`
  function download(blob: Blob, name: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 500) }
  function exportCsv() {
    const data = exportRows(); if (!data.length) return
    const cols = Object.keys(data[0]); const esc = (v: string | number) => { const s = typeof v === 'number' ? String(v).replace('.', ',') : v; return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    download(new Blob(['﻿' + [cols.join(';'), ...data.map(r => cols.map(c => esc(r[c])).join(';'))].join('\r\n')], { type: 'text/csv;charset=utf-8' }), fileBase + '.csv')
  }
  function exportXlsx() {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exportRows()), 'Relatório')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(daily.map(x => ({ Dia: br(x.d), Faturamento: round(x.v), Vendas: x.c }))), 'Por dia')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Período: `${br(start)} a ${br(end)}`, Setor: sector === 'all' ? 'Todos' : sector === 'none' ? 'Sem setor' : sectorName(sector), Colaboradora: sellerId === 'all' ? 'Todas' : nameOf(sellerById.get(sellerId)?.full_name || ''), Faturamento: round(total.revenue), Vendas: total.count, 'Ticket médio': round(ticket), Devoluções: round(total.refund), 'Meta da loja': round(storeGoal) }]), 'Resumo')
    XLSX.writeFile(wb, fileBase + '.xlsx')
  }

  const delta = (cur: number, before: number) => {
    if (!before) return <small className="rep-delta">sem dados no período anterior</small>
    const d = (cur - before) / Math.abs(before) * 100
    return <small className={'rep-delta ' + (d >= 0 ? 'up' : 'down')}>{d >= 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}{pct(Math.abs(d))} vs. {shortBr(prevStart)} a {shortBr(prevEnd)}</small>
  }
  const sortBy = (k: SortKey | null) => k && setSort(s => s.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: k === 'label' ? 1 : -1 })
  const sellerOptions = sellers.filter(s => (includeNonSellers || s.can_sell !== false) && (sector === 'all' || (sector === 'none' ? !s.sector : s.sector === sector))).sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'))

  const compare = view === 'compare'
  const scope = sector === 'all' && sellerId === 'all' ? 'Loja toda.' : `Filtro: ${sellerId !== 'all' ? nameOf(sellerById.get(sellerId)?.full_name || '') : sector === 'none' ? 'sem setor' : sectorName(sector as Sector)}.`

  return <div className="reports">
    <div className="rep-views" role="tablist" aria-label="Tipo de relatório">
      <button type="button" role="tab" aria-selected={!compare} className={!compare ? 'active' : ''} onClick={() => setView('period')}>Período</button>
      <button type="button" role="tab" aria-selected={compare} className={compare ? 'active' : ''} onClick={() => setView('compare')}>Comparativo de semanas e meses</button>
    </div>
    <div className="admin-panel rep-filters">
      <div className="panel-head"><div><h2>Filtros</h2><p>{compare ? 'Setor e colaboradora valem para o comparativo abaixo.' : <>{br(start)} a {br(end)} · {span} {span === 1 ? 'dia' : 'dias'} · comparado com {br(prevStart)} a {br(prevEnd)}</>}</p></div>
        {!compare && <div className="rep-actions"><button className="btn secondary" onClick={exportCsv} disabled={!sorted.length}><Download size={15} /> CSV</button><button className="btn secondary" onClick={exportXlsx} disabled={!sorted.length}><FileSpreadsheet size={15} /> Excel</button><button className="btn secondary" onClick={() => window.print()}><Printer size={15} /> Imprimir / PDF</button></div>}</div>
      <div className="rep-grid">
        {!compare && <label>Período<select value={preset} onChange={e => setPreset(e.target.value as PresetKey)}><option value="today">Hoje</option><option value="yesterday">Ontem</option><option value="week">Esta semana (seg. a dom.)</option><option value="plan-week">Semana do plano</option><option value="month">Este mês</option><option value="last-month">Mês anterior</option><option value="custom">Personalizado</option></select></label>}
        {!compare && preset === 'plan-week' && <label>Semana do plano<select value={planWeek || weeks.find(w => w.start_date <= t && w.end_date >= t)?.start_date || ''} onChange={e => setPlanWeek(e.target.value)}>{weeks.map(w => <option key={w.start_date} value={w.start_date}>{monthName(w.month || w.start_date)} · {w.week_number}ª ({shortBr(w.start_date)} a {shortBr(w.end_date)})</option>)}</select></label>}
        {!compare && preset === 'custom' && <><label>De<input type="date" value={custom[0]} onChange={e => setCustom([e.target.value, custom[1]])} /></label><label>Até<input type="date" value={custom[1]} onChange={e => setCustom([custom[0], e.target.value])} /></label></>}
        <label>Setor<select value={sector} onChange={e => { setSector(e.target.value as typeof sector); setSellerId('all') }}><option value="all">Todos</option>{sectors.map(s => <option key={s} value={s}>{sectorName(s)}</option>)}<option value="none">Sem setor</option></select></label>
        <label>Colaboradora<select value={sellerId} onChange={e => setSellerId(e.target.value)}><option value="all">Todas</option>{sellerOptions.map(s => <option key={s.id} value={s.id}>{nameOf(s.full_name)}{s.active ? '' : ' (inativa)'}</option>)}</select></label>
        {!compare && <label>Agrupar por<select value={group} onChange={e => setGroup(e.target.value as GroupKey)}><option value="seller">Colaboradora</option><option value="sector">Setor</option><option value="day">Dia</option><option value="week">Semana</option><option value="month">Mês</option></select></label>}
      </div>
      <div className="rep-checks">
        <label><input type="checkbox" checked={includeNonSellers} onChange={e => setIncludeNonSellers(e.target.checked)} /> Incluir quem não participa das vendas (ex.: gerência)</label>
        {!compare && <label><input type="checkbox" checked={showErp} onChange={e => setShowErp(e.target.checked)} /> Mostrar detalhes do ERP (bruto, descontos, cashback, acréscimo)</label>}
      </div>
    </div>

    {compare ? <ReportsCompare sales={scopedSales} goalWeeks={weeks} today={t} scope={scope} /> : <>

    <div className="admin-cards rep-cards">
      <div className="metric-card"><div className="metric-icon blue"><TrendingUp /></div><span>FATURAMENTO</span><strong>{money(total.revenue)}</strong>{delta(total.revenue, prev.revenue)}</div>
      <div className="metric-card"><div className="metric-icon green"><ShoppingBag /></div><span>VENDAS</span><strong>{num(total.count)}</strong>{delta(total.count, prev.count)}</div>
      <div className="metric-card"><div className="metric-icon gold"><Target /></div><span>TICKET MÉDIO</span><strong>{money(ticket)}</strong>{delta(ticket, prevTicket)}</div>
      <div className="metric-card"><div className="metric-icon purple"><Undo2 /></div><span>DEVOLUÇÕES</span><strong>{money(total.refund)}</strong><small className="rep-delta">{total.revenue ? pct(total.refund / (total.revenue + total.refund) * 100) + ' do faturamento bruto' : '—'}</small></div>
      <div className="metric-card"><div className="metric-icon gold"><Target /></div><span>META DO PERÍODO</span><strong>{storeGoal > 0 ? pct(total.revenue / storeGoal * 100) : '—'}</strong><small className="rep-delta">{storeGoal > 0 ? `${shortMoney(total.revenue)} de ${shortMoney(storeGoal)}` : sector !== 'all' || sellerId !== 'all' ? 'Meta da loja só com todos os setores' : 'Sem plano cadastrado no período'}</small></div>
      <div className="metric-card"><div className="metric-icon blue"><Star /></div><span>ESTRELAS</span><strong>{num(totalStars)}</strong><small className="rep-delta">Média de {shortMoney(total.revenue / span)} por dia</small></div>
    </div>

    {span > 1 && <div className="admin-panel">
      <div className="panel-head"><div><h2>Faturamento por dia</h2><p>{dailyGoal > 0 ? `Linha tracejada: meta diária média da loja (${shortMoney(dailyGoal)}).` : 'Passe o mouse sobre a barra para ver o valor.'}{span > 92 ? ' Mostrando os primeiros 92 dias.' : ''}</p></div></div>
      <div className="rep-chart" role="img" aria-label={`Faturamento por dia de ${br(start)} a ${br(end)}`}>
        {dailyGoal > 0 && <i className="rep-goal-line" style={{ bottom: Math.min(100, dailyGoal / Math.max(maxDay, dailyGoal) * 100) + '%' }} />}
        {daily.map((x, i) => <div key={x.d} className={(daily.length > 15 && i % 5 !== 0 && i !== daily.length - 1 ? 'is-minor ' : '') + 'rep-bar' + (x.d === t ? ' is-today' : '') + (x.d > t ? ' is-future' : '') + (dailyGoal > 0 && x.v >= dailyGoal ? ' is-hit' : '')} title={`${br(x.d)} (${weekday(x.d)}): ${money(x.v)} · ${x.c} vendas`}>
          <span style={{ height: (x.v / Math.max(maxDay, dailyGoal) * 100) + '%' }} />
          <small>{x.d.slice(8, 10)}</small>
        </div>)}
      </div>
    </div>}

    <div className="admin-panel">
      <div className="panel-head"><div><h2>Detalhamento · {sorted.length} {sorted.length === 1 ? 'linha' : 'linhas'}</h2><p>Clique no título de uma coluna para ordenar. {group === 'seller' ? 'Meta individual pelo plano do período (Checkout: parte da meta da equipe; nível da equipe).' : group === 'sector' ? 'Meta do setor em R$ pelo plano (Salão e Digital: venda do setor; Checkout: meta da equipe).' : 'Meta da loja proporcional a cada período.'}</p></div></div>
      {erpError && showErp && <div className="error-box">{erpError}</div>}
      <div className="table-wrap"><table className="rep-table">
        <thead><tr>{headers.map(([k, h]) => <th key={h} className="rep-th-sort" aria-sort={k && sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}><button type="button" className="rep-sort" onClick={() => sortBy(k)}>{h}{k && sort.key === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button></th>)}
          {showErp && <><th>Bruto</th><th>Desc. líquido</th><th>Cashback</th><th>Acréscimo</th></>}</tr></thead>
        <tbody>{sorted.length ? sorted.map(r => <tr key={r.key}>
          <td><strong className="rep-name">{r.label}</strong>{r.sub && <small className="rep-sub">{r.sub}</small>}</td>
          <td className="money-cell">{money(r.revenue)}</td><td>{num(r.count)}</td><td>{money(r.count ? r.gross / r.count : 0)}</td><td>{r.refund ? money(r.refund) : '—'}</td>
          <td><span className="rep-share"><i style={{ width: (total.revenue ? Math.max(0, r.revenue / total.revenue * 100) : 0) + '%' }} /></span>{total.revenue ? pct(r.revenue / total.revenue * 100) : '—'}</td>
          <td>{r.goal > 0 ? <><b className={r.revenue >= r.goal ? 'rep-hit' : ''}>{pct(r.revenue / r.goal * 100)}</b><small className="rep-sub">de {shortMoney(r.goal)}</small></> : '—'}{r.tier && <span className={'bonus-tier ' + r.tier}>{tierLabel(r.tier)}</span>}</td>
          <td>{r.stars ? '★ ' + r.stars : '—'}</td>
          {showErp && <>{r.erp ? <><td>{money(r.erp.bruto)}</td><td>{money(r.erp.desc)}</td><td>{money(r.erp.cash)}</td><td>{money(r.erp.acres)}</td></> : <td colSpan={4} className="rep-sub">{erpRows === null ? 'Carregando…' : 'Sem dados do ERP'}</td>}</>}
        </tr>) : <tr><td colSpan={showErp ? 12 : 8} className="empty-state">Nenhum dado para os filtros escolhidos.</td></tr>}</tbody>
        {sorted.length > 0 && <tfoot><tr><td><b>Total</b></td><td className="money-cell">{money(total.revenue)}</td><td><b>{num(total.count)}</b></td><td><b>{money(ticket)}</b></td><td><b>{total.refund ? money(total.refund) : '—'}</b></td><td><b>100%</b></td><td>{storeGoal > 0 ? <b>{pct(total.revenue / storeGoal * 100)}</b> : '—'}</td><td><b>{totalStars ? '★ ' + totalStars : '—'}</b></td>
          {showErp && <>{erpTotal ? <><td><b>{money(erpTotal.bruto)}</b></td><td><b>{money(erpTotal.desc)}</b></td><td><b>{money(erpTotal.cash)}</b></td><td><b>{money(erpTotal.acres)}</b></td></> : <td colSpan={4} />}</>}</tr></tfoot>}
      </table></div>
    </div>
    </>}
  </div>
}

function round(n: number) { return Math.round(n * 100) / 100 }

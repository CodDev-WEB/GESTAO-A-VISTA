import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Navigate, Route, Routes, Link, useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import {
  Trophy, TrendingUp, ShoppingBag, Target, Star,
  Upload, Users, LogOut, LayoutDashboard, Plus, Monitor,
  RefreshCw, ChevronRight, ShieldCheck, AlertCircle, CheckCircle2,
  ArrowUpRight, ImagePlus, X
} from 'lucide-react'
import { supabase, hasSupabase } from './lib/supabase'

type Sector = 'salao'|'digital'|'checkout'
type Seller = { id:string; full_name:string; email:string|null; photo_url:string|null; active:boolean; can_sell?:boolean; sector?:Sector|null }
type SectorGoal = { id:string; sector:Sector; week_start:string; target:number }
type Sale = { id:string; seller_id:string; sale_date:string; revenue:number; sales_count:number; gross_revenue?:number; refund_amount?:number }
type Recognition = { id:string; seller_id:string; stars:number; kind:string; title:string; description:string; recognized_at:string }
type Goal = { month:string; monthly_target:number; daily_target:number }
type Profile = { id:string; full_name:string; role:'admin'|'viewer'; active:boolean }
type Period = 'day'|'week'|'month'|'range'
type ImportRow = { data:string; vendedora:string; valor:number|string; vendas:number|string; email?:string }

const normalizeHeader = (value:unknown) => String(value??'').replace(/^\uFEFF/,'').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')
const parseImportAmount = (value:unknown):number|string => {
 if(typeof value==='number')return Number.isFinite(value)?value:''
 const raw=String(value??'').trim()
 if(!raw)return ''
 let s=raw.replace(/R\$/gi,'').replace(/\s/g,'')
 if(s.includes(',')&&s.includes('.')){
  const decimalSeparator=s.lastIndexOf(',')>s.lastIndexOf('.')?',':'.'
  const thousandsSeparator=decimalSeparator===','?'.':','
  s=s.split(thousandsSeparator).join('')
  if(decimalSeparator===',')s=s.replace(',', '.')
 }else if(s.includes(','))s=s.replace(',', '.')
 const n=Number(s)
 return Number.isFinite(n)?n:''
}

const money = (n:number) => n.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})
const exactMoney = (n:number) => n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const toISODate = (date:Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
const today = () => toISODate(new Date())
const monthKey = (date:string) => date.slice(0,7)+'-01'
const monthLabel = (date:string) => new Date(date+'T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'})
const initial = (name:string) => name.split(' ').filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()
const initialsColor = (i:number) => ['#e2b66d','#8ca6b8','#ba91a7','#82a998','#9b91bc'][i%5]
const dateRange = (period:Period, date:string):[string,string] => {
  const d = new Date(date+'T12:00:00')
  if(period==='day'||period==='range') return [date,date]
  if(period==='month') return [date.slice(0,7)+'-01',toISODate(new Date(d.getFullYear(),d.getMonth()+1,0))]
  const day=(d.getDay()+6)%7; const start=new Date(d); start.setDate(d.getDate()-day)
  const end=new Date(start); end.setDate(start.getDate()+6)
  return [toISODate(start),toISODate(end)]
}
const demoSellers:Seller[]=[
  {id:'d1',full_name:'Mariana Costa',email:null,photo_url:null,active:true},
  {id:'d2',full_name:'Camila Oliveira',email:null,photo_url:null,active:true},
  {id:'d3',full_name:'Beatriz Santos',email:null,photo_url:null,active:true},
  {id:'d4',full_name:'Larissa Almeida',email:null,photo_url:null,active:true},
  {id:'d5',full_name:'Fernanda Lima',email:null,photo_url:null,active:true},
  {id:'d6',full_name:'Juliana Souza',email:null,photo_url:null,active:true},
]
const demoSales:Sale[]=[
  {id:'s1',seller_id:'d1',sale_date:today(),revenue:1840,sales_count:12},
  {id:'s2',seller_id:'d2',sale_date:today(),revenue:1620,sales_count:10},
  {id:'s3',seller_id:'d3',sale_date:today(),revenue:1430,sales_count:9},
  {id:'s4',seller_id:'d4',sale_date:today(),revenue:1190,sales_count:8},
  {id:'s5',seller_id:'d5',sale_date:today(),revenue:980,sales_count:7},
  {id:'s6',seller_id:'d6',sale_date:today(),revenue:760,sales_count:6},
]
const demoRecognitions:Recognition[]=[
  {id:'r1',seller_id:'d1',stars:3,kind:'ideia_implementada',title:'Organização por categorias',description:'Sugeri reorganizar a exposição dos produtos por necessidade do cliente. A mudança facilitou a escolha e agilizou o atendimento.',recognized_at:today()},
  {id:'r2',seller_id:'d3',stars:2,kind:'boas_praticas',title:'Atendimento que acolhe',description:'Compartilhei uma abordagem de escuta ativa para entender melhor cada cliente e recomendar a solução certa.',recognized_at:today()},
  {id:'r3',seller_id:'d2',stars:1,kind:'boas_praticas',title:'Apoio ao time',description:'Ajudei na integração de uma nova colega durante o atendimento.',recognized_at:today()},
]
const defaultGoal:Goal={month:monthKey(today()),monthly_target:60000,daily_target:2500}

function useSession(){
 const [user,setUser]=useState<any>(null),[profile,setProfile]=useState<Profile|null>(null),[loading,setLoading]=useState(Boolean(supabase)),[profileError,setProfileError]=useState('')
 useEffect(()=>{
  const client=supabase
  if(!client){setLoading(false);return}
  let alive=true
  let request=0
  const fetchProfile=async(userId:string)=>{
   const current=++request
   setLoading(true);setProfileError('')
   try{
    const {data:p,error}=await client.from('profiles').select('*').eq('id',userId).maybeSingle()
    if(error)throw error
    if(alive&&current===request){
     setProfile(p as Profile|null)
     if(!p)setProfileError('Consulta retornou zero linhas. Sessão autenticada: '+userId+'. Confira se este ID é o mesmo da coluna usuario_id no SQL Editor e se a política RLS permite SELECT para id = auth.uid().')
    }
   }catch(e){
    if(alive&&current===request){
     setProfile(null)
     setProfileError(e instanceof Error?e.message:'Falha ao consultar public.profiles no Supabase.')
    }
   }finally{if(alive&&current===request)setLoading(false)}
  }
  client.auth.getSession().then(({data,error})=>{
   if(!alive)return
   if(error){setProfileError(error.message);setLoading(false);return}
   const sessionUser=data.session?.user??null
   setUser(sessionUser)
   if(sessionUser)void fetchProfile(sessionUser.id)
   else{setProfile(null);setProfileError('');setLoading(false)}
  }).catch(e=>{if(alive){setProfileError(e instanceof Error?e.message:'Falha ao recuperar a sessão.');setLoading(false)}})
  const {data:{subscription}}=client.auth.onAuthStateChange((_event,session)=>{
   if(!alive)return
   const sessionUser=session?.user??null
   setUser(sessionUser)
   if(sessionUser)Promise.resolve().then(()=>{if(alive)void fetchProfile(sessionUser.id)})
   else{request++;setProfile(null);setProfileError('');setLoading(false)}
  })
  return()=>{alive=false;subscription.unsubscribe()}
 },[])
 return {user,profile,loading,profileError}
}
function useData(){
 const [sellers,setSellers]=useState<Seller[]>(hasSupabase?[]:demoSellers),[sales,setSales]=useState<Sale[]>(hasSupabase?[]:demoSales),[recognitions,setRecognitions]=useState<Recognition[]>(hasSupabase?[]:demoRecognitions),[goals,setGoals]=useState<Goal[]>(hasSupabase?[]:[defaultGoal]),[sectorGoals,setSectorGoals]=useState<SectorGoal[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[updatedAt,setUpdatedAt]=useState<Date|null>(hasSupabase?null:new Date())
 const load=useCallback(async()=>{
  const client=supabase
  if(!client)return
  setBusy(true);setError('')
  try{
   const fetchAll=async(table:'sellers'|'sales_daily'|'recognitions'|'goals'|'sector_goals',column:string,ascending=true)=>{
    const all:Record<string,unknown>[]=[]
    const pageSize=1000
    for(let offset=0;;offset+=pageSize){
     const {data,error}=await client.from(table).select('*').order(column,{ascending}).range(offset,offset+pageSize-1)
     if(error)throw error
     all.push(...(data||[]) as Record<string,unknown>[])
     if(!data||data.length<pageSize)break
    }
    return all
   }
   const [a,b,c,d,e]=await Promise.all([
    fetchAll('sellers','full_name'),
    fetchAll('sales_daily','sale_date',false),
    fetchAll('recognitions','recognized_at',false),
    fetchAll('goals','month',false),
    fetchAll('sector_goals','week_start',false).catch(()=>[])
   ])
   setSellers(a as unknown as Seller[]);setSales(b as unknown as Sale[]);setRecognitions(c as unknown as Recognition[]);setGoals(d as unknown as Goal[]);setSectorGoals(e as unknown as SectorGoal[]);setUpdatedAt(new Date())
  }catch(e){
   setError(e instanceof Error?e.message:'Não foi possível carregar os dados do Supabase.')
  }finally{setBusy(false)}
 },[])
 useEffect(()=>{
  const client=supabase
  if(!client)return
  let alive=true
  client.auth.getSession().then(({data})=>{if(alive&&data.session)void load()})
  const {data:{subscription}}=client.auth.onAuthStateChange((_event,session)=>{
   if(session)Promise.resolve().then(()=>{if(alive)void load()})
  })
  return()=>{alive=false;subscription.unsubscribe()}
 },[load])
 useEffect(()=>{
  let alive=true
  const refresh=()=>{if(alive&&document.visibilityState==='visible')void load()}
  const timer=window.setInterval(refresh,60000)
  document.addEventListener('visibilitychange',refresh)
  return()=>{alive=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh)}
 },[load])
 return {sellers,sales,recognitions,goals,sectorGoals,setSellers,setSales,setRecognitions,setGoals,setSectorGoals,load,busy,error,updatedAt}
}

function Avatar({seller,size='md',index=0}:{seller:Seller;size?:'sm'|'md'|'lg'|'xl';index?:number}){
 return <div className={'avatar '+size} style={{background:initialsColor(index)}}>{seller.photo_url?<img src={seller.photo_url} alt={seller.full_name}/>:initial(seller.full_name)}</div>
}
function Brand(){return <div className="brand"><div className="brand-mark"><Trophy size={20}/></div><div><strong>gestão<span>à vista</span></strong><small>RESULTADOS QUE INSPIRAM</small></div></div>}
function DemoNotice(){return !hasSupabase?<div className="demo-notice"><AlertCircle size={15}/> MODO DEMONSTRAÇÃO — conecte o Supabase para autenticação e dados reais.</div>:null}
function Login({role}:{role:'admin'|'viewer'}){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const nav=useNavigate()
 async function submit(e:FormEvent){e.preventDefault();setError('');if(!supabase){setError('Configure as variáveis do Supabase para habilitar o login.');return}setBusy(true);try{const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});if(error){setError(error.message);return}nav(role==='admin'?'/admin':'/viewer')}catch(e){setError(e instanceof Error?e.message:'Não foi possível conectar ao serviço de autenticação.')}finally{setBusy(false)}}
 return <div className="login-page"><div className="login-side"><Brand/><div className="login-message"><span className="eyebrow">CULTURA DE RESULTADOS</span><h1>Grandes resultados começam com <em>visibilidade.</em></h1><p>Informação clara, reconhecimento e um time que cresce junto.</p><div className="login-stat"><Trophy/><div><strong>Uma equipe. Um objetivo.</strong><small>Cada conquista conta.</small></div></div></div><div className="login-foot">GESTÃO À VISTA · DESEMPENHO EM TEMPO REAL</div></div><div className="login-form-wrap"><form className="login-card" onSubmit={submit}><div className="form-icon">{role==='admin'?<ShieldCheck/>:<Users/>}</div><span className="eyebrow">{role==='admin'?'ÁREA RESTRITA':'ACESSO DA EQUIPE'}</span><h2>{role==='admin'?'Administração':'Painel da equipe'}</h2><p>{role==='admin'?'Entre para gerenciar os resultados e reconhecer o time.':'Entre para acompanhar os resultados da equipe.'}</p><label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="seu@email.com" required/></label><label>Senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha" required/></label>{error&&<div className="error-box">{error}</div>}<button className="btn primary full" disabled={busy}>{busy?'Entrando...':'Entrar'}<ChevronRight size={17}/></button><Link to="/" className="back-link">Voltar ao painel de visualização</Link></form></div></div>
}
function rankRows(sellers:Seller[],sales:Sale[],period:Period,date:string,rangeEnd?:string){
 const [start,defaultEnd]=dateRange(period,date)
 const end=period==='range'&&rangeEnd?rangeEnd:defaultEnd
 return sellers.filter(s=>s.active&&s.can_sell!==false).map(s=>{
  const rows=sales.filter(x=>x.seller_id===s.id&&x.sale_date>=start&&x.sale_date<=end)
  const revenue=rows.reduce((n,x)=>n+Number(x.revenue),0),count=rows.reduce((n,x)=>n+Number(x.sales_count),0)
  const grossRevenue=rows.reduce((n,x)=>n+Number(x.gross_revenue??Math.max(Number(x.revenue),0)),0)
  return {seller:s,revenue,count,ticket:count?grossRevenue/count:0,sector:s.sector,contribution:0,metricActual:0}
 }).sort((a,b)=>b.revenue-a.revenue||b.count-a.count||a.seller.full_name.localeCompare(b.seller.full_name,'pt-BR'))
}
const periodTag=(p:Period)=>p==='day'?'Hoje':p==='week'?'Esta semana':p==='range'?'Período selecionado':'Este mês'
const periodTabs:[Period,string][]=[['day','Diário'],['week','Semanal'],['month','Mensal'],['range','Período']]
const sectors:Sector[]=['salao','digital','checkout']
const sectorLabel=(s:Sector)=>s==='salao'?'SALÃO':s==='digital'?'DIGITAL':'CHECKOUT'
const weekStart=(iso:string)=>dateRange('week',iso)[0]
const sectorActual=(sector:Sector,sales:Sale[],sellerIds:string[],start:string,end:string)=>sales.filter(x=>sellerIds.includes(x.seller_id)&&x.sale_date>=start&&x.sale_date<=end).reduce((sum,x)=>sum+(sector==='checkout'?Number(x.revenue):Number(x.sales_count)),0)
const sellerColor=(id:string)=>{let h=0;for(const ch of id)h=(h*31+ch.charCodeAt(0))>>>0;return ['#B07A5A','#6E8CA6','#7E9A86','#8A7FB0','#5E8F9E','#A0708A','#7A8F5E','#9A7A50'][h%8]}
const clock=(d:Date)=>d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
const longDate=(iso:string)=>new Date(iso+'T12:00:00').toLocaleDateString('pt-BR',{day:'numeric',month:'short'}).replace('.','')
const prefersReducedMotion=()=>typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
function TvAvatar({seller,className}:{seller:Seller;className:string}){
 return <span className={'tv-avatar '+className} style={{background:sellerColor(seller.id)}}>{seller.photo_url?<img src={seller.photo_url} alt=""/>:initial(seller.full_name)}</span>
}
function TvStar(){return <svg className="tv-star" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>}
// Janela circular: percorre até o fim e reinicia no primeiro grupo.
function useSlidingWindow(length:number,size:number,interval:number,resetKey:string){
 const maxStart=Math.max(0,length-size)
 const [step,setStep]=useState(0)
 useEffect(()=>{setStep(0)},[resetKey,length])
 useEffect(()=>{
  if(maxStart===0||prefersReducedMotion())return
  const timer=window.setInterval(()=>setStep(v=>v>=maxStart?0:v+1),interval)
  return()=>window.clearInterval(timer)
 },[maxStart,interval])
 const safe=Math.min(step,maxStart)
 return {start:safe,key:safe}
}
// mode 'values': painel TV com valores em reais. mode 'percent': mesma tela, com a contribuição de cada uma em % da meta mensal e sem valores em reais.
function Dashboard({data,mode='values',admin=false}:{data:ReturnType<typeof useData>;mode?:'values'|'percent';admin?:boolean}){
 const percent=mode==='percent'
 const [period,setPeriod]=useState<Period>('month'),[date,setDate]=useState(today()),[endDate,setEndDate]=useState(today()),[now,setNow]=useState(new Date())
 useEffect(()=>{const t=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(t)},[])
 const rangeEnd=endDate>=date?endDate:date
 const rows=useMemo(()=>rankRows(data.sellers,data.sales,period,date,rangeEnd),[data.sellers,data.sales,period,date,rangeEnd])
 const sectorWindow=period==='week'?dateRange('week',date):dateRange('month',date)
 const sectorStats=useMemo(()=>sectors.map(sector=>{
  const members=data.sellers.filter(s=>s.active&&s.can_sell!==false&&s.sector===sector)
  const weeks=data.sectorGoals.filter(g=>g.sector===sector&&(period==='week'?g.week_start===sectorWindow[0]:g.week_start<=sectorWindow[1]&&new Date(g.week_start+'T12:00:00').getTime()+6*86400000>=new Date(sectorWindow[0]+'T12:00:00').getTime()))
  const target=weeks.reduce((sum,g)=>sum+Number(g.target),0)
  const actual=sectorActual(sector,data.sales,members.map(s=>s.id),sectorWindow[0],sectorWindow[1])
  return {sector,members,target,actual,remaining:Math.max(0,target-actual),percent:target>0?actual/target*100:0,individualTarget:members.length?target/members.length:0}
 }),[data.sellers,data.sales,data.sectorGoals,period,sectorWindow[0],sectorWindow[1]])
 const sectorBySeller=new Map<string,{sector:Sector;target:number;actual:number;percent:number}>()
 for(const st of sectorStats)for(const seller of st.members){const actual=sectorActual(st.sector,data.sales,[seller.id],sectorWindow[0],sectorWindow[1]);sectorBySeller.set(seller.id,{sector:st.sector,target:st.individualTarget,actual,percent:st.individualTarget>0?actual/st.individualTarget*100:0})}
 const percentRows=useMemo(()=>rows.filter(r=>r.seller.sector&&sectorBySeller.has(r.seller.id)).map(r=>({...r,contribution:sectorBySeller.get(r.seller.id)!.percent,sector:sectorBySeller.get(r.seller.id)!.sector,metricActual:sectorBySeller.get(r.seller.id)!.actual})).sort((a,b)=>b.contribution-a.contribution||a.seller.full_name.localeCompare(b.seller.full_name,'pt-BR')),[rows,sectorStats,data.sales,sectorWindow[0],sectorWindow[1]])
 const displayRows=percent?percentRows:rows
 const monthRevenue=useMemo(()=>rankRows(data.sellers,data.sales,'month',date).reduce((n,r)=>n+r.revenue,0),[data.sellers,data.sales,date])
 const periodRevenue=rows.reduce((n,r)=>n+r.revenue,0),periodCount=rows.reduce((n,r)=>n+r.count,0)
 const periodTicket=periodCount?rows.reduce((n,r)=>n+r.ticket*r.count,0)/periodCount:0
 const periodLabel=period==='day'?'no dia':period==='week'?'na semana':period==='range'?'no período':'no mês'
 const savedGoal=data.goals.find(g=>g.month===monthKey(date))
 // Na tela de %, sem meta cadastrada vale a referência padrão definida para essa tela.
 const target=Number(savedGoal?.monthly_target??(percent?500000:defaultGoal.monthly_target))
 const pct=(n:number,digits=2)=>n.toLocaleString('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits})+'%'
 const bar=(n:number)=>Math.min(100,Math.max(0,n))+'%'
 const progress=target?Math.max(0,Math.min(100,monthRevenue/target*100)):0
 // O ranking de boas ações é histórico e independente dos filtros de vendas.
 const actionRanking=useMemo(()=>data.sellers.filter(s=>s.active).map(s=>{
  const entries=data.recognitions.filter(r=>r.seller_id===s.id&&r.stars>0)
  return {seller:s,stars:entries.reduce((n,r)=>n+Number(r.stars||0),0),actions:entries.length}
 }).filter(r=>r.actions>0).sort((a,b)=>b.stars-a.stars||b.actions-a.actions||a.seller.full_name.localeCompare(b.seller.full_name,'pt-BR')),[data.sellers,data.recognitions])
 const recentRecognitions=useMemo(()=>[...data.recognitions].filter(r=>r.stars>0).sort((a,b)=>b.recognized_at.localeCompare(a.recognized_at)).slice(0,3),[data.recognitions])
 const sellerById=useMemo(()=>new Map(data.sellers.map(s=>[s.id,s])),[data.sellers])
 const ranking=useSlidingWindow(displayRows.length,8,4000,period+date+endDate)
 const actions=useSlidingWindow(actionRanking.length,4,4000,'actions')
 const visibleRows=displayRows.slice(ranking.start,ranking.start+8)
 const visibleActions=actionRanking.slice(actions.start,actions.start+4)
 const [first,second,third]=displayRows
 const loading=data.busy&&!data.updatedAt
 const emptySales=data.error&&!data.updatedAt?'Não foi possível carregar os dados. Nova tentativa em 1 minuto.':loading?'Carregando dados…':'Nenhuma venda registrada neste período.'
 return <div className="tv">
  <header className="tv-header">
   <div className="tv-brand"><span className="tv-brand-mark"><Trophy aria-hidden="true"/></span><h1>{percent?'Contribuição para a meta':'O resultado é de todos nós.'}</h1></div>
   <div className="tv-header-tools">
    <div className="tv-periods" role="group" aria-label="Período">{(percent?periodTabs.filter(([p])=>p==='week'||p==='month'):periodTabs).map(([p,label])=><button type="button" key={p} aria-pressed={period===p} onClick={()=>setPeriod(p)}>{label}</button>)}</div>{percent?<Link className="tv-switch" to={admin?'/admin':'/viewer/board'}>{admin?'Voltar ao admin':'Ver em valores'}</Link>:<Link className="tv-switch" to="/viewer/percentage">Ver em %</Link>}
    {period==='range'
     ?<div className="tv-dates"><label>De<input type="date" value={date} max={endDate} onChange={e=>{if(e.target.value){setDate(e.target.value);if(e.target.value>endDate)setEndDate(e.target.value)}}}/></label><label>Até<input type="date" value={endDate} min={date} onChange={e=>{if(e.target.value)setEndDate(e.target.value)}}/></label></div>
     :<label className="tv-dates"><span className="tv-visually-hidden">Data de referência</span><input type="date" value={date} onChange={e=>{if(e.target.value){setDate(e.target.value);setEndDate(e.target.value)}}}/></label>}
    <span className="tv-clock">{period!=='range'&&<>{longDate(date)}, </>}<strong>{clock(now)}</strong></span>
    {data.error
     ?<span className="tv-status is-offline" role="status">{data.updatedAt?'Sem atualização desde '+clock(data.updatedAt):'Dados não carregados'}</span>
     :<span className="tv-status" role="status">{data.updatedAt?'Atualizado às '+clock(data.updatedAt):'Carregando dados'}</span>}
   </div>
  </header>

  <section className="tv-kpis" aria-label="Meta mensal e indicadores do período">
   <div className={percent?'tv-goal tv-goal-hidden':'tv-goal'}>
    <div className="tv-goal-row"><span className="tv-goal-title">Meta de {monthLabel(date)}</span>{percent?<span>{savedGoal?'Meta cadastrada no sistema':'Meta de referência padrão'}</span>:<span><strong>{money(monthRevenue)}</strong> de <strong>{money(target)}</strong></span>}</div>
    <div className="tv-goal-row"><span className="tv-goal-value">{progress.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})}% <small>alcançados</small></span><span>Faltam <strong>{percent?pct(Math.max(0,100-progress),1):money(Math.max(0,target-monthRevenue))}</strong></span></div>
    <div className="tv-goal-track" role="progressbar" aria-label="Progresso da meta mensal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><div style={{width:progress+'%'}}/></div>
   </div>
   {percent?<div className="tv-sector-metrics">{sectorStats.map(st=><article className="tv-sector-card" key={st.sector}><div className="tv-sector-head"><strong>{sectorLabel(st.sector)}</strong><span>{period==='week'?'META DA SEMANA':'META DO MÊS'}</span></div><strong className="tv-sector-percent">{pct(st.percent,1)}</strong><div className="tv-sector-detail">{st.sector==='checkout'?exactMoney(st.actual):st.actual.toLocaleString('pt-BR')} de {st.sector==='checkout'?exactMoney(st.target):st.target.toLocaleString('pt-BR')} {st.sector==='checkout'?'faturados':st.sector==='salao'?'vendas':'conversões'}</div><div className="tv-sector-track"><i style={{width:Math.min(100,Math.max(0,st.percent))+'%'}}/></div><small>{st.percent>=100?'Meta superada — '+pct(st.percent,1):'Faltam '+(st.sector==='checkout'?exactMoney(st.remaining):st.remaining.toLocaleString('pt-BR'))} · {st.members.length} participantes</small></article>)}</div>:<div className="tv-metrics">
    <div className="tv-metric"><span>Faturamento do período</span><strong>{money(periodRevenue)}</strong><small>Resultado {periodLabel}</small></div>
    <div className="tv-metric"><span>Ticket médio do período</span><strong>{exactMoney(periodTicket)}</strong><small>{periodCount} {periodCount===1?'venda':'vendas'} {periodLabel}</small></div>
    <div className="tv-metric"><span>Quantidade de vendas</span><strong>{periodCount}</strong><small>Vendas registradas {periodLabel}</small></div>
   </div>}
  </section>

  <section className="tv-body">
   <div className="tv-panel tv-podium">
    <div className="tv-panel-head"><h2>Pódio</h2><span>{periodTag(period)}</span></div>
    {first?<div className="tv-podium-body">
     <div className="tv-podium-first">
      <span className="tv-podium-avatar"><TvAvatar seller={first.seller} className="xl"/><b>1º</b></span>
      <strong>{first.seller.full_name}</strong><span className="tv-podium-value">{percent?pct(first.contribution):money(first.revenue)}</span><small>{percent?(first.sector==='checkout'?exactMoney(first.metricActual):first.metricActual.toLocaleString('pt-BR')+(first.sector==='salao'?' vendas':' conversões')):first.count+' '+(first.count===1?'venda':'vendas')}</small>
     </div>
     <div className="tv-podium-rest">
      {[second,third].map((r,i)=>r?<div className={'tv-podium-place place-'+(i+2)} key={r.seller.id}>
       <span className="tv-podium-avatar"><TvAvatar seller={r.seller} className="lg"/><b>{i+2}º</b></span>
       <div><strong>{r.seller.full_name}</strong><span className="tv-podium-value">{percent?pct(r.contribution):money(r.revenue)}</span><small>{percent?(r.sector==='checkout'?exactMoney(r.metricActual):r.metricActual.toLocaleString('pt-BR')+(r.sector==='salao'?' vendas':' conversões')):r.count+' '+(r.count===1?'venda':'vendas')}</small></div>
      </div>:null)}
     </div>
    </div>:<p className="tv-empty">{emptySales}</p>}
   </div>

   <div className={percent?'tv-panel tv-ranking tv-percent-ranking':'tv-panel tv-ranking'}>
    <div className="tv-panel-head"><h2>Ranking de vendas</h2><span>{displayRows.length} {displayRows.length===1?'colaboradora':'colaboradoras'}</span></div>
    <table>
     <thead>{percent
      ?<tr><th scope="col">Pos.</th><th scope="col">Colaborador</th><th scope="col">Contribuição na meta individual</th><th scope="col">Indicador</th></tr>
      :<tr><th scope="col">Pos.</th><th scope="col">Vendedora</th><th scope="col">Valor vendido</th><th scope="col">Vendas</th><th scope="col">Ticket médio</th></tr>}</thead>
     <tbody key={ranking.key} className="tv-ranking-body">{visibleRows.map((r,v)=>{const i=ranking.start+v;const isBottomThree=displayRows.length>3&&i>=displayRows.length-3;return <tr key={r.seller.id} className={isBottomThree?'tv-bottom-three':''}>
      <td><span className={i<3?'tv-pos is-top':'tv-pos'}>{String(i+1).padStart(2,'0')}</span></td>
      <td><span className="tv-seller"><TvAvatar seller={r.seller} className="sm"/><span className="tv-seller-name">{r.seller.full_name}</span>{i===0&&<span className="tv-leader">Líder</span>}</span></td>
      {percent
       ?<><td><span className="tv-percent-cell"><span className="tv-percent-bar" aria-hidden="true"><i style={{width:bar(first?r.contribution/Math.max(first.contribution,0.0001)*100:0)}}/></span><strong>{pct(r.contribution)}</strong></span></td><td className="tv-num tv-muted">{r.sector==='checkout'?exactMoney(r.metricActual):r.metricActual.toLocaleString('pt-BR')}</td></>
       :<><td className="tv-num tv-strong">{exactMoney(r.revenue)}</td><td className="tv-num tv-muted">{r.count}</td><td className="tv-num tv-muted">{exactMoney(r.ticket)}</td></>}
     </tr>})}</tbody>
    </table>
    {displayRows.length===0&&<p className="tv-empty">{percent?'Cadastre os setores das colaboradoras e as metas semanais no admin.':emptySales}</p>}
   </div>

   <div className="tv-panel tv-culture">
    <div>
     <div className="tv-panel-head"><h2>Ranking de boas ações</h2><span>Desde o início</span></div>
     <ol className="tv-actions" key={actions.key}>{visibleActions.map((r,v)=>{const pos=actions.start+v;return <li key={r.seller.id}>
      <span className="tv-actions-pos">{String(pos+1).padStart(2,'0')}</span><span className="tv-actions-name">{r.seller.full_name}</span>
      <span className="tv-muted">{r.actions} {r.actions===1?'ação':'ações'}</span>
      <span className="tv-stars" aria-label={r.stars+(r.stars===1?' estrela':' estrelas')}><TvStar/>{r.stars}</span>
     </li>})}</ol>
     {actionRanking.length===0&&<p className="tv-empty tv-empty-card">Ainda não há boas ações reconhecidas.</p>}
    </div>
    <div className="tv-recents">
     <h2>Reconhecimentos recentes</h2>
     {recentRecognitions.map(rec=><article key={rec.id}>
      <div className="tv-recent-head"><strong>{sellerById.get(rec.seller_id)?.full_name||'Colaboradora'}</strong><span className="tv-recent-title">{rec.title}</span><span className="tv-stars" aria-label={rec.stars+(rec.stars===1?' estrela':' estrelas')}><TvStar/>{rec.stars}</span></div>
      <p>{rec.description}</p>
     </article>)}
     {recentRecognitions.length===0&&<p className="tv-empty tv-empty-card">Os reconhecimentos aparecerão aqui com o nome, o motivo e as estrelas.</p>}
    </div>
   </div>
  </section>
 </div>
}

function Metric({icon,label,value,detail,tone}:{icon:ReactNode;label:string;value:string;detail:string;tone:string}){
 return <div className="metric-card"><div className={'metric-icon '+tone}>{icon}</div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}
function Guard({children,role}:{children:ReactNode;role:'admin'|'viewer'}){
 const {user,profile,loading,profileError}=useSession()
 if(!hasSupabase)return <Navigate to={role==='admin'?'/admin/login':'/viewer/login'} replace/>
 if(loading)return <div className="loading-screen">Verificando acesso...</div>
 if(!user)return <Navigate to={role==='admin'?'/admin/login':'/viewer/login'} replace/>
 if(!profile?.active)return <div className="loading-screen"><div>Acesso não liberado.<br/>{profileError||'O perfil está inativo ou não foi encontrado.'}<br/>E-mail da sessão: {user.email||'não disponível'}</div></div>
 if(role==='admin'&&profile.role!=='admin')return <Navigate to="/viewer" replace/>
 return <>{children}</>
}
function Admin(){
 const data=useData(),nav=useNavigate()
 const [tab,setTab]=useState('overview'),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<ImportRow[]>([]),[parseError,setParseError]=useState(''),[message,setMessage]=useState(''),[saving,setSaving]=useState(false)
 const [sellerName,setSellerName]=useState(''),[sellerEmail,setSellerEmail]=useState(''),[sellerCanSell,setSellerCanSell]=useState(true),[sellerSector,setSellerSector]=useState<Sector>('salao')
 const [goal,setGoal]=useState(defaultGoal),[sectorGoal,setSectorGoal]=useState<{sector:Sector;week_start:string;target:number}>({sector:'salao',week_start:weekStart(today()),target:375})
 const [recSeller,setRecSeller]=useState(''),[recTitle,setRecTitle]=useState(''),[recDescription,setRecDescription]=useState(''),[recStars,setRecStars]=useState(1),[recKind,setRecKind]=useState('boas_praticas')
 const [photoSeller,setPhotoSeller]=useState('')
 useEffect(()=>{const existing=data.goals.find(g=>g.month===goal.month);if(existing)setGoal(existing)},[data.goals,goal.month])
 async function logout(){await supabase?.auth.signOut();nav('/admin/login')}
 function parseFile(f:File){
  setFile(f);setMessage('');setParseError('');setPreview([])
  const finish=(rawRows:Record<string,unknown>[])=>{
   const rows=rawRows.filter(raw=>Object.values(raw).some(value=>value!==null&&value!==undefined&&String(value).trim()!=='')).map(raw=>{
    const fields=new Map<string,unknown>(Object.entries(raw).map(([key,value])=>[normalizeHeader(key),value] as [string,unknown]))
    const get=(...names:string[])=>{for(const name of names){const value=fields.get(normalizeHeader(name));if(value!==undefined&&value!==null&&String(value).trim()!=='')return value}return ''}
    return {
     data:normalizeDate(get('data','date')),
     vendedora:String(get('vendedora','vendedor','colaboradora','nome')).trim(),
     valor:parseImportAmount(get('valor','faturamento liquido (r$)','faturamento liquido','faturamento','valor vendido','receita')),
     vendas:parseImportAmount(get('vendas','nº de vendas','numero de vendas','quantidade de vendas','qtd vendas','cupons')),
     email:String(get('email','e-mail')).trim()||undefined
    }
   })
   if(!rows.length){setParseError('O arquivo não contém registros para importar.');return}
   const invalidIndex=rows.findIndex(x=>!x.data||!x.vendedora||x.valor===''||!Number.isFinite(Number(x.valor))||x.vendas===''||!Number.isInteger(Number(x.vendas))||Number(x.vendas)<0)
   if(invalidIndex>=0){setParseError('Registro '+(invalidIndex+2)+': confira Data, Vendedora, Faturamento líquido e Nº de vendas. Use datas AAAA-MM-DD ou DD/MM/AAAA, valores numéricos (inclusive negativos para estornos) e quantidade inteira de vendas igual ou maior que zero.');return}
   setPreview(rows)
  }
  const isExcel=/\.(xlsx|xls)$/i.test(f.name)
  if(isExcel){
   f.arrayBuffer().then(buffer=>{
    const workbook=XLSX.read(buffer,{type:'array',cellDates:true})
    const sheet=workbook.Sheets['BASE VENDAS']||workbook.Sheets[workbook.SheetNames[0]]
    if(!sheet){setParseError('Nenhuma aba encontrada no arquivo Excel.');return}
    finish(XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:'',raw:true}))
   }).catch(e=>setParseError(e instanceof Error?e.message:'Falha ao ler o arquivo Excel.'))
  }else{
   Papa.parse<Record<string,unknown>>(f,{header:true,delimiter:'',skipEmptyLines:'greedy',complete:r=>{const firstError=r.errors[0];if(firstError){setParseError('Falha ao interpretar o CSV na linha '+((firstError.row??0)+2)+': '+firstError.message);return}finish(r.data)},error:e=>setParseError(e.message)})
  }
 }
 async function importCsv(){if(!supabase||!preview.length)return;setSaving(true);setMessage('');setParseError('');try{
  const sellerKey=(row:ImportRow)=>(row.email?row.email.trim().toLocaleLowerCase('pt-BR'):normalizeHeader(row.vendedora))
  const unique=[...new Map<string,ImportRow>(preview.map(r=>[sellerKey(r),r] as [string,ImportRow])).values()]
  const sellerMap=new Map<string,string>()
  for(const row of unique){
   let query=supabase.from('sellers').select('id').limit(1)
   query=row.email?query.ilike('email',row.email.trim()):query.ilike('full_name',row.vendedora.trim())
   const {data,error}=await query.maybeSingle()
   if(error)throw error
   let id=data?.id as string|undefined
   if(!id){
    const {data:created,error:e}=await supabase.from('sellers').insert({full_name:row.vendedora.trim(),email:row.email?.trim().toLocaleLowerCase('pt-BR')||null}).select('id').single()
    if(e)throw e
    id=created.id
   }else{
    const {error:e}=await supabase.from('sellers').update({full_name:row.vendedora.trim()}).eq('id',id)
    if(e)throw e
   }
   if(!id)throw new Error('Não foi possível identificar ou cadastrar a colaboradora: '+row.vendedora)
   sellerMap.set(sellerKey(row),id)
  }
  const totals=new Map<string,{seller_id:string;sale_date:string;revenue:number;sales_count:number;gross_revenue:number;refund_amount:number}>()
  for(const row of preview){
   const id=sellerMap.get(sellerKey(row))
   if(!id)throw new Error('Colaboradora não identificada: '+row.vendedora)
   const amount=Number(row.valor)
   const key=id+'|'+row.data
   const current=totals.get(key)||{seller_id:id,sale_date:row.data,revenue:0,sales_count:0,gross_revenue:0,refund_amount:0}
   current.revenue+=amount
   if(amount>=0)current.gross_revenue+=amount
   else current.refund_amount+=Math.abs(amount)
   if(amount>=0)current.sales_count+=Number(row.vendas)
   totals.set(key,current)
  }
  const payload=[...totals.values()].map(row=>({...row,source:'csv'}))
  const {error}=await supabase.from('sales_daily').upsert(payload,{onConflict:'seller_id,sale_date'})
  if(error)throw error
  setMessage('Importação concluída: '+preview.length+' linhas consolidadas em '+payload.length+' registros, sem duplicidade por colaboradora e data.')
  setPreview([]);setFile(null);await data.load()
 }catch(e){setParseError(e instanceof Error?e.message:'Falha na importação.')}finally{setSaving(false)}}
 async function addSeller(e:FormEvent){e.preventDefault();if(!supabase)return;const {error}=await supabase.from('sellers').insert({full_name:sellerName,email:sellerEmail||null,can_sell:sellerCanSell,sector:sellerSector});if(error)setMessage(error.message);else{setSellerName('');setSellerEmail('');setSellerCanSell(true);setSellerSector('salao');setMessage('Colaboradora cadastrada com setor vinculado.');await data.load()}}
 async function toggleSellerSales(seller:Seller){if(!supabase)return;const next=seller.can_sell===false;const {error}=await supabase.from('sellers').update({can_sell:next}).eq('id',seller.id);if(error)setMessage(error.message);else{setMessage(next?'Colaboradora vinculada ao ranking de vendas.':'Colaboradora removida do ranking de vendas; continuará no ranking de boas ações.');await data.load()}}
 async function updateSellerSector(seller:Seller,sector:Sector){if(!supabase)return;const {error}=await supabase.from('sellers').update({sector}).eq('id',seller.id);if(error)setMessage(error.message);else{setMessage('Setor de '+seller.full_name+' atualizado para '+sectorLabel(sector)+'.');await data.load()}}
 async function saveGoal(e:FormEvent){e.preventDefault();if(!supabase)return;const {error}=await supabase.from('goals').upsert(goal,{onConflict:'month'});setMessage(error?.message||'Meta mensal geral salva.');await data.load()}
 async function saveSectorGoal(e:FormEvent){e.preventDefault();if(!supabase)return;const monday=weekStart(sectorGoal.week_start);const {error}=await supabase.from('sector_goals').upsert({...sectorGoal,week_start:monday},{onConflict:'sector,week_start'});if(error)setMessage(error.message);else{setMessage('Meta semanal do '+sectorLabel(sectorGoal.sector)+' salva.');await data.load()}}
 async function addRecognition(e:FormEvent){e.preventDefault();if(!supabase)return;const {error}=await supabase.from('recognitions').insert({seller_id:recSeller,stars:recStars,kind:recKind,title:recTitle,description:recDescription,recognized_at:today()});setMessage(error?.message||'Reconhecimento publicado no painel.');if(!error){setRecTitle('');setRecDescription('');setRecStars(1);await data.load()}}
 async function uploadPhoto(e:FormEvent){e.preventDefault();const el=document.getElementById('seller-photo') as HTMLInputElement;const f=el.files?.[0];if(!f||!supabase||!photoSeller)return;const path=photoSeller+'/'+Date.now()+'-'+f.name.replace(/[^a-zA-Z0-9.-]/g,'_');const {error}=await supabase.storage.from('seller-photos').upload(path,f,{upsert:true});if(error){setMessage(error.message);return}const {data:pub}=supabase.storage.from('seller-photos').getPublicUrl(path);const {error:e2}=await supabase.from('sellers').update({photo_url:pub.publicUrl}).eq('id',photoSeller);setMessage(e2?.message||'Foto atualizada.');await data.load()}
 return <div className="admin-shell"><aside className="admin-sidebar"><Brand/><div className="sidebar-label">GESTÃO COMERCIAL</div><nav>{[['overview','Visão geral',LayoutDashboard],['import','Importar vendas',Upload],['sellers','Colaboradoras',Users],['goals','Metas',Target],['recognitions','Reconhecimentos',Star]] .map(([id,label,Icon])=><button key={String(id)} className={tab===id?'selected':''} onClick={()=>setTab(String(id))}>{<Icon size={18}/>} {String(label)}<ChevronRight size={14}/></button>)}</nav><div className="sidebar-bottom"><button onClick={()=>nav('/')}><Monitor size={17}/> Abrir painel TV</button><button onClick={()=>nav('/admin/percentage')}><TrendingUp size={17}/> Tela de porcentagens</button><button onClick={logout}><LogOut size={17}/> Sair</button></div></aside><main className="admin-content"><header className="admin-top"><div><span className="eyebrow">GESTÃO À VISTA / ADMINISTRAÇÃO</span><h1>{({overview:'Visão geral',import:'Importar vendas',sellers:'Colaboradoras',goals:'Metas comerciais',recognitions:'Reconhecimentos'} as Record<string,string>)[tab]}</h1></div><div className="admin-user"><span className="admin-online"/> ADMINISTRAÇÃO</div></header><DemoNotice/>{message&&<div className="success-message"><CheckCircle2 size={16}/>{message}<button onClick={()=>setMessage('')}><X size={15}/></button></div>}{parseError&&<div className="error-box">{parseError}</div>}
 {data.error&&<div className="error-box">{data.error}</div>}
 {tab==='overview'&&<><div className="admin-cards"><Metric icon={<Users/>} label="COLABORADORAS ATIVAS" value={String(data.sellers.filter(s=>s.active).length)} detail="Equipe cadastrada" tone="blue"/><Metric icon={<TrendingUp/>} label="FATURAMENTO DO MÊS" value={money(data.sales.filter(s=>s.sale_date.startsWith(today().slice(0,7))).reduce((n,s)=>n+Number(s.revenue),0))} detail="Vendas registradas" tone="green"/><Metric icon={<ShoppingBag/>} label="VENDAS NO MÊS" value={String(data.sales.filter(s=>s.sale_date.startsWith(today().slice(0,7))).reduce((n,s)=>n+Number(s.sales_count),0))} detail="Atendimentos convertidos" tone="gold"/><Metric icon={<Star/>} label="ESTRELAS CONCEDIDAS" value={String(data.recognitions.reduce((n,r)=>n+r.stars,0))} detail="Reconhecimentos acumulados" tone="purple"/></div><div className="admin-panel"><div className="panel-head"><div><h2>Desempenho do mês</h2><p>Ranking atualizado com os registros importados.</p></div><button className="btn secondary" onClick={()=>data.load()}><RefreshCw size={15}/> Atualizar dados</button></div><div className="table-wrap"><table><thead><tr><th>POSIÇÃO</th><th>VENDEDORA</th><th>FATURAMENTO</th><th>VENDAS</th><th>TICKET MÉDIO</th></tr></thead><tbody>{rankRows(data.sellers,data.sales,'month',today()).map((r,i)=><tr key={r.seller.id}><td><b className="rank-number">{i+1}</b></td><td>{r.seller.full_name}</td><td className="money-cell">{exactMoney(r.revenue)}</td><td>{r.count}</td><td>{exactMoney(r.ticket)}</td></tr>)}</tbody></table></div></div><div className="admin-shortcuts"><button onClick={()=>setTab('import')}><Upload/><strong>Importar vendas</strong><span>Atualize os dados diários</span><ArrowUpRight/></button><button onClick={()=>setTab('recognitions')}><Star/><strong>Reconhecer equipe</strong><span>Valorize boas práticas</span><ArrowUpRight/></button><button onClick={()=>setTab('goals')}><Target/><strong>Definir metas</strong><span>Configure o objetivo do mês</span><ArrowUpRight/></button></div></>}
 {tab==='import'&&<div className="admin-panel"><h2>Importação diária de vendas</h2><p>Envie uma planilha Excel no modelo Diária Yup ou um arquivo CSV. Os dados serão conferidos antes de gravar.</p><label className="upload-zone"><input type="file" accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={e=>e.target.files?.[0]&&parseFile(e.target.files[0])}/><Upload size={26}/><strong>{file?file.name:'Selecionar arquivo Excel ou CSV'}</strong><span>Excel (.xlsx/.xls) ou CSV · Prévia antes da confirmação</span></label><div className="format-hint"><strong>Formatos aceitos:</strong><br/>Excel: aba BASE VENDAS com Data, Vendedora, Faturamento líquido (R$) e Nº de vendas.<br/>CSV: data,vendedora,valor,vendas (e-mail opcional).<br/>Datas aceitas: AAAA-MM-DD ou DD/MM/AAAA. Valores em reais, inclusive negativos para registrar estornos. Estornos não aumentam a quantidade de vendas.</div>{preview.length>0&&<><div className="preview-head"><strong>Prévia de importação</strong><span>{preview.length} registros encontrados</span></div><div className="table-wrap"><table><thead><tr><th>DATA</th><th>VENDEDORA</th><th>FATURAMENTO</th><th>VENDAS</th></tr></thead><tbody>{preview.slice(0,10).map((r,i)=><tr key={i}><td>{r.data}</td><td>{r.vendedora}</td><td>{exactMoney(Number(r.valor))}</td><td>{r.vendas}</td></tr>)}</tbody></table></div><button className="btn primary" disabled={saving} onClick={importCsv}>{saving?'Importando...':'Confirmar importação'}<ChevronRight size={16}/></button></>}</div>}
 {tab==='sellers'&&<><div className="admin-panel"><h2>Cadastrar colaboradora</h2><form className="inline-form" onSubmit={addSeller}><label>Nome completo<input value={sellerName} onChange={e=>setSellerName(e.target.value)} required placeholder="Nome da vendedora"/></label><label>E-mail (opcional)<input type="email" value={sellerEmail} onChange={e=>setSellerEmail(e.target.value)} placeholder="email@loja.com"/></label><label>Setor<select value={sellerSector} onChange={e=>setSellerSector(e.target.value as Sector)}><option value="salao">Salão</option><option value="digital">Digital</option><option value="checkout">Checkout</option></select></label><label className="seller-sales-toggle"><input type="checkbox" checked={sellerCanSell} onChange={e=>setSellerCanSell(e.target.checked)}/> Participa das vendas (pódio e ranking)</label><button className="btn primary"><Plus size={16}/> Cadastrar</button></form></div><div className="admin-panel"><h2>Fotos do ranking</h2><p>Adicione a foto de cada colaboradora para o pódio de destaque.</p><form className="inline-form" onSubmit={uploadPhoto}><label>Colaboradora<select value={photoSeller} onChange={e=>setPhotoSeller(e.target.value)} required><option value="">Selecione</option>{data.sellers.map(s=><option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label><label>Imagem<input id="seller-photo" type="file" accept="image/*" required/></label><button className="btn primary"><ImagePlus size={16}/> Enviar foto</button></form></div><div className="admin-panel"><h2>Equipe cadastrada · {data.sellers.length}</h2><div className="seller-list">{data.sellers.map((s,i)=><div className="seller-list-item" key={s.id}><Avatar seller={s} index={i}/><div><strong>{s.full_name}</strong><small>{s.email||'Sem e-mail cadastrado'}</small><small>{s.can_sell===false?'Somente boas ações':'Participa do ranking de vendas'} · Setor: {s.sector?sectorLabel(s.sector):'Não definido'}</small><select aria-label={'Setor de '+s.full_name} value={s.sector||''} onChange={e=>e.target.value&&updateSellerSector(s,e.target.value as Sector)}><option value="">Definir setor</option><option value="salao">Salão</option><option value="digital">Digital</option><option value="checkout">Checkout</option></select></div><button type="button" className={s.can_sell===false?'sales-link-off':'sales-link-on'} onClick={()=>toggleSellerSales(s)}>{s.can_sell===false?'Incluir nas vendas':'Vendedora'}</button><span className={s.active?'active-status':'inactive-status'}>{s.active?'ATIVA':'INATIVA'}</span></div>)}</div></div></>}
 {tab==='goals'&&<><div className="admin-panel narrow-panel"><h2>Metas semanais por setor</h2><p>Cadastre a meta coletiva de cada setor. Para o filtro mensal, o sistema soma as metas semanais com início dentro do mês selecionado. A data será normalizada para a segunda-feira da semana.</p><form onSubmit={saveSectorGoal} className="stack-form"><label>Setor<select value={sectorGoal.sector} onChange={e=>setSectorGoal({...sectorGoal,sector:e.target.value as Sector})}><option value="salao">Salão · quantidade de vendas</option><option value="digital">Digital · conversões</option><option value="checkout">Checkout · faturamento em reais</option></select></label><label>Data da semana<input type="date" value={sectorGoal.week_start} onChange={e=>setSectorGoal({...sectorGoal,week_start:e.target.value})} required/></label><label>Meta semanal {sectorGoal.sector==='checkout'?'(R$)':'(quantidade)'}<input type="number" min="0" step={sectorGoal.sector==='checkout'?'0.01':'1'} value={sectorGoal.target} onChange={e=>setSectorGoal({...sectorGoal,target:Number(e.target.value)})} required/></label><button className="btn primary">Salvar meta semanal <ChevronRight size={16}/></button></form><div className="seller-list">{data.sectorGoals.slice().sort((a,b)=>b.week_start.localeCompare(a.week_start)).map(g=><div className="seller-list-item" key={g.sector+g.week_start}><div><strong>{sectorLabel(g.sector)} · semana de {new Date(g.week_start+'T12:00:00').toLocaleDateString('pt-BR')}</strong><small>{g.sector==='checkout'?exactMoney(g.target):g.target.toLocaleString('pt-BR')+' '+(g.sector==='salao'?'vendas':'conversões')}</small></div></div>)}</div></div><div className="admin-panel narrow-panel"><h2>Configuração da meta mensal geral</h2><p>Informe o objetivo coletivo para o mês e o valor de referência por dia.</p><form onSubmit={saveGoal} className="stack-form"><label>Mês de referência<input type="month" value={goal.month.slice(0,7)} onChange={e=>{const month=e.target.value+'-01';const existing=data.goals.find(g=>g.month===month);setGoal(existing||{month,monthly_target:defaultGoal.monthly_target,daily_target:defaultGoal.daily_target})}} required/></label><label>Meta mensal (R$)<input type="number" min="0" step="0.01" value={goal.monthly_target} onChange={e=>setGoal({...goal,monthly_target:Number(e.target.value)})} required/></label><label>Meta diária (R$)<input type="number" min="0" step="0.01" value={goal.daily_target} onChange={e=>setGoal({...goal,daily_target:Number(e.target.value)})} required/></label><button className="btn primary">Salvar metas <ChevronRight size={16}/></button></form></div></>}
 {tab==='recognitions'&&<><div className="admin-panel narrow-panel"><h2>Registrar reconhecimento</h2><p>As estrelas reconhecem boas práticas e ideias implementadas. Elas não alteram a classificação de vendas.</p><form className="stack-form" onSubmit={addRecognition}><label>Colaboradora<select required value={recSeller} onChange={e=>setRecSeller(e.target.value)}><option value="">Selecione</option>{data.sellers.map(s=><option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label><label>Categoria<select value={recKind} onChange={e=>setRecKind(e.target.value)}><option value="boas_praticas">Boa prática</option><option value="ideia_implementada">Ideia implementada</option></select></label><label>Título<input value={recTitle} onChange={e=>setRecTitle(e.target.value)} required placeholder="Ex.: Organização do estoque"/></label><label>O que foi feito?<textarea rows={4} value={recDescription} onChange={e=>setRecDescription(e.target.value)} required placeholder="Descreva a contribuição da colaboradora..."/></label><label>Estrelas concedidas<div className="star-picker">{[1,2,3,4,5].map(n=><button type="button" key={n} onClick={()=>setRecStars(n)} className={n<=recStars?'chosen':''}><Star fill={n<=recStars?'currentColor':'none'}/></button>)}</div></label><button className="btn primary">Publicar reconhecimento <Star size={16}/></button></form></div><div className="admin-panel"><h2>Reconhecimentos registrados</h2>{data.recognitions.map(r=><div className="recognition-row" key={r.id}><div><strong>{r.title}</strong><p>{r.description}</p><small>{data.sellers.find(s=>s.id===r.seller_id)?.full_name||'Colaboradora'} · {r.kind==='ideia_implementada'?'Ideia implementada':'Boa prática'}</small></div><span className="stars-cell">{'★'.repeat(r.stars)}</span></div>)}</div></>}
 </main></div>
}
function normalizeDate(value:unknown){if(value instanceof Date&&!Number.isNaN(value.getTime()))return String(value.getFullYear()).padStart(4,'0')+'-'+String(value.getMonth()+1).padStart(2,'0')+'-'+String(value.getDate()).padStart(2,'0');if(typeof value==='number'&&Number.isFinite(value)){const parsed=XLSX.SSF.parse_date_code(value);if(parsed)return String(parsed.y).padStart(4,'0')+'-'+String(parsed.m).padStart(2,'0')+'-'+String(parsed.d).padStart(2,'0')}if(!value)return '';const s=String(value).trim();let y=0,m=0,d=0;if(/^\d{4}-\d{2}-\d{2}$/.test(s)){[y,m,d]=s.split('-').map(Number)}else{const match=s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);if(!match)return '';d=Number(match[1]);m=Number(match[2]);y=Number(match[3])}const date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'):''}
function ViewerGate(){const {user,loading}=useSession();if(!hasSupabase)return <Navigate to="/viewer/login" replace/>;if(loading)return <div className="loading-screen">Verificando acesso...</div>;return user?<Navigate to="/viewer/board" replace/>:<Navigate to="/viewer/login" replace/>}
export default function App(){
 const data=useData()
 return <Routes>
  <Route path="/" element={<ViewerGate/>}/>
  <Route path="/admin/login" element={<Login role="admin"/>}/>
  <Route path="/viewer/login" element={<Login role="viewer"/>}/>
  <Route path="/viewer" element={<ViewerGate/>}/>
  <Route path="/viewer/board" element={<Guard role="viewer"><Dashboard data={data}/></Guard>}/>
   <Route path="/viewer/percentage" element={<Guard role="viewer"><Dashboard data={data} mode="percent"/></Guard>}/>
   <Route path="/admin/percentage" element={<Guard role="admin"><Dashboard data={data} mode="percent" admin/></Guard>}/>
  <Route path="/admin" element={<Guard role="admin"><Admin/></Guard>}/>
  <Route path="*" element={<Navigate to="/" replace/>}/>
 </Routes>
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Navigate, Route, Routes, Link, useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import {
  Trophy, TrendingUp, ShoppingBag, Target, Star,
  Upload, Users, LogOut, LayoutDashboard, Plus, Monitor,
  RefreshCw, ChevronRight, ShieldCheck, AlertCircle, CheckCircle2,
  ArrowUpRight, ImagePlus, X, Plug
} from 'lucide-react'
import { supabase, hasSupabase } from './lib/supabase'
import ErpIntegration from './ErpIntegration'
import logoYupee from './assets/logo-yupee.png'

type Sector = 'salao'|'digital'|'checkout'
type Seller = { id:string; full_name:string; email:string|null; photo_url:string|null; active:boolean; can_sell?:boolean; sector?:Sector|null }
type SectorGoal = { id:string; sector:Sector; week_start:string; target:number }
type Sale = { id:string; seller_id:string; sale_date:string; revenue:number; sales_count:number; gross_revenue?:number; refund_amount?:number }
type Recognition = { id:string; seller_id:string; stars:number; kind:string; title:string; description:string; recognized_at:string }
type Goal = { month:string; monthly_target:number; daily_target:number; bonus_meta?:number; bonus_super?:number; bonus_diamante?:number; growth_salao?:number|null; growth_digital?:number|null; growth_checkout?:number|null }
// Semana do plano de meta comercial (datas próprias, ex.: 01 a 08).
type GoalWeek = { id?:string; month:string; week_number:number; start_date:string; end_date:string; store_target:number; salao_revenue_target:number; digital_revenue_target:number; salao_sales_target:number; digital_conversions_target:number; checkout_ticket_target:number; salao_meta:number; salao_super:number; salao_diamante:number; digital_meta:number; digital_super:number; digital_diamante:number; checkout_meta:number; checkout_super:number; checkout_diamante:number }
type Tier = 'meta'|'super'|'diamante'
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
 const [sellers,setSellers]=useState<Seller[]>(hasSupabase?[]:demoSellers),[sales,setSales]=useState<Sale[]>(hasSupabase?[]:demoSales),[recognitions,setRecognitions]=useState<Recognition[]>(hasSupabase?[]:demoRecognitions),[goals,setGoals]=useState<Goal[]>(hasSupabase?[]:[defaultGoal]),[sectorGoals,setSectorGoals]=useState<SectorGoal[]>([]),[goalWeeks,setGoalWeeks]=useState<GoalWeek[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[updatedAt,setUpdatedAt]=useState<Date|null>(hasSupabase?null:new Date()),[erpSyncedAt,setErpSyncedAt]=useState<Date|null>(null)
 const load=useCallback(async()=>{
  const client=supabase
  if(!client)return
  setBusy(true);setError('')
  try{
   const fetchAll=async(table:'sellers'|'sales_daily'|'recognitions'|'goals'|'sector_goals'|'goal_weeks',column:string,ascending=true)=>{
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
   const [a,b,c,d,e,f]=await Promise.all([
    fetchAll('sellers','full_name'),
    fetchAll('sales_daily','sale_date',false),
    fetchAll('recognitions','recognized_at',false),
    fetchAll('goals','month',false),
    fetchAll('sector_goals','week_start',false).catch(()=>[]),
    // Antes da migração do plano a tabela não existe: as telas usam as metas semanais antigas.
    fetchAll('goal_weeks','start_date').catch(()=>[])
   ])
   // Horário da última sincronização do ERP publicada no ranking (null antes da migração ou com a publicação desligada).
   const erp=await client.rpc('erp_last_sync').then(r=>r.error||!r.data?null:new Date(String(r.data)),()=>null)
   setErpSyncedAt(erp)
   setSellers(a as unknown as Seller[]);setSales(b as unknown as Sale[]);setRecognitions(c as unknown as Recognition[]);setGoals(d as unknown as Goal[]);setSectorGoals(e as unknown as SectorGoal[]);setGoalWeeks((f as unknown as GoalWeek[]).map(w=>normalizeWeek(w)));setUpdatedAt(new Date())
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
 return {sellers,sales,recognitions,goals,sectorGoals,goalWeeks,setSellers,setSales,setRecognitions,setGoals,setSectorGoals,setGoalWeeks,load,busy,error,updatedAt,erpSyncedAt}
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
  return {seller:s,revenue,count,ticket:count?grossRevenue/count:0,sector:s.sector,contribution:0,metricActual:0,quota:0,individual:null as number|null,tier:null as Tier|null}
 }).sort((a,b)=>b.revenue-a.revenue||b.count-a.count||a.seller.full_name.localeCompare(b.seller.full_name,'pt-BR'))
}
const periodTag=(p:Period)=>p==='day'?'Hoje':p==='week'?'Esta semana':p==='range'?'Período selecionado':'Este mês'
const periodTabs:[Period,string][]=[['day','Diário'],['week','Semanal'],['month','Mensal'],['range','Período']]
const sectors:Sector[]=['salao','digital','checkout']
const sectorLabel=(s:Sector)=>s==='salao'?'SALÃO':s==='digital'?'DIGITAL':'CHECKOUT'
const sectorName=(s:Sector)=>s==='salao'?'Salão':s==='digital'?'Digital':'Checkout'
const sectorUnit=(s:Sector)=>s==='salao'?'vendas':s==='digital'?'conversões':'faturamento'
// Dias em comum entre a semana (segunda a domingo) e o período [início, fim]. Cada dia vale 1/7 da meta semanal.
const weekOverlapDays=(weekStartIso:string,[start,end]:[string,string])=>{const day=86400000,ws=new Date(weekStartIso+'T12:00:00').getTime(),from=Math.max(ws,new Date(start+'T12:00:00').getTime()),to=Math.min(ws+6*day,new Date(end+'T12:00:00').getTime());return to<from?0:Math.round((to-from)/day)+1}
const sectorActual=(sector:Sector,sales:Sale[],sellerIds:string[],start:string,end:string)=>sales.filter(x=>sellerIds.includes(x.seller_id)&&x.sale_date>=start&&x.sale_date<=end).reduce((sum,x)=>sum+(sector==='checkout'?Number(x.revenue):Number(x.sales_count)),0)
// ---------- Plano de meta comercial ----------
const DAY_MS=86400000
const dayMs=(iso:string)=>new Date(iso+'T12:00:00').getTime()
const spanDays=(start:string,end:string)=>Math.round((dayMs(end)-dayMs(start))/DAY_MS)+1
const overlapDays=(aStart:string,aEnd:string,bStart:string,bEnd:string)=>{const from=Math.max(dayMs(aStart),dayMs(bStart)),to=Math.min(dayMs(aEnd),dayMs(bEnd));return to<from?0:Math.round((to-from)/DAY_MS)+1}
const weekNumberFields=['store_target','salao_revenue_target','digital_revenue_target','salao_sales_target','digital_conversions_target','checkout_ticket_target','salao_meta','salao_super','salao_diamante','digital_meta','digital_super','digital_diamante','checkout_meta','checkout_super','checkout_diamante'] as const
const normalizeWeek=(w:GoalWeek):GoalWeek=>{const out={...w,week_number:Number(w.week_number)} as GoalWeek;for(const k of weekNumberFields)(out as Record<string,unknown>)[k]=Number(w[k]||0);return out}
const planFieldGroups:[string,[keyof GoalWeek,string][]][]=[
 ['Loja (R$)',[['store_target','Meta da loja'],['salao_revenue_target','Venda salão'],['digital_revenue_target','Venda digital']]],
 ['Metas dos setores',[['salao_sales_target','Salão · qtd. de vendas'],['digital_conversions_target','Digital · conversões'],['checkout_ticket_target','Checkout · ticket médio (R$)']]],
 ['Vendedoras do salão · R$ por pessoa',[['salao_meta','Meta'],['salao_super','Super'],['salao_diamante','Diamante']]],
 ['Vendedoras digital · R$ por pessoa',[['digital_meta','Meta'],['digital_super','Super'],['digital_diamante','Diamante']]],
 ['Checkout · R$ da equipe (soma das vendedoras)',[['checkout_meta','Meta'],['checkout_super','Super'],['checkout_diamante','Diamante']]],
]
const tierLabel=(t:Tier)=>t==='diamante'?'Diamante':t==='super'?'Super':'Meta'
const tierOf=(value:number,t:{meta:number;super:number;diamante:number}):Tier|null=>t.meta<=0?null:value>=t.diamante&&t.diamante>0?'diamante':value>=t.super&&t.super>0?'super':value>=t.meta?'meta':null
// Metas do plano para um período: cada semana entra proporcionalmente aos dias em comum com o período.
// Ticket médio do Checkout não se soma: vira a média das semanas, ponderada pelos dias.
function planForWindow(weeks:GoalWeek[],start:string,end:string){
 const individual:Record<Sector,{meta:number;super:number;diamante:number}>={salao:{meta:0,super:0,diamante:0},digital:{meta:0,super:0,diamante:0},checkout:{meta:0,super:0,diamante:0}}
 let covered=false,salao=0,digital=0,ticketSum=0,ticketDays=0,store=0,salaoRevenue=0,digitalRevenue=0
 for(const w of weeks){
  const days=overlapDays(w.start_date,w.end_date,start,end);if(!days)continue
  covered=true
  const f=days/spanDays(w.start_date,w.end_date)
  store+=w.store_target*f;salao+=w.salao_sales_target*f;digital+=w.digital_conversions_target*f;salaoRevenue+=w.salao_revenue_target*f;digitalRevenue+=w.digital_revenue_target*f
  if(w.checkout_ticket_target>0){ticketSum+=w.checkout_ticket_target*days;ticketDays+=days}
  for(const sec of sectors){individual[sec].meta+=w[`${sec}_meta`]*f;individual[sec].super+=w[`${sec}_super`]*f;individual[sec].diamante+=w[`${sec}_diamante`]*f}
 }
 // Metas de faturamento por setor: Salão e Digital do plano; Checkout é a meta da equipe (nível Meta).
 return {covered,store,individual,sector:{salao,digital,checkout:ticketDays?ticketSum/ticketDays:0} as Record<Sector,number>,revenue:{salao:salaoRevenue,digital:digitalRevenue,checkout:individual.checkout.meta} as Record<Sector,number>}
}
const salesIn=(sales:Sale[],ids:string[],start:string,end:string)=>sales.filter(x=>ids.includes(x.seller_id)&&x.sale_date>=start&&x.sale_date<=end)
const sumRevenue=(rows:Sale[])=>rows.reduce((n,x)=>n+Number(x.revenue),0)
const sumCount=(rows:Sale[])=>rows.reduce((n,x)=>n+Number(x.sales_count),0)
const ticketOf=(rows:Sale[])=>{const c=sumCount(rows);return c?rows.reduce((n,x)=>n+Number(x.gross_revenue??Math.max(Number(x.revenue),0)),0)/c:0}
// Nome para a TV: só iniciais maiúsculas e sem espaços repetidos ("EDILAINE  CARDOSO" → "Edilaine Cardoso"). O cadastro não muda.
const lowerWords=new Set(['da','das','de','do','dos','e'])
const displayName=(name:string)=>name.trim().split(/\s+/).map((w,i)=>{const l=w.toLocaleLowerCase('pt-BR');return i>0&&lowerWords.has(l)?l:l.charAt(0).toLocaleUpperCase('pt-BR')+l.slice(1)}).join(' ')
const sellerColor=(id:string)=>{let h=0;for(const ch of id)h=(h*31+ch.charCodeAt(0))>>>0;return ['#B07A5A','#6E8CA6','#7E9A86','#8A7FB0','#5E8F9E','#A0708A','#7A8F5E','#9A7A50'][h%8]}
const clock=(d:Date)=>d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
const longDate=(iso:string)=>new Date(iso+'T12:00:00').toLocaleDateString('pt-BR',{day:'numeric',month:'short'}).replace('.','')
const prefersReducedMotion=()=>typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
function TvAvatar({seller,className}:{seller:Seller;className:string}){
 return <span className={'tv-avatar '+className} style={{background:sellerColor(seller.id)}}>{seller.photo_url?<img src={seller.photo_url} alt=""/>:initial(seller.full_name)}</span>
}
function TvStar(){return <svg className="tv-star" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>}
// Janela circular: percorre até o fim e reinicia no primeiro grupo.
// Rolagem infinita vertical: o card do centro fica em destaque; subindo, os cards diminuem e somem num degradê.
function RecognitionReel({items,render}:{items:Recognition[];render:(r:Recognition)=>ReactNode}){
 const box=useRef<HTMLDivElement>(null),track=useRef<HTMLDivElement>(null)
 const moving=items.length>1
 useEffect(()=>{
  const el=box.current,tr=track.current
  if(!el||!tr)return
  const reduced=prefersReducedMotion()
  let offset=0,last=performance.now(),raf=0
  const paint=()=>{
   const h=el.clientHeight,mid=h/2
   const cards=[...tr.children] as HTMLElement[]
   const setH=moving?(cards[items.length]?.offsetTop??0)-(cards[0]?.offsetTop??0):0
   if(setH>0)offset%=setH
   tr.style.transform=`translate3d(0,${-offset}px,0)`
   for(const c of cards){
    const center=c.offsetTop-offset+c.offsetHeight/2
    const d=Math.max(-1.2,Math.min(1.2,(center-mid)/mid))
    // acima do centro diminui mais; abaixo, cresce suavemente até o destaque
    const scale=d<0?1+0.22*d:1-0.08*d
    const fade=Math.max(0,Math.min(1,1.25-Math.abs(d)*(d<0?1.15:0.9)))
    c.style.transform=`scale(${Math.max(0.7,scale).toFixed(3)})`
    c.style.opacity=fade.toFixed(3)
   }
  }
  const tick=(now:number)=>{
   const dt=Math.min(0.1,(now-last)/1000);last=now
   offset+=el.clientHeight/16*dt // atravessa a área em ~16 s
   paint();raf=requestAnimationFrame(tick)
  }
  paint()
  if(moving&&!reduced)raf=requestAnimationFrame(t=>{last=t;tick(t)})
  const onResize=()=>paint()
  window.addEventListener('resize',onResize)
  return()=>{cancelAnimationFrame(raf);window.removeEventListener('resize',onResize)}
 },[items,moving])
 // Três cópias garantem que a área fique sempre cheia enquanto a lista volta ao início.
 const list=moving?[...items,...items,...items]:items
 return <div className={'tv-reel'+(moving?' is-moving':'')} ref={box}><div className="tv-reel-track" ref={track}>{list.map((r,i)=><article key={r.id+'-'+i} aria-hidden={i>=items.length?true:undefined}>{render(r)}</article>)}</div></div>
}
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
// mode 'sectors': mesma base da tela de %, com um ranking para cada setor (Salão, Digital e Checkout).
function Dashboard({data,mode='values',admin=false}:{data:ReturnType<typeof useData>;mode?:'values'|'percent'|'sectors';admin?:boolean}){
 const percent=mode!=='values',sectorsView=mode==='sectors'
 const views:[string,string,string][]=admin?[['admin','Admin','/admin'],['percent','%','/admin/percentage'],['sectors','Setores','/admin/sectors']]:[['values','R$','/viewer/board'],['percent','%','/viewer/percentage'],['sectors','Setores','/viewer/sectors']]
 const [period,setPeriod]=useState<Period>('month'),[date,setDate]=useState(today()),[endDate,setEndDate]=useState(today()),[now,setNow]=useState(new Date())
 useEffect(()=>{const t=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(t)},[])
 const rangeEnd=endDate>=date?endDate:date
 // Semanas seguem o plano de metas (ex.: 01 a 08, 09 a 15); sem plano para a data, vale segunda a domingo.
 const planWeek=data.goalWeeks.find(w=>date>=w.start_date&&date<=w.end_date)
 const monthPlanWeeks=data.goalWeeks.filter(w=>w.month===monthKey(date)).sort((a,b)=>a.week_number-b.week_number)
 const sectorWindow:[string,string]=period==='range'?[date,rangeEnd]:period==='week'&&planWeek?[planWeek.start_date,planWeek.end_date]:dateRange(period,date)
 const rows=useMemo(()=>rankRows(data.sellers,data.sales,'range',sectorWindow[0],sectorWindow[1]),[data.sellers,data.sales,sectorWindow[0],sectorWindow[1]])
 const shortDay=(iso:string)=>new Date(iso+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})
 const weekName=(w:GoalWeek)=>w.week_number+'ª semana'
 const windowTag=period==='week'&&planWeek?weekName(planWeek)+' · '+shortDay(planWeek.start_date)+' a '+shortDay(planWeek.end_date):period==='day'?(date===today()?'Hoje':shortDay(date)):period==='month'?(monthKey(date)===monthKey(today())?'Este mês':monthLabel(date)):periodTag(period)
 // Plano de meta comercial do período (semanas com datas próprias). Sem plano cadastrado, vale a meta semanal antiga por setor.
 const plan=useMemo(()=>planForWindow(data.goalWeeks,sectorWindow[0],sectorWindow[1]),[data.goalWeeks,sectorWindow[0],sectorWindow[1]])
 const sectorStats=useMemo(()=>sectors.map(sector=>{
  const members=data.sellers.filter(s=>s.active&&s.can_sell!==false&&s.sector===sector)
  const ids=members.map(s=>s.id),inWindow=salesIn(data.sales,ids,sectorWindow[0],sectorWindow[1])
  const target=plan.covered?plan.sector[sector]:data.sectorGoals.filter(g=>g.sector===sector).reduce((sum,g)=>sum+Number(g.target)*weekOverlapDays(g.week_start,sectorWindow)/7,0)
  // Checkout trabalha como equipe: o resultado é a soma das vendedoras contra Meta, Super e Diamante da equipe.
  // Cada uma tem como parte a meta da equipe ÷ número de vendedoras. O ticket médio segue como indicador.
  const teamMode=plan.covered&&sector==='checkout'
  if(teamMode){
   const tiers=plan.individual.checkout,teamTarget=tiers.meta,teamRevenue=sumRevenue(inWindow),ticketTarget=target,ticket=ticketOf(inWindow)
   return {sector,members,target:teamTarget,actual:teamRevenue,teamMode,teamTier:tierOf(teamRevenue,tiers),ticketPercent:ticketTarget>0?ticket/ticketTarget*100:null,percent:teamTarget>0?teamRevenue/teamTarget*100:0,quotaTarget:members.length?teamTarget/members.length:0}
  }
  const actual=plan.covered?sumCount(inWindow):sectorActual(sector,data.sales,ids,sectorWindow[0],sectorWindow[1])
  return {sector,members,target,actual,teamMode,teamTier:null as Tier|null,ticketPercent:null as number|null,percent:target>0?actual/target*100:0,quotaTarget:members.length?target/members.length:0}
 }),[data.sellers,data.sales,data.sectorGoals,plan,sectorWindow[0],sectorWindow[1]])
 const percentRows=useMemo(()=>{
  const bySector=new Map<string,typeof sectorStats[number]>()
  for(const st of sectorStats)for(const seller of st.members)bySector.set(seller.id,st)
  return rows.filter(r=>bySector.has(r.seller.id)).map(r=>{
   const st=bySector.get(r.seller.id)!,own=salesIn(data.sales,[r.seller.id],sectorWindow[0],sectorWindow[1])
   const metricActual=st.teamMode?sumRevenue(own):plan.covered?sumCount(own):sectorActual(st.sector,data.sales,[r.seller.id],sectorWindow[0],sectorWindow[1])
   const quota=st.quotaTarget>0?metricActual/st.quotaTarget*100:0
   const goal=plan.covered&&!st.teamMode?plan.individual[st.sector]:null
   // No Checkout, o % individual é a parte da pessoa na meta da equipe e o nível é o da equipe.
   const individual=st.teamMode?quota:goal&&goal.meta>0?sumRevenue(own)/goal.meta*100:null
   const tier=st.teamMode?st.teamTier:goal?tierOf(sumRevenue(own),goal):null
   return {...r,sector:st.sector,metricActual,quota,individual,tier,contribution:individual??quota}
  }).sort((a,b)=>b.contribution-a.contribution||b.count-a.count||a.seller.full_name.localeCompare(b.seller.full_name,'pt-BR'))
 },[rows,sectorStats,plan,data.sales,sectorWindow[0],sectorWindow[1]])
 const hasIndividual=percent&&percentRows.some(r=>r.individual!==null)
 const periodEnded=sectorWindow[1]<today()
 const goalState=(value:number,target:number):'none'|'done'|'missed'|'open'=>target<=0?'none':value>=target?'done':periodEnded?'missed':'open'
 const flag=(state:string,tier?:Tier|null,short=false)=>state==='done'?<em className="tv-flag done" title="Meta batida">{short&&tier&&tier!=='meta'?tierLabel(tier):'Meta batida'}{!short&&tier&&tier!=='meta'?' · '+tierLabel(tier):''}</em>:state==='missed'?<em className="tv-flag missed">Não bateu</em>:null
 const displayRows=percent?percentRows:rows
 const withoutSector=rows.length-percentRows.length
 const monthRevenue=useMemo(()=>rankRows(data.sellers,data.sales,'month',date).reduce((n,r)=>n+r.revenue,0),[data.sellers,data.sales,date])
 const periodRevenue=rows.reduce((n,r)=>n+r.revenue,0),periodCount=rows.reduce((n,r)=>n+r.count,0)
 // Faturamento por setor (mesmas colaboradoras do ranking), para conferir com a planilha.
 const revenueBySector=[...sectors.map(sec=>({key:sec as string,label:sectorName(sec),revenue:rows.filter(r=>r.seller.sector===sec).reduce((n,r)=>n+r.revenue,0)})),{key:'none',label:'Sem setor',revenue:rows.filter(r=>!r.seller.sector).reduce((n,r)=>n+r.revenue,0)}].filter(x=>x.key!=='none'||x.revenue!==0)
 const periodTicket=periodCount?rows.reduce((n,r)=>n+r.ticket*r.count,0)/periodCount:0
 const periodLabel=period==='day'?'no dia':period==='week'?'na semana':period==='range'?'no período':'no mês'
 const savedGoal=data.goals.find(g=>g.month===monthKey(date))
 // Na tela de %, sem meta cadastrada vale a referência padrão definida para essa tela.
 const target=Number(savedGoal?.monthly_target??(percent?500000:defaultGoal.monthly_target))
 const pct=(n:number,digits=2)=>n.toLocaleString('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits})+'%'
 const bar=(n:number)=>Math.min(100,Math.max(0,n))+'%'
 const planGoal=period!=='month'&&plan.covered&&plan.store>0
 const goalTarget=planGoal?plan.store:target
 const goalActual=planGoal?periodRevenue:monthRevenue
 const goalTitle=!planGoal?(percent?'Meta geral de ':'Meta de ')+monthLabel(date):period==='day'?'Meta do dia '+shortDay(date):period==='week'&&planWeek?'Meta da '+weekName(planWeek):'Meta do período'
 const progress=goalTarget?Math.max(0,Math.min(100,goalActual/goalTarget*100)):0
 // O ranking de boas ações é histórico e independente dos filtros de vendas.
 const actionRanking=useMemo(()=>data.sellers.filter(s=>s.active).map(s=>{
  const entries=data.recognitions.filter(r=>r.seller_id===s.id&&r.stars>0)
  return {seller:s,stars:entries.reduce((n,r)=>n+Number(r.stars||0),0),actions:entries.length}
 }).filter(r=>r.actions>0).sort((a,b)=>b.stars-a.stars||b.actions-a.actions||a.seller.full_name.localeCompare(b.seller.full_name,'pt-BR')),[data.sellers,data.recognitions])
 const recentRecognitions=useMemo(()=>[...data.recognitions].filter(r=>r.stars>0).sort((a,b)=>b.recognized_at.localeCompare(a.recognized_at)).slice(0,12),[data.recognitions])
 const sellerById=useMemo(()=>new Map(data.sellers.map(s=>[s.id,s])),[data.sellers])
 const ranking=useSlidingWindow(displayRows.length,8,4000,period+date+endDate)
 const actions=useSlidingWindow(actionRanking.length,4,4000,'actions')
 const visibleRows=displayRows.slice(ranking.start,ranking.start+8)
 const visibleActions=actionRanking.slice(actions.start,actions.start+4)
 // Pódio: quem mais faturou no filtro (dia, semana, mês ou período). Na tela de %, mostra a participação no faturamento da loja.
 const podiumRows=useMemo(()=>percent?[...percentRows].filter(r=>r.revenue>0).sort((a,b)=>b.revenue-a.revenue||b.count-a.count||a.seller.full_name.localeCompare(b.seller.full_name,'pt-BR')):displayRows,[percent,percentRows,displayRows])
 const share=(r:{revenue:number})=>periodRevenue>0?r.revenue/periodRevenue*100:0
 const [first,second,third]=podiumRows
 const loading=data.busy&&!data.updatedAt
 const emptySales=data.error&&!data.updatedAt?'Não foi possível carregar os dados. Nova tentativa em 1 minuto.':loading?'Carregando dados…':'Nenhuma venda registrada neste período.'
 // Ranking de um setor: % da meta individual (ou da cota, sem plano), nível e vendas; no Checkout, também o ticket médio.
 const sectorRank=(sec:Sector)=>{
  const st=sectorStats.find(x=>x.sector===sec)!,list=percentRows.filter(r=>r.sector===sec),showTicket=sec==='checkout'
  return <>
   <div className="tv-panel-head"><h2>{sectorName(sec)}{flag(goalState(st.actual,st.target))}</h2><span>{pct(st.percent,1)} da meta{st.teamMode?' da equipe':''} · {list.length} {list.length===1?'pessoa':'pessoas'}</span></div>
   {list.length?<table className={showTicket?'has-ticket':undefined}>
    <thead><tr><th scope="col">Pos.</th><th scope="col">Vendedora</th>{showTicket&&<th scope="col">Ticket</th>}<th scope="col">{hasIndividual?'% meta':'% cota'}</th><th scope="col">Vendas</th></tr></thead>
    <tbody>{list.map((r,i)=><tr key={r.seller.id} className={i===0&&r.contribution>0?'is-leader':undefined}>
     <td><span className={i===0?'tv-pos is-top':'tv-pos'}>{String(i+1).padStart(2,'0')}</span></td>
     <td><span className="tv-seller"><span className="tv-seller-text"><span className="tv-seller-name">{displayName(r.seller.full_name)}</span>{r.tier&&<small><span className={'tv-tier '+r.tier}>{tierLabel(r.tier)}</span></small>}</span></span></td>
     {showTicket&&<td className="tv-num tv-muted">{exactMoney(r.ticket)}</td>}
     <td className="tv-num tv-strong">{pct(r.contribution,1)}</td>
     <td className="tv-num tv-muted">{r.count}</td>
    </tr>)}</tbody>
   </table>:<p className="tv-empty">Nenhuma colaboradora neste setor.</p>}
  </>
 }
 return <div className="tv">
  <header className="tv-header">
   <div className="tv-brand"><img className="tv-brand-logo" src={logoYupee} alt="Yupee Petstore"/><h1>{sectorsView?'Ranking por setor':percent?'Contribuição para a meta':'O resultado é de todos nós.'}</h1></div>
   <div className="tv-header-tools">
    <div className="tv-periods" role="group" aria-label="Período">{periodTabs.map(([p,label])=><button type="button" key={p} aria-pressed={period===p} onClick={()=>setPeriod(p)}>{label}</button>)}</div><nav className="tv-views" aria-label="Telas do painel">{views.map(([m,label,to])=><Link key={m} to={to} aria-current={mode===m?'page':undefined}>{label}</Link>)}</nav>
    {period==='range'
     ?<div className="tv-dates"><label><span className="tv-visually-hidden">Data inicial</span><input type="date" value={date} max={endDate} onChange={e=>{if(e.target.value){setDate(e.target.value);if(e.target.value>endDate)setEndDate(e.target.value)}}}/></label><span aria-hidden="true">a</span><label><span className="tv-visually-hidden">Data final</span><input type="date" value={endDate} min={date} onChange={e=>{if(e.target.value)setEndDate(e.target.value)}}/></label></div>
     :period==='week'&&monthPlanWeeks.length>0&&planWeek
      ?<label className="tv-dates"><span className="tv-visually-hidden">Semana do plano</span><select value={planWeek.week_number} onChange={e=>{const w=monthPlanWeeks.find(x=>x.week_number===Number(e.target.value));if(w){setDate(w.start_date);setEndDate(w.start_date)}}}>{monthPlanWeeks.map(w=><option key={w.week_number} value={w.week_number}>{weekName(w)} ({shortDay(w.start_date).slice(0,2)} a {shortDay(w.end_date)})</option>)}</select></label>
           :<label className="tv-dates"><span className="tv-visually-hidden">Data de referência</span><input type="date" value={date} onChange={e=>{if(e.target.value){setDate(e.target.value);setEndDate(e.target.value)}}}/></label>}
    {period!=='range'&&<span className="tv-clock">{period==='week'&&planWeek?'':longDate(date)+', '}<strong>{clock(now)}</strong></span>}
    {data.error
     ?<span className="tv-status is-offline" role="status">{data.updatedAt?'Sem atualização desde '+clock(data.updatedAt):'Dados não carregados'}</span>
     :<span className="tv-status" role="status" title={data.updatedAt?(data.erpSyncedAt?'Vendas do ERP sincronizadas às '+clock(data.erpSyncedAt)+' · ':'')+'Painel atualizado às '+clock(data.updatedAt):undefined}>{data.updatedAt?(period==='range'?'':'Atualizado às ')+clock(data.erpSyncedAt??data.updatedAt):'Carregando dados'}</span>}
   </div>
  </header>

  <section className={percent?'tv-kpis':'tv-kpis has-split'} aria-label={percent?'Meta mensal e metas dos setores':'Meta mensal e indicadores do período'}>
   <div className="tv-goal">
    <div className="tv-goal-row"><span className="tv-goal-title">{goalTitle}</span>{percent?<span>{planGoal||savedGoal?'':'Meta padrão'}</span>:<span><strong>{money(goalActual)}</strong> de <strong>{money(goalTarget)}</strong></span>}</div>
    <div className="tv-goal-row"><span className="tv-goal-value">{progress.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})}% <small>alcançados</small></span><span>Faltam <strong>{percent?pct(Math.max(0,100-progress),1):money(Math.max(0,goalTarget-goalActual))}</strong></span></div>
    <div className="tv-goal-track" role="progressbar" aria-label={goalTitle} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><div style={{width:progress+'%'}}/></div>
   </div>
   {percent?<div className="tv-metrics">{sectorStats.map(st=>{const state=goalState(st.actual,st.target);return <div className={'tv-metric tv-sector is-'+state} key={st.sector}>
    <span><b>{sectorName(st.sector)}</b> · {st.teamMode?'equipe':sectorUnit(st.sector)}</span>
    <div className="tv-sector-value"><strong>{pct(st.percent,1)}</strong>{flag(state,st.teamTier,true)}</div>
    <div className="tv-sector-track" role="progressbar" aria-label={'Meta do setor '+sectorName(st.sector)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100,st.percent))}><i style={{width:bar(st.percent)}}/></div>
    <small>{state==='none'?'Meta não cadastrada':state==='done'?'Superada em '+pct(st.percent-100,1):state==='missed'?'Fechou em '+pct(st.percent,1):'Faltam '+pct(100-st.percent,1)} · {st.teamMode&&st.ticketPercent!==null?'ticket '+pct(st.ticketPercent,0)+' da meta':st.members.length+(st.members.length===1?' pessoa':' pessoas')}</small>
   </div>})}</div>:<div className="tv-metrics tv-metrics-split"><div className="tv-metrics-row">
    <div className="tv-metric"><span>Faturamento do período</span><strong>{money(periodRevenue)}</strong><small>Loja inteira {periodLabel}</small></div>
    <div className="tv-metric"><span>Ticket médio do período</span><strong>{exactMoney(periodTicket)}</strong><small>{periodCount} {periodCount===1?'venda':'vendas'} {periodLabel}</small></div>
    <div className="tv-metric"><span>Quantidade de vendas</span><strong>{periodCount}</strong><small>Vendas registradas {periodLabel}</small></div>
   </div>
   <div className="tv-sector-split" aria-label="Faturamento por setor">{revenueBySector.map(x=>{const target=plan.covered&&x.key!=='none'?plan.revenue[x.key as Sector]:0,state=goalState(x.revenue,target);return <span key={x.key}><b>{x.label}</b><strong>{exactMoney(x.revenue)}</strong>{state==='done'||state==='missed'?flag(state):<small>{target>0?pct(x.revenue/target*100,1)+' da meta':periodRevenue>0?pct(x.revenue/periodRevenue*100,1):'0,0%'}</small>}</span>})}</div>
   </div>}
  </section>

  <section className={sectorsView?'tv-body tv-body-sectors':'tv-body'}>
   {sectorsView?<>
   <div className="tv-panel tv-ranking tv-sector-rank">{sectorRank('salao')}</div>
   <div className="tv-sector-stack">{(['digital','checkout'] as Sector[]).map(sec=><div className="tv-panel tv-ranking tv-sector-rank" key={sec} style={{flex:(percentRows.filter(r=>r.sector===sec).length||1)+2.2+' 1 0'}}>{sectorRank(sec)}</div>)}</div>
   </>:<>
   <div className="tv-panel tv-podium">
    <div className="tv-panel-head"><h2>Pódio</h2><span>{percent?'Faturamento · ':''}{windowTag}</span></div>
    {first?<div className="tv-podium-body">
     <div className="tv-podium-first">
      <span className="tv-podium-avatar"><TvAvatar seller={first.seller} className="xl"/><b>1º</b></span>
      <strong>{displayName(first.seller.full_name)}</strong><span className="tv-podium-value">{percent?pct(share(first),1):money(first.revenue)}</span>{percent&&first.tier&&<span className={'tv-tier '+first.tier}>{tierLabel(first.tier)}</span>}<small>{first.count} {first.count===1?'venda':'vendas'}</small>
     </div>
     <div className="tv-podium-rest">
      {[second,third].map((r,i)=>r?<div className={'tv-podium-place place-'+(i+2)} key={r.seller.id}>
       <span className="tv-podium-avatar"><TvAvatar seller={r.seller} className="lg"/><b>{i+2}º</b></span>
       <div className={percent?'is-stacked':undefined}><strong>{displayName(r.seller.full_name)}</strong><span className="tv-podium-value">{percent?pct(share(r),1):money(r.revenue)}{percent&&r.tier&&<span className={'tv-tier '+r.tier}>{tierLabel(r.tier)}</span>}</span><small>{r.count} {r.count===1?'venda':'vendas'}</small></div>
      </div>:null)}
     </div>
    </div>:<p className="tv-empty">{emptySales}</p>}
   </div>

   <div className={percent?'tv-panel tv-ranking tv-percent-ranking':'tv-panel tv-ranking'}>
    <div className="tv-panel-head"><h2>Ranking de vendas</h2><span>{percent?<>{periodCount} {periodCount===1?'venda':'vendas'} · {displayRows.filter(r=>r.count>0).length} de {displayRows.length} contribuindo{withoutSector>0&&<> · {withoutSector} sem setor</>}</>:<>{displayRows.length} {displayRows.length===1?'colaboradora':'colaboradoras'}</>}</span></div>
    <table>
     <thead>{percent
      ?(hasIndividual
       ?<tr><th scope="col">Pos.</th><th scope="col">Vendedora</th><th scope="col">% meta individual</th><th scope="col">% cota setor</th><th scope="col">Vendas</th></tr>
       :<tr><th scope="col">Pos.</th><th scope="col">Vendedora</th><th scope="col">% da cota do setor</th><th scope="col">Vendas</th></tr>)
      :<tr><th scope="col">Pos.</th><th scope="col">Vendedora</th><th scope="col">Valor vendido</th><th scope="col">Vendas</th><th scope="col">Ticket médio</th></tr>}</thead>
     <tbody key={ranking.key} className="tv-ranking-body">{visibleRows.map((r,v)=>{const i=ranking.start+v;return <tr key={r.seller.id}>
      <td><span className={i<3?'tv-pos is-top':'tv-pos'}>{String(i+1).padStart(2,'0')}</span></td>
      <td>{percent
       ?<span className="tv-seller"><TvAvatar seller={r.seller} className="sm"/><span className="tv-seller-text"><span className="tv-seller-name">{displayName(r.seller.full_name)}</span>{r.sector&&<small>{sectorName(r.sector)}{r.tier&&<span className={'tv-tier '+r.tier}>{tierLabel(r.tier)}</span>}</small>}</span></span>
       :<span className="tv-seller"><TvAvatar seller={r.seller} className="sm"/><span className="tv-seller-name">{displayName(r.seller.full_name)}</span></span>}</td>
      {percent
       ?<><td><span className="tv-percent-cell"><span className="tv-percent-bar" aria-hidden="true"><i style={{width:bar(r.contribution)}}/></span><strong>{pct(r.contribution,1)}</strong></span></td>{hasIndividual&&<td className="tv-num tv-muted">{pct(r.quota,1)}</td>}<td className="tv-num tv-muted">{r.count}</td></>
       :<><td className="tv-num tv-strong">{exactMoney(r.revenue)}</td><td className="tv-num tv-muted">{r.count}</td><td className="tv-num tv-muted">{exactMoney(r.ticket)}</td></>}
     </tr>})}</tbody>
    </table>
    {displayRows.length===0&&<p className="tv-empty">{percent?'Defina o setor das colaboradoras e cadastre o plano de metas no admin.':emptySales}</p>}
   </div>

   </>}
   <div className="tv-panel tv-culture">
    <div>
     <div className="tv-panel-head"><h2>Ranking de boas ações</h2><span>Desde o início</span></div>
     <ol className="tv-actions" key={actions.key}>{visibleActions.map((r,v)=>{const pos=actions.start+v;return <li key={r.seller.id}>
      <span className="tv-actions-pos">{String(pos+1).padStart(2,'0')}</span><span className="tv-actions-name">{displayName(r.seller.full_name)}</span>
      <span className="tv-muted">{r.actions} {r.actions===1?'ação':'ações'}</span>
      <span className="tv-stars" aria-label={r.stars+(r.stars===1?' estrela':' estrelas')}><TvStar/>{r.stars}</span>
     </li>})}</ol>
     {actionRanking.length===0&&<p className="tv-empty tv-empty-card">Ainda não há boas ações reconhecidas.</p>}
    </div>
    <div className="tv-recents">
     <h2>Reconhecimentos recentes</h2>
     {recentRecognitions.length>0&&<RecognitionReel items={recentRecognitions} render={rec=><>
      <div className="tv-recent-head"><strong>{displayName(sellerById.get(rec.seller_id)?.full_name||'Colaboradora')}</strong><span className="tv-recent-title">{rec.title}</span><span className="tv-stars" aria-label={rec.stars+(rec.stars===1?' estrela':' estrelas')}><TvStar/>{rec.stars}</span></div>
      <p>{rec.description}</p>
     </>}/>}
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
 const [goal,setGoal]=useState(defaultGoal)
 const [recSeller,setRecSeller]=useState(''),[recTitle,setRecTitle]=useState(''),[recDescription,setRecDescription]=useState(''),[recStars,setRecStars]=useState(1),[recKind,setRecKind]=useState('boas_praticas')
 const [photoSeller,setPhotoSeller]=useState('')
 useEffect(()=>{const existing=data.goals.find(g=>g.month===goal.month);if(existing)setGoal(existing)},[data.goals,goal.month])
 const [planWeeks,setPlanWeeks]=useState<GoalWeek[]>([]),[planSaving,setPlanSaving]=useState(false)
 useEffect(()=>{setPlanWeeks(data.goalWeeks.filter(w=>w.month===goal.month).sort((a,b)=>a.week_number-b.week_number))},[data.goalWeeks,goal.month])
 const monthWeeks=useMemo(()=>data.goalWeeks.filter(w=>w.month===goal.month).sort((a,b)=>a.week_number-b.week_number),[data.goalWeeks,goal.month])
 // Bonificação por semana: nível alcançado pelo faturamento da pessoa nas datas da semana do plano.
 const bonusRows=useMemo(()=>{
  const value=(t:Tier)=>Number(t==='diamante'?goal.bonus_diamante??250:t==='super'?goal.bonus_super??140:goal.bonus_meta??70)
  const team=data.sellers.filter(s=>s.active&&s.can_sell!==false&&s.sector==='checkout').map(s=>s.id)
  return data.sellers.filter(s=>s.active&&s.can_sell!==false&&s.sector).map(s=>{
   const sec=s.sector as Sector,isTeam=sec==='checkout'
   // Checkout: nível pela soma da equipe; o valor do bônus é dividido entre as vendedoras do Checkout.
   const weeks=monthWeeks.map(w=>{const revenue=sumRevenue(salesIn(data.sales,isTeam?team:[s.id],w.start_date,w.end_date));const tier=tierOf(revenue,{meta:w[`${sec}_meta`],super:w[`${sec}_super`],diamante:w[`${sec}_diamante`]});return {open:w.end_date>=today(),future:w.start_date>today(),revenue,tier,bonus:tier?value(tier)/(isTeam?Math.max(team.length,1):1):0}})
   return {seller:s,sector:sec,weeks,total:weeks.reduce((n,w)=>n+(w.open?0:w.bonus),0)}
  }).sort((a,b)=>b.total-a.total||a.seller.full_name.localeCompare(b.seller.full_name,'pt-BR'))
 },[data.sellers,data.sales,monthWeeks,goal.bonus_meta,goal.bonus_super,goal.bonus_diamante])
 function newPlanWeek(list:GoalWeek[]):GoalWeek{
  const monthEnd=dateRange('month',goal.month)[1],prev=list[list.length-1]
  const start=prev?toISODate(new Date(dayMs(prev.end_date)+DAY_MS)):goal.month
  const end=toISODate(new Date(dayMs(start)+6*DAY_MS))
  const week={month:goal.month,week_number:list.length+1,start_date:start,end_date:start<=monthEnd&&end>monthEnd?monthEnd:end} as GoalWeek
  for(const k of weekNumberFields)(week as Record<string,unknown>)[k]=prev?prev[k]:0
  return week
 }
 const setWeekField=(i:number,field:keyof GoalWeek,value:string)=>setPlanWeeks(list=>list.map((w,j)=>j===i?{...w,[field]:field==='start_date'||field==='end_date'?value:Number(value)}:w))
 async function savePlan(){
  if(!supabase)return
  const weeks=planWeeks.map((w,i)=>({...w,week_number:i+1,month:goal.month}))
  for(const [i,w] of weeks.entries()){
   if(!w.start_date||!w.end_date||w.end_date<w.start_date){setParseError('Semana '+(i+1)+': a data final precisa ser igual ou posterior à inicial.');return}
   if(i>0&&w.start_date<=weeks[i-1].end_date){setParseError('Semana '+(i+1)+': começa antes do fim da semana '+i+'. As semanas não podem se sobrepor.');return}
  }
  setPlanSaving(true);setParseError('');setMessage('')
  try{
   // Regrava o plano do mês inteiro: apaga as semanas do mês e insere a versão editada.
   const {error:delError}=await supabase.from('goal_weeks').delete().eq('month',goal.month)
   if(delError)throw delError
   if(weeks.length){const {error}=await supabase.from('goal_weeks').insert(weeks.map(({id:_id,...w})=>w));if(error)throw error}
   setMessage('Plano de metas de '+monthLabel(goal.month)+' salvo com '+weeks.length+(weeks.length===1?' semana.':' semanas.'))
   await data.load()
  }catch(e){setParseError((e instanceof Error?e.message:'Falha ao salvar o plano.')+' Se a tabela goal_weeks não existir, execute a migração supabase/migrations/20261112020000_goal_plan.sql.')}
  finally{setPlanSaving(false)}
 }
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
 async function saveGoal(e:FormEvent){e.preventDefault();if(!supabase)return
  const base={month:goal.month,monthly_target:goal.monthly_target,daily_target:goal.daily_target}
  const full={...base,bonus_meta:goal.bonus_meta??70,bonus_super:goal.bonus_super??140,bonus_diamante:goal.bonus_diamante??250,growth_salao:goal.growth_salao??null,growth_digital:goal.growth_digital??null,growth_checkout:goal.growth_checkout??null}
  let {error}=await supabase.from('goals').upsert(full,{onConflict:'month'})
  if(error&&/bonus_|growth_/.test(error.message)){({error}=await supabase.from('goals').upsert(base,{onConflict:'month'}));if(!error){setMessage('Meta mensal salva. Para gravar bonificações e aumento por setor, execute a migração 20261112020000_goal_plan.sql.');await data.load();return}}
  if(error)setParseError(error.message);else setMessage('Meta mensal salva.')
  await data.load()}
 async function addRecognition(e:FormEvent){e.preventDefault();if(!supabase)return;const {error}=await supabase.from('recognitions').insert({seller_id:recSeller,stars:recStars,kind:recKind,title:recTitle,description:recDescription,recognized_at:today()});setMessage(error?.message||'Reconhecimento publicado no painel.');if(!error){setRecTitle('');setRecDescription('');setRecStars(1);await data.load()}}
 async function uploadPhoto(e:FormEvent){e.preventDefault();const el=document.getElementById('seller-photo') as HTMLInputElement;const f=el.files?.[0];if(!f||!supabase||!photoSeller)return;const path=photoSeller+'/'+Date.now()+'-'+f.name.replace(/[^a-zA-Z0-9.-]/g,'_');const {error}=await supabase.storage.from('seller-photos').upload(path,f,{upsert:true});if(error){setMessage(error.message);return}const {data:pub}=supabase.storage.from('seller-photos').getPublicUrl(path);const {error:e2}=await supabase.from('sellers').update({photo_url:pub.publicUrl}).eq('id',photoSeller);setMessage(e2?.message||'Foto atualizada.');await data.load()}
 return <div className="admin-shell"><aside className="admin-sidebar"><Brand/><div className="sidebar-label">GESTÃO COMERCIAL</div><nav>{[['overview','Visão geral',LayoutDashboard],['import','Importar vendas',Upload],['sellers','Colaboradoras',Users],['goals','Metas',Target],['recognitions','Reconhecimentos',Star],['integrations','Integrações',Plug]] .map(([id,label,Icon])=><button key={String(id)} className={tab===id?'selected':''} onClick={()=>setTab(String(id))}>{<Icon size={18}/>} {String(label)}<ChevronRight size={14}/></button>)}</nav><div className="sidebar-bottom"><button onClick={()=>nav('/')}><Monitor size={17}/> Abrir painel TV</button><button onClick={()=>nav('/admin/percentage')}><TrendingUp size={17}/> Tela de porcentagens</button><button onClick={()=>nav('/admin/sectors')}><Users size={17}/> Ranking por setor</button><button onClick={logout}><LogOut size={17}/> Sair</button></div></aside><main className="admin-content"><header className="admin-top"><div><span className="eyebrow">GESTÃO À VISTA / ADMINISTRAÇÃO</span><h1>{({overview:'Visão geral',import:'Importar vendas',sellers:'Colaboradoras',goals:'Metas comerciais',recognitions:'Reconhecimentos',integrations:'Integrações · Santarém Sistemas'} as Record<string,string>)[tab]}</h1></div><div className="admin-user"><span className="admin-online"/> ADMINISTRAÇÃO</div></header><DemoNotice/>{message&&<div className="success-message"><CheckCircle2 size={16}/>{message}<button onClick={()=>setMessage('')}><X size={15}/></button></div>}{parseError&&<div className="error-box">{parseError}</div>}
 {data.error&&<div className="error-box">{data.error}</div>}
 {tab==='overview'&&<><div className="admin-cards"><Metric icon={<Users/>} label="COLABORADORAS ATIVAS" value={String(data.sellers.filter(s=>s.active).length)} detail="Equipe cadastrada" tone="blue"/><Metric icon={<TrendingUp/>} label="FATURAMENTO DO MÊS" value={money(data.sales.filter(s=>s.sale_date.startsWith(today().slice(0,7))).reduce((n,s)=>n+Number(s.revenue),0))} detail="Vendas registradas" tone="green"/><Metric icon={<ShoppingBag/>} label="VENDAS NO MÊS" value={String(data.sales.filter(s=>s.sale_date.startsWith(today().slice(0,7))).reduce((n,s)=>n+Number(s.sales_count),0))} detail="Atendimentos convertidos" tone="gold"/><Metric icon={<Star/>} label="ESTRELAS CONCEDIDAS" value={String(data.recognitions.reduce((n,r)=>n+r.stars,0))} detail="Reconhecimentos acumulados" tone="purple"/></div><div className="admin-panel"><div className="panel-head"><div><h2>Desempenho do mês</h2><p>Ranking atualizado com os registros importados.</p></div><button className="btn secondary" onClick={()=>data.load()}><RefreshCw size={15}/> Atualizar dados</button></div><div className="table-wrap"><table><thead><tr><th>POSIÇÃO</th><th>VENDEDORA</th><th>FATURAMENTO</th><th>VENDAS</th><th>TICKET MÉDIO</th></tr></thead><tbody>{rankRows(data.sellers,data.sales,'month',today()).map((r,i)=><tr key={r.seller.id}><td><b className="rank-number">{i+1}</b></td><td>{r.seller.full_name}</td><td className="money-cell">{exactMoney(r.revenue)}</td><td>{r.count}</td><td>{exactMoney(r.ticket)}</td></tr>)}</tbody></table></div></div><div className="admin-shortcuts"><button onClick={()=>setTab('import')}><Upload/><strong>Importar vendas</strong><span>Atualize os dados diários</span><ArrowUpRight/></button><button onClick={()=>setTab('recognitions')}><Star/><strong>Reconhecer equipe</strong><span>Valorize boas práticas</span><ArrowUpRight/></button><button onClick={()=>setTab('goals')}><Target/><strong>Definir metas</strong><span>Configure o objetivo do mês</span><ArrowUpRight/></button></div></>}
 {tab==='import'&&<div className="admin-panel"><h2>Importação diária de vendas</h2><p>Envie uma planilha Excel no modelo Diária Yup ou um arquivo CSV. Os dados serão conferidos antes de gravar.</p><label className="upload-zone"><input type="file" accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={e=>e.target.files?.[0]&&parseFile(e.target.files[0])}/><Upload size={26}/><strong>{file?file.name:'Selecionar arquivo Excel ou CSV'}</strong><span>Excel (.xlsx/.xls) ou CSV · Prévia antes da confirmação</span></label><div className="format-hint"><strong>Formatos aceitos:</strong><br/>Excel: aba BASE VENDAS com Data, Vendedora, Faturamento líquido (R$) e Nº de vendas.<br/>CSV: data,vendedora,valor,vendas (e-mail opcional).<br/>Datas aceitas: AAAA-MM-DD ou DD/MM/AAAA. Valores em reais, inclusive negativos para registrar estornos. Estornos não aumentam a quantidade de vendas.</div>{preview.length>0&&<><div className="preview-head"><strong>Prévia de importação</strong><span>{preview.length} registros encontrados</span></div><div className="table-wrap"><table><thead><tr><th>DATA</th><th>VENDEDORA</th><th>FATURAMENTO</th><th>VENDAS</th></tr></thead><tbody>{preview.slice(0,10).map((r,i)=><tr key={i}><td>{r.data}</td><td>{r.vendedora}</td><td>{exactMoney(Number(r.valor))}</td><td>{r.vendas}</td></tr>)}</tbody></table></div><button className="btn primary" disabled={saving} onClick={importCsv}>{saving?'Importando...':'Confirmar importação'}<ChevronRight size={16}/></button></>}</div>}
 {tab==='sellers'&&<><div className="admin-panel"><h2>Cadastrar colaboradora</h2><form className="inline-form" onSubmit={addSeller}><label>Nome completo<input value={sellerName} onChange={e=>setSellerName(e.target.value)} required placeholder="Nome da vendedora"/></label><label>E-mail (opcional)<input type="email" value={sellerEmail} onChange={e=>setSellerEmail(e.target.value)} placeholder="email@loja.com"/></label><label>Setor<select value={sellerSector} onChange={e=>setSellerSector(e.target.value as Sector)}><option value="salao">Salão</option><option value="digital">Digital</option><option value="checkout">Checkout</option></select></label><label className="seller-sales-toggle"><input type="checkbox" checked={sellerCanSell} onChange={e=>setSellerCanSell(e.target.checked)}/> Participa das vendas (pódio e ranking)</label><button className="btn primary"><Plus size={16}/> Cadastrar</button></form></div><div className="admin-panel"><h2>Fotos do ranking</h2><p>Adicione a foto de cada colaboradora para o pódio de destaque.</p><form className="inline-form" onSubmit={uploadPhoto}><label>Colaboradora<select value={photoSeller} onChange={e=>setPhotoSeller(e.target.value)} required><option value="">Selecione</option>{data.sellers.map(s=><option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label><label>Imagem<input id="seller-photo" type="file" accept="image/*" required/></label><button className="btn primary"><ImagePlus size={16}/> Enviar foto</button></form></div><div className="admin-panel"><h2>Equipe cadastrada · {data.sellers.length}</h2><div className="seller-list">{data.sellers.map((s,i)=><div className="seller-list-item" key={s.id}><Avatar seller={s} index={i}/><div><strong>{s.full_name}</strong><small>{s.email||'Sem e-mail cadastrado'}</small><small>{s.can_sell===false?'Somente boas ações':'Participa do ranking de vendas'} · Setor: {s.sector?sectorLabel(s.sector):'Não definido'}</small><select aria-label={'Setor de '+s.full_name} value={s.sector||''} onChange={e=>e.target.value&&updateSellerSector(s,e.target.value as Sector)}><option value="">Definir setor</option><option value="salao">Salão</option><option value="digital">Digital</option><option value="checkout">Checkout</option></select></div><button type="button" className={s.can_sell===false?'sales-link-off':'sales-link-on'} onClick={()=>toggleSellerSales(s)}>{s.can_sell===false?'Incluir nas vendas':'Vendedora'}</button><span className={s.active?'active-status':'inactive-status'}>{s.active?'ATIVA':'INATIVA'}</span></div>)}</div></div></>}
 {tab==='goals'&&<>
 <div className="admin-panel">
  <div className="panel-head"><div><h2>Plano de meta comercial · {monthLabel(goal.month)}</h2><p>Cada semana tem datas próprias, como no plano impresso. A TV calcula as metas do filtro escolhido somando os dias de cada semana que caem no período.</p></div>
   <label className="plan-month">Mês<input type="month" value={goal.month.slice(0,7)} onChange={e=>{const month=e.target.value+'-01';const existing=data.goals.find(g=>g.month===month);setGoal(existing||{month,monthly_target:defaultGoal.monthly_target,daily_target:defaultGoal.daily_target})}}/></label></div>
  {planWeeks.length===0&&<p className="plan-empty">Nenhuma semana cadastrada para este mês. Adicione a primeira semana do plano.</p>}
  {planWeeks.map((w,i)=><fieldset className="plan-week" key={i}>
   <legend>{i+1}ª semana</legend>
   <div className="plan-week-dates"><label>Início<input type="date" value={w.start_date} onChange={e=>setWeekField(i,'start_date',e.target.value)} required/></label><label>Fim<input type="date" value={w.end_date} onChange={e=>setWeekField(i,'end_date',e.target.value)} required/></label><span>{w.start_date&&w.end_date&&w.end_date>=w.start_date?spanDays(w.start_date,w.end_date)+' dias':''}</span><button type="button" className="btn secondary" onClick={()=>setPlanWeeks(list=>list.filter((_,j)=>j!==i))}><X size={14}/> Remover semana</button></div>
   {planFieldGroups.map(([title,fields])=><div className="plan-group" key={title}><strong>{title}</strong><div className="plan-fields">{fields.map(([field,label])=><label key={field}>{label}<input type="number" min="0" step="0.01" value={w[field]} onChange={e=>setWeekField(i,field,e.target.value)}/></label>)}</div></div>)}
  </fieldset>)}
  <div className="plan-actions"><button type="button" className="btn secondary" onClick={()=>setPlanWeeks(list=>[...list,newPlanWeek(list)])}><Plus size={16}/> Adicionar semana</button><button type="button" className="btn primary" disabled={planSaving} onClick={savePlan}>{planSaving?'Salvando...':'Salvar plano'} <ChevronRight size={16}/></button>{planWeeks.length>0&&<span className="plan-total">Meta da loja somada: {money(planWeeks.reduce((n,w)=>n+Number(w.store_target||0),0))}</span>}</div>
 </div>
 <div className="admin-panel">
  <h2>Bonificações · {monthLabel(goal.month)}</h2>
  <p>Nível alcançado por semana com o faturamento de cada pessoa: Meta {money(Number(goal.bonus_meta??70))}, Super {money(Number(goal.bonus_super??140))} e Diamante {money(Number(goal.bonus_diamante??250))}. No Checkout, o nível é da equipe e o bônus é dividido entre as vendedoras do setor. Semanas em andamento ainda não entram no total.</p>
  {monthWeeks.length===0?<p className="plan-empty">Cadastre e salve o plano do mês para ver as bonificações.</p>:<div className="table-wrap"><table className="bonus-table"><thead><tr><th>Colaboradora</th><th>Setor</th>{monthWeeks.map(w=><th key={w.week_number}>{w.week_number}ª sem.<br/><small>{new Date(w.start_date+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit'})} a {new Date(w.end_date+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}</small></th>)}<th>Total</th></tr></thead><tbody>{bonusRows.map(r=><tr key={r.seller.id}><td>{r.seller.full_name}</td><td>{sectorName(r.sector)}</td>{r.weeks.map((w,i)=><td key={i} className={w.future?'bonus-future':''}>{w.future?'—':w.tier?<><span className={'bonus-tier '+w.tier}>{tierLabel(w.tier)}</span> {money(w.bonus)}{w.open&&<small> parcial</small>}</>:<span className="bonus-none">{w.open?'em andamento':'sem nível'}</span>}</td>)}<td className="money-cell">{money(r.total)}</td></tr>)}</tbody></table></div>}
 </div>
 <div className="admin-panel narrow-panel"><h2>Meta mensal, bonificações e aumento por setor</h2><p>Valores do mês selecionado acima.</p><form onSubmit={saveGoal} className="stack-form">
  <label>Meta mensal da loja (R$)<input type="number" min="0" step="0.01" value={goal.monthly_target} onChange={e=>setGoal({...goal,monthly_target:Number(e.target.value)})} required/></label>
  <label>Meta diária (R$)<input type="number" min="0" step="0.01" value={goal.daily_target} onChange={e=>setGoal({...goal,daily_target:Number(e.target.value)})} required/></label>
  <div className="plan-fields"><label>Bônus Meta (R$)<input type="number" min="0" step="0.01" value={goal.bonus_meta??70} onChange={e=>setGoal({...goal,bonus_meta:Number(e.target.value)})}/></label><label>Bônus Super (R$)<input type="number" min="0" step="0.01" value={goal.bonus_super??140} onChange={e=>setGoal({...goal,bonus_super:Number(e.target.value)})}/></label><label>Bônus Diamante (R$)<input type="number" min="0" step="0.01" value={goal.bonus_diamante??250} onChange={e=>setGoal({...goal,bonus_diamante:Number(e.target.value)})}/></label></div>
  <div className="plan-fields"><label>Aumento Salão (%)<input type="number" step="0.01" value={goal.growth_salao??''} onChange={e=>setGoal({...goal,growth_salao:e.target.value===''?null:Number(e.target.value)})}/></label><label>Aumento Digital (%)<input type="number" step="0.01" value={goal.growth_digital??''} onChange={e=>setGoal({...goal,growth_digital:e.target.value===''?null:Number(e.target.value)})}/></label><label>Aumento Checkout (%)<input type="number" step="0.01" value={goal.growth_checkout??''} onChange={e=>setGoal({...goal,growth_checkout:e.target.value===''?null:Number(e.target.value)})}/></label></div>
  <button className="btn primary">Salvar meta do mês <ChevronRight size={16}/></button></form></div>
</>}
 {tab==='integrations'&&<ErpIntegration sellers={data.sellers} onPublished={()=>void data.load()}/>}
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
   <Route path="/viewer/sectors" element={<Guard role="viewer"><Dashboard data={data} mode="sectors"/></Guard>}/>
   <Route path="/admin/sectors" element={<Guard role="admin"><Dashboard data={data} mode="sectors" admin/></Guard>}/>
  <Route path="/admin" element={<Guard role="admin"><Admin/></Guard>}/>
  <Route path="*" element={<Navigate to="/" replace/>}/>
 </Routes>
}

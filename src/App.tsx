import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Navigate, Route, Routes, Link, useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import {
  Trophy, TrendingUp, ShoppingBag, Target, Star, Lightbulb, Medal,
  Upload, Users, LogOut, LayoutDashboard, CalendarDays, Plus, Monitor,
  RefreshCw, ChevronRight, Sparkles, ShieldCheck, AlertCircle, CheckCircle2,
  Crown, ArrowUpRight, ImagePlus, X
} from 'lucide-react'
import { supabase, hasSupabase } from './lib/supabase'

type Seller = { id:string; full_name:string; email:string|null; photo_url:string|null; active:boolean }
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
const today = () => new Date().toLocaleDateString('en-CA')
const monthKey = (date:string) => date.slice(0,7)+'-01'
const monthLabel = (date:string) => new Date(date+'T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'})
const initial = (name:string) => name.split(' ').filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()
const initialsColor = (i:number) => ['#e2b66d','#8ca6b8','#ba91a7','#82a998','#9b91bc'][i%5]
const dateRange = (period:Period, date:string) => {
  const d = new Date(date+'T12:00:00')
  if(period==='day') return [date,date]
  if(period==='month') return [date.slice(0,7)+'-01',new Date(d.getFullYear(),d.getMonth()+1,0).toLocaleDateString('en-CA')]
  const day=(d.getDay()+6)%7; const start=new Date(d); start.setDate(d.getDate()-day)
  const end=new Date(start); end.setDate(start.getDate()+6)
  return [start.toLocaleDateString('en-CA'),end.toLocaleDateString('en-CA')]
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
 const [sellers,setSellers]=useState<Seller[]>(hasSupabase?[]:demoSellers),[sales,setSales]=useState<Sale[]>(hasSupabase?[]:demoSales),[recognitions,setRecognitions]=useState<Recognition[]>(hasSupabase?[]:demoRecognitions),[goals,setGoals]=useState<Goal[]>(hasSupabase?[]:[defaultGoal]),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const load=useCallback(async()=>{
  const client=supabase
  if(!client)return
  setBusy(true);setError('')
  try{
   const fetchAll=async(table:'sellers'|'sales_daily'|'recognitions'|'goals',column:string,ascending=true)=>{
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
   const [a,b,c,d]=await Promise.all([
    fetchAll('sellers','full_name'),
    fetchAll('sales_daily','sale_date',false),
    fetchAll('recognitions','recognized_at',false),
    fetchAll('goals','month',false)
   ])
   setSellers(a as unknown as Seller[]);setSales(b as unknown as Sale[]);setRecognitions(c as unknown as Recognition[]);setGoals(d as unknown as Goal[])
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
 return {sellers,sales,recognitions,goals,setSellers,setSales,setRecognitions,setGoals,load,busy,error}
}

function Avatar({seller,size='md',index=0}:{seller:Seller;size?:'sm'|'md'|'lg'|'xl';index?:number}){
 return <div className={'avatar '+size} style={{background:initialsColor(index)}}>{seller.photo_url?<img src={seller.photo_url} alt={seller.full_name}/>:initial(seller.full_name)}</div>
}
function Brand(){return <div className="brand"><div className="brand-mark"><Trophy size={20}/></div><div><strong>gestão<span>à vista</span></strong><small>RESULTADOS QUE INSPIRAM</small></div></div>}
function Header({admin=false}:{admin?:boolean}){
 return <header className="topbar"><Brand/><div className="topbar-right"><span className="live-dot"/> <span className="live-label">DADOS ATUALIZADOS</span>{admin&&<Link to="/" className="light-link"><Monitor size={16}/> Painel TV</Link>}</div></header>
}
function DemoNotice(){return !hasSupabase?<div className="demo-notice"><AlertCircle size={15}/> MODO DEMONSTRAÇÃO — conecte o Supabase para autenticação e dados reais.</div>:null}
function Login({role}:{role:'admin'|'viewer'}){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const nav=useNavigate()
 async function submit(e:FormEvent){e.preventDefault();setError('');if(!supabase){setError('Configure as variáveis do Supabase para habilitar o login.');return}setBusy(true);try{const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});if(error){setError(error.message);return}nav(role==='admin'?'/admin':'/viewer')}catch(e){setError(e instanceof Error?e.message:'Não foi possível conectar ao serviço de autenticação.')}finally{setBusy(false)}}
 return <div className="login-page"><div className="login-side"><Brand/><div className="login-message"><span className="eyebrow">CULTURA DE RESULTADOS</span><h1>Grandes resultados começam com <em>visibilidade.</em></h1><p>Informação clara, reconhecimento e um time que cresce junto.</p><div className="login-stat"><Trophy/><div><strong>Uma equipe. Um objetivo.</strong><small>Cada conquista conta.</small></div></div></div><div className="login-foot">GESTÃO À VISTA · DESEMPENHO EM TEMPO REAL</div></div><div className="login-form-wrap"><form className="login-card" onSubmit={submit}><div className="form-icon">{role==='admin'?<ShieldCheck/>:<Users/>}</div><span className="eyebrow">{role==='admin'?'ÁREA RESTRITA':'ACESSO DA EQUIPE'}</span><h2>{role==='admin'?'Administração':'Painel da equipe'}</h2><p>{role==='admin'?'Entre para gerenciar os resultados e reconhecer o time.':'Entre para acompanhar os resultados da equipe.'}</p><label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="seu@email.com" required/></label><label>Senha<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Sua senha" required/></label>{error&&<div className="error-box">{error}</div>}<button className="btn primary full" disabled={busy}>{busy?'Entrando...':'Entrar'}<ChevronRight size={17}/></button><Link to="/" className="back-link">Voltar ao painel de visualização</Link></form></div></div>
}
function rankRows(sellers:Seller[],sales:Sale[],recognitions:Recognition[],period:Period,date:string,rangeEnd?:string){
 const [start,defaultEnd]=dateRange(period,date)
 const end=period==='range'&&rangeEnd?rangeEnd:defaultEnd
 return sellers.filter(s=>s.active).map(s=>{
  const rows=sales.filter(x=>x.seller_id===s.id&&x.sale_date>=start&&x.sale_date<=end)
  const revenue=rows.reduce((n,x)=>n+Number(x.revenue),0),count=rows.reduce((n,x)=>n+Number(x.sales_count),0)
  const grossRevenue=rows.reduce((n,x)=>n+Number(x.gross_revenue??Math.max(Number(x.revenue),0)),0)
  return {seller:s,revenue,count,ticket:count?grossRevenue/count:0,stars:recognitions.filter(x=>x.seller_id===s.id).reduce((n,x)=>n+x.stars,0)}
 }).sort((a,b)=>b.revenue-a.revenue)
}
function Podium({rows}:{rows:ReturnType<typeof rankRows>}){
 const ordered=rows.slice(0,3)
 return <div className="podium">{ordered.map((r,i)=>{const rank=i===1?1:i===0?2:3;return <div className={'podium-person place-'+rank} key={r.seller.id}><div className="podium-crown">{rank===1?<Crown/>:<Medal/>}</div><div className="podium-avatar"><Avatar seller={r.seller} size={rank===1?'xl':'lg'} index={rank}/><span className="podium-rank">{rank}</span></div><strong>{r.seller.full_name}</strong><b>{money(r.revenue)}</b><small>{r.count} vendas</small><div className="podium-base"><span>{rank===1?'1º LUGAR':rank===2?'2º LUGAR':'3º LUGAR'}</span></div></div>})}</div>
}
function periodText(p:Period){return p==='day'?'HOJE':p==='week'?'ESTA SEMANA':p==='range'?'PERÍODO PERSONALIZADO':'ESTE MÊS'}
function Dashboard({data,full=false}:{data:ReturnType<typeof useData>;full?:boolean}){
 const [period,setPeriod]=useState<Period>('month'),[date,setDate]=useState(today()),[endDate,setEndDate]=useState(today()),[now,setNow]=useState(new Date())
 useEffect(()=>{const t=setInterval(()=>setNow(new Date()),30000);return()=>clearInterval(t)},[])
 const rows=useMemo(()=>rankRows(data.sellers,data.sales,data.recognitions,period,date,endDate>=date?endDate:date),[data.sellers,data.sales,data.recognitions,period,date,endDate])
 const monthRows=useMemo(()=>rankRows(data.sellers,data.sales,data.recognitions,'month',date),[data.sellers,data.sales,data.recognitions,date])
 const allMonth=monthRows.reduce((n,r)=>n+r.revenue,0)
 const periodRevenue=rows.reduce((n,r)=>n+r.revenue,0),periodCount=rows.reduce((n,r)=>n+r.count,0)
 const periodTicket=periodCount?rows.reduce((n,r)=>n+r.ticket*r.count,0)/periodCount:0
 const periodLabel=period==='day'?'no dia':period==='week'?'na semana':period==='range'?'no período selecionado':'no mês'
 const goal=data.goals.find(g=>g.month===monthKey(date))||defaultGoal
 const progress=goal.monthly_target?Math.max(0,Math.min(100,allMonth/Number(goal.monthly_target)*100)):0
 const ideas=data.recognitions.filter(r=>r.stars>0).sort((a,b)=>b.recognized_at.localeCompare(a.recognized_at))
 const [ideaIndex,setIdeaIndex]=useState(0)
 useEffect(()=>{if(ideas.length<2)return;const t=setInterval(()=>setIdeaIndex(i=>(i+1)%ideas.length),6500);return()=>clearInterval(t)},[ideas.length])
 const currentIdea=ideas.length?ideas[ideaIndex%ideas.length]:null
 const recognitionSeller=currentIdea?data.sellers.find(s=>s.id===currentIdea.seller_id):null
 const [rankingStep,setRankingStep]=useState(0)
 const rankingPageSize=6
 const rankingMaxStart=Math.max(0,rows.length-rankingPageSize)
 const safeRankingStep=Math.min(rankingStep,2*rankingMaxStart)
 const rankingStart=safeRankingStep<=rankingMaxStart?safeRankingStep:2*rankingMaxStart-safeRankingStep
 useEffect(()=>{setRankingStep(0)},[rows.length,period,date,endDate])
 useEffect(()=>{
  if(!full||rankingMaxStart===0)return
  const timer=window.setInterval(()=>setRankingStep(current=>current>=2*rankingMaxStart?0:current+1),2600)
  return()=>window.clearInterval(timer)
 },[full,rankingMaxStart])
 const visibleRankingRows=full?rows.slice(rankingStart,rankingStart+rankingPageSize):rows
 return <div className={full?'dashboard full-dashboard':'dashboard'}>
  <Header/><DemoNotice/>{data.error&&<div className="error-box" role="alert">Falha ao carregar os dados: {data.error}</div>}
  <main className="dash-main">
   <section className="welcome-line"><div><span className="eyebrow">NOSSO DESEMPENHO · {periodText(period)}</span><h1>O resultado é de <em>todas nós.</em></h1><p>Transparência para evoluir. Reconhecimento para inspirar.</p></div><div className="date-chip"><CalendarDays size={16}/>{period==='range'?new Date(date+'T12:00:00').toLocaleDateString('pt-BR')+' até '+new Date(endDate+'T12:00:00').toLocaleDateString('pt-BR'):new Date(date+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})}<span>{now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span></div></section>
   <section className="period-row"><div className="period-tabs">{(['day','week','month','range'] as Period[]).map(p=><button onClick={()=>setPeriod(p)} className={period===p?'active':''} key={p}>{p==='day'?'Diário':p==='week'?'Semanal':p==='month'?'Mensal':'Período'}</button>)}</div>{period==='range'?<div className="date-range-fields"><label>De<input aria-label="Data inicial do período" type="date" value={date} max={endDate} onChange={e=>{if(e.target.value){setDate(e.target.value);if(e.target.value>endDate)setEndDate(e.target.value)}}}/></label><label>Até<input aria-label="Data final do período" type="date" value={endDate} min={date} onChange={e=>{if(e.target.value)setEndDate(e.target.value)}}/></label></div>:<input aria-label="Data de referência" type="date" value={date} onChange={e=>{if(e.target.value){setDate(e.target.value);setEndDate(e.target.value)}}}/>}</section>
   <section className="metrics-grid">
    <Metric icon={<Target/>} label="META MENSAL" value={money(Number(goal.monthly_target))} detail={monthLabel(date)} tone="gold"/>
    <Metric icon={<TrendingUp/>} label="FATURAMENTO DO PERÍODO" value={money(periodRevenue)} detail={'Resultado '+periodLabel} tone="green"/>
    <Metric icon={<ShoppingBag/>} label="TICKET MÉDIO DO PERÍODO" value={exactMoney(periodTicket)} detail={periodCount+' vendas '+periodLabel} tone="blue"/>
    <Metric icon={<CalendarDays/>} label="QUANTIDADE DE VENDAS" value={String(periodCount)} detail={'Vendas registradas '+periodLabel} tone="purple"/>
   </section>
   <section className="goal-progress"><div className="goal-progress-head"><div><span className="eyebrow">ACOMPANHAMENTO DA META MENSAL</span><strong>{progress.toFixed(1)}% <small>alcançados</small></strong></div><span>{money(allMonth)} <small>de</small> {money(Number(goal.monthly_target))}</span></div><div className="progress-track"><div style={{width:progress+'%'}}/></div><div className="progress-footer"><span>Vamos juntas até o próximo marco.</span><strong>Faltam {money(Math.max(0,Number(goal.monthly_target)-allMonth))}</strong></div></section>
   <section className="ranking-section"><div className="section-head"><div><span className="eyebrow">DESTAQUES DA EQUIPE</span><h2>Nosso pódio <span>de resultados</span></h2></div><span className="period-tag">{periodText(period)}</span></div><Podium rows={rows.slice(0,3)}/></section>
   <section className="table-section"><div className="section-head"><div><span className="eyebrow">TODO MUNDO FAZ A DIFERENÇA</span><h2>Ranking <span>de vendas</span></h2></div><span className="subtle-count">{rows.length} colaboradoras</span></div><div className="table-wrap"><table><thead><tr><th>POSIÇÃO</th><th>VENDEDORA</th><th>VALOR VENDIDO</th><th>VENDAS</th><th>TICKET MÉDIO</th><th>ESTRELAS</th></tr></thead><tbody key={full?safeRankingStep:'all'} className={full?'ranking-animated-body':''}>{visibleRankingRows.map((r,visibleIndex)=>{const i=full?rankingStart+visibleIndex:visibleIndex;return <tr className={full?'ranking-animated-row':''} key={r.seller.id}><td><span className={'rank-number '+(i<3?'top-rank':'')}>{String(i+1).padStart(2,'0')}</span></td><td><div className="seller-cell"><Avatar seller={r.seller} size="sm" index={i}/><strong>{r.seller.full_name}</strong>{i===0&&<span className="leader-chip">LÍDER</span>}</div></td><td className="money-cell">{exactMoney(r.revenue)}</td><td>{r.count}</td><td>{exactMoney(r.ticket)}</td><td><div className="stars-cell"><Star size={14} fill={r.stars?'currentColor':'none'}/><b>{r.stars}</b></div></td></tr>})}</tbody></table>{rows.length===0&&<div className="empty-state">Nenhum resultado para este período.</div>}</div></section>
   <section className="ideas-section"><div className="ideas-title"><div className="ideas-icon"><Lightbulb/></div><div><span className="eyebrow">CULTURA QUE FAZ A DIFERENÇA</span><h2>Boas ideias merecem <em>destaque.</em></h2></div></div><div className="ticker-card">{currentIdea&&recognitionSeller?<><div className="ticker-profile"><Avatar seller={recognitionSeller} size="lg"/><div><strong>{recognitionSeller.full_name}</strong><span>{currentIdea.kind==='ideia_implementada'?'IDEIA IMPLEMENTADA':'BOA PRÁTICA'}</span></div></div><div className="ticker-copy"><strong>{currentIdea.title}</strong><p>{currentIdea.description}</p></div><div className="ticker-stars">{Array.from({length:currentIdea.stars},(_,i)=><Star key={i} fill="currentColor"/>)}</div><div className="ticker-counter">{String((ideaIndex%Math.max(ideas.length,1))+1).padStart(2,'0')} / {String(ideas.length).padStart(2,'0')}</div></>:<div className="empty-ideas"><Sparkles/><strong>As próximas boas ideias podem ser suas.</strong><span>As conquistas da equipe aparecerão aqui.</span></div>}</div></section>
  </main>
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
 const [sellerName,setSellerName]=useState(''),[sellerEmail,setSellerEmail]=useState('')
 const [goal,setGoal]=useState(defaultGoal)
 const [recSeller,setRecSeller]=useState(''),[recTitle,setRecTitle]=useState(''),[recDescription,setRecDescription]=useState(''),[recStars,setRecStars]=useState(1),[recKind,setRecKind]=useState('boas_praticas')
 const [photoSeller,setPhotoSeller]=useState('')
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
   current.sales_count+=Number(row.vendas)
   totals.set(key,current)
  }
  const payload=[...totals.values()].map(row=>({...row,source:'csv'}))
  const {error}=await supabase.from('sales_daily').upsert(payload,{onConflict:'seller_id,sale_date'})
  if(error)throw error
  setMessage('Importação concluída: '+preview.length+' linhas consolidadas em '+payload.length+' registros, sem duplicidade por colaboradora e data.')
  setPreview([]);setFile(null);await data.load()
 }catch(e){setParseError(e instanceof Error?e.message:'Falha na importação.')}finally{setSaving(false)}}
 async function addSeller(e:FormEvent){e.preventDefault();if(!supabase)return;const {error}=await supabase.from('sellers').insert({full_name:sellerName,email:sellerEmail||null});if(error)setMessage(error.message);else{setSellerName('');setSellerEmail('');setMessage('Colaboradora cadastrada.');await data.load()}}
 async function saveGoal(e:FormEvent){e.preventDefault();if(!supabase)return;const {error}=await supabase.from('goals').upsert(goal,{onConflict:'month'});setMessage(error?.message||'Meta salva.');await data.load()}
 async function addRecognition(e:FormEvent){e.preventDefault();if(!supabase)return;const {error}=await supabase.from('recognitions').insert({seller_id:recSeller,stars:recStars,kind:recKind,title:recTitle,description:recDescription,recognized_at:today()});setMessage(error?.message||'Reconhecimento publicado no painel.');if(!error){setRecTitle('');setRecDescription('');setRecStars(1);await data.load()}}
 async function uploadPhoto(e:FormEvent){e.preventDefault();const el=document.getElementById('seller-photo') as HTMLInputElement;const f=el.files?.[0];if(!f||!supabase||!photoSeller)return;const path=photoSeller+'/'+Date.now()+'-'+f.name.replace(/[^a-zA-Z0-9.-]/g,'_');const {error}=await supabase.storage.from('seller-photos').upload(path,f,{upsert:true});if(error){setMessage(error.message);return}const {data:pub}=supabase.storage.from('seller-photos').getPublicUrl(path);const {error:e2}=await supabase.from('sellers').update({photo_url:pub.publicUrl}).eq('id',photoSeller);setMessage(e2?.message||'Foto atualizada.');await data.load()}
 return <div className="admin-shell"><aside className="admin-sidebar"><Brand/><div className="sidebar-label">GESTÃO COMERCIAL</div><nav>{[['overview','Visão geral',LayoutDashboard],['import','Importar vendas',Upload],['sellers','Colaboradoras',Users],['goals','Metas',Target],['recognitions','Reconhecimentos',Star]] .map(([id,label,Icon])=><button key={String(id)} className={tab===id?'selected':''} onClick={()=>setTab(String(id))}>{<Icon size={18}/>} {String(label)}<ChevronRight size={14}/></button>)}</nav><div className="sidebar-bottom"><button onClick={()=>nav('/')}><Monitor size={17}/> Abrir painel TV</button><button onClick={logout}><LogOut size={17}/> Sair</button></div></aside><main className="admin-content"><header className="admin-top"><div><span className="eyebrow">GESTÃO À VISTA / ADMINISTRAÇÃO</span><h1>{({overview:'Visão geral',import:'Importar vendas',sellers:'Colaboradoras',goals:'Metas comerciais',recognitions:'Reconhecimentos'} as Record<string,string>)[tab]}</h1></div><div className="admin-user"><span className="admin-online"/> ADMINISTRAÇÃO</div></header><DemoNotice/>{message&&<div className="success-message"><CheckCircle2 size={16}/>{message}<button onClick={()=>setMessage('')}><X size={15}/></button></div>}{parseError&&<div className="error-box">{parseError}</div>}
 {data.error&&<div className="error-box">{data.error}</div>}
 {tab==='overview'&&<><div className="admin-cards"><Metric icon={<Users/>} label="COLABORADORAS ATIVAS" value={String(data.sellers.filter(s=>s.active).length)} detail="Equipe cadastrada" tone="blue"/><Metric icon={<TrendingUp/>} label="FATURAMENTO DO MÊS" value={money(data.sales.filter(s=>s.sale_date.startsWith(today().slice(0,7))).reduce((n,s)=>n+Number(s.revenue),0))} detail="Vendas registradas" tone="green"/><Metric icon={<ShoppingBag/>} label="VENDAS NO MÊS" value={String(data.sales.filter(s=>s.sale_date.startsWith(today().slice(0,7))).reduce((n,s)=>n+Number(s.sales_count),0))} detail="Atendimentos convertidos" tone="gold"/><Metric icon={<Star/>} label="ESTRELAS CONCEDIDAS" value={String(data.recognitions.reduce((n,r)=>n+r.stars,0))} detail="Reconhecimentos acumulados" tone="purple"/></div><div className="admin-panel"><div className="panel-head"><div><h2>Desempenho do mês</h2><p>Ranking atualizado com os registros importados.</p></div><button className="btn secondary" onClick={()=>data.load()}><RefreshCw size={15}/> Atualizar dados</button></div><div className="table-wrap"><table><thead><tr><th>POSIÇÃO</th><th>VENDEDORA</th><th>FATURAMENTO</th><th>VENDAS</th><th>TICKET MÉDIO</th></tr></thead><tbody>{rankRows(data.sellers,data.sales,data.recognitions,'month',today()).map((r,i)=><tr key={r.seller.id}><td><b className="rank-number">{i+1}</b></td><td>{r.seller.full_name}</td><td className="money-cell">{exactMoney(r.revenue)}</td><td>{r.count}</td><td>{exactMoney(r.ticket)}</td></tr>)}</tbody></table></div></div><div className="admin-shortcuts"><button onClick={()=>setTab('import')}><Upload/><strong>Importar vendas</strong><span>Atualize os dados diários</span><ArrowUpRight/></button><button onClick={()=>setTab('recognitions')}><Star/><strong>Reconhecer equipe</strong><span>Valorize boas práticas</span><ArrowUpRight/></button><button onClick={()=>setTab('goals')}><Target/><strong>Definir metas</strong><span>Configure o objetivo do mês</span><ArrowUpRight/></button></div></>}
 {tab==='import'&&<div className="admin-panel"><h2>Importação diária de vendas</h2><p>Envie uma planilha Excel no modelo Diária Yup ou um arquivo CSV. Os dados serão conferidos antes de gravar.</p><label className="upload-zone"><input type="file" accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={e=>e.target.files?.[0]&&parseFile(e.target.files[0])}/><Upload size={26}/><strong>{file?file.name:'Selecionar arquivo Excel ou CSV'}</strong><span>Excel (.xlsx/.xls) ou CSV · Prévia antes da confirmação</span></label><div className="format-hint"><strong>Formatos aceitos:</strong><br/>Excel: aba BASE VENDAS com Data, Vendedora, Faturamento líquido (R$) e Nº de vendas.<br/>CSV: data,vendedora,valor,vendas (e-mail opcional).<br/>Datas aceitas: AAAA-MM-DD ou DD/MM/AAAA. Valores em reais, inclusive negativos para registrar estornos. Estornos não aumentam a quantidade de vendas.</div>{preview.length>0&&<><div className="preview-head"><strong>Prévia de importação</strong><span>{preview.length} registros encontrados</span></div><div className="table-wrap"><table><thead><tr><th>DATA</th><th>VENDEDORA</th><th>FATURAMENTO</th><th>VENDAS</th></tr></thead><tbody>{preview.slice(0,10).map((r,i)=><tr key={i}><td>{r.data}</td><td>{r.vendedora}</td><td>{exactMoney(Number(r.valor))}</td><td>{r.vendas}</td></tr>)}</tbody></table></div><button className="btn primary" disabled={saving} onClick={importCsv}>{saving?'Importando...':'Confirmar importação'}<ChevronRight size={16}/></button></>}</div>}
 {tab==='sellers'&&<><div className="admin-panel"><h2>Cadastrar colaboradora</h2><form className="inline-form" onSubmit={addSeller}><label>Nome completo<input value={sellerName} onChange={e=>setSellerName(e.target.value)} required placeholder="Nome da vendedora"/></label><label>E-mail (opcional)<input type="email" value={sellerEmail} onChange={e=>setSellerEmail(e.target.value)} placeholder="email@loja.com"/></label><button className="btn primary"><Plus size={16}/> Cadastrar</button></form></div><div className="admin-panel"><h2>Fotos do ranking</h2><p>Adicione a foto de cada colaboradora para o pódio de destaque.</p><form className="inline-form" onSubmit={uploadPhoto}><label>Colaboradora<select value={photoSeller} onChange={e=>setPhotoSeller(e.target.value)} required><option value="">Selecione</option>{data.sellers.map(s=><option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label><label>Imagem<input id="seller-photo" type="file" accept="image/*" required/></label><button className="btn primary"><ImagePlus size={16}/> Enviar foto</button></form></div><div className="admin-panel"><h2>Equipe cadastrada · {data.sellers.length}</h2><div className="seller-list">{data.sellers.map((s,i)=><div className="seller-list-item" key={s.id}><Avatar seller={s} index={i}/><div><strong>{s.full_name}</strong><small>{s.email||'Sem e-mail cadastrado'}</small></div><span className={s.active?'active-status':'inactive-status'}>{s.active?'ATIVA':'INATIVA'}</span></div>)}</div></div></>}
 {tab==='goals'&&<div className="admin-panel narrow-panel"><h2>Configuração das metas</h2><p>Informe o objetivo coletivo para o mês e o valor de referência por dia.</p><form onSubmit={saveGoal} className="stack-form"><label>Mês de referência<input type="month" value={goal.month.slice(0,7)} onChange={e=>setGoal({...goal,month:e.target.value+'-01'})} required/></label><label>Meta mensal (R$)<input type="number" min="0" step="0.01" value={goal.monthly_target} onChange={e=>setGoal({...goal,monthly_target:Number(e.target.value)})} required/></label><label>Meta diária (R$)<input type="number" min="0" step="0.01" value={goal.daily_target} onChange={e=>setGoal({...goal,daily_target:Number(e.target.value)})} required/></label><button className="btn primary">Salvar metas <ChevronRight size={16}/></button></form></div>}
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
  <Route path="/viewer/board" element={<Guard role="viewer"><Dashboard data={data} full/></Guard>}/>
  <Route path="/admin" element={<Guard role="admin"><Admin/></Guard>}/>
  <Route path="*" element={<Navigate to="/" replace/>}/>
 </Routes>
}

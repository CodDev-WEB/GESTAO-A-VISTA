-- Gestão à Vista: schema inicial e políticas de acesso.
-- Execute todo este arquivo no SQL Editor do Supabase.
-- O script pode ser executado novamente sem duplicar tabelas ou políticas.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'viewer' check (role in ('admin','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.sellers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text unique,
  photo_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.sellers add column if not exists can_sell boolean not null default true;
alter table public.sellers add column if not exists sector text;
alter table public.sellers drop constraint if exists sellers_sector_check;
alter table public.sellers add constraint sellers_sector_check
  check (sector is null or sector in ('salao','digital','checkout'));

create table if not exists public.sector_goals (
  id uuid primary key default gen_random_uuid(),
  sector text not null check (sector in ('salao','digital','checkout')),
  week_start date not null,
  target numeric(14,2) not null default 0 check (target >= 0),
  created_at timestamptz not null default now(),
  constraint sector_goals_sector_week_key unique (sector, week_start)
);


create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  month date not null unique,
  monthly_target numeric(14,2) not null default 0 check (monthly_target >= 0),
  daily_target numeric(14,2) not null default 0 check (daily_target >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.sales_daily (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  sale_date date not null,
  revenue numeric(14,2) not null default 0,
  gross_revenue numeric(14,2) not null default 0 check (gross_revenue >= 0),
  refund_amount numeric(14,2) not null default 0 check (refund_amount >= 0),
  sales_count integer not null default 0 check (sales_count >= 0),
  source text not null default 'manual',
  import_key text,
  created_at timestamptz not null default now(),
  constraint sales_daily_seller_date_key unique (seller_id, sale_date)
);

create table if not exists public.recognitions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  stars integer not null default 1 check (stars between 1 and 5),
  kind text not null check (kind in ('boas_praticas','ideia_implementada')),
  title text not null,
  description text not null,
  recognized_at date not null default current_date,
  created_at timestamptz not null default now()
);


-- Migração segura para instalações existentes: faturamento líquido pode ficar negativo
-- quando há estornos. Mantém faturamento bruto e estornos separados para o ticket médio.
alter table public.sales_daily drop constraint if exists sales_daily_revenue_check;
alter table public.sales_daily add column if not exists gross_revenue numeric(14,2) not null default 0;
alter table public.sales_daily add column if not exists refund_amount numeric(14,2) not null default 0;
update public.sales_daily
set gross_revenue = greatest(revenue, 0),
    refund_amount = greatest(-revenue, 0)
where gross_revenue = 0 and refund_amount = 0 and revenue <> 0;
alter table public.sales_daily drop constraint if exists sales_daily_gross_revenue_check;
alter table public.sales_daily add constraint sales_daily_gross_revenue_check check (gross_revenue >= 0);
alter table public.sales_daily drop constraint if exists sales_daily_refund_amount_check;
alter table public.sales_daily add constraint sales_daily_refund_amount_check check (refund_amount >= 0);

create index if not exists sales_daily_date_idx on public.sales_daily(sale_date);
create index if not exists sales_daily_seller_date_idx on public.sales_daily(seller_id, sale_date);
create index if not exists recognitions_date_idx on public.recognitions(recognized_at desc);

-- Bucket público para que as fotos apareçam no painel da TV sem sessão.
insert into storage.buckets (id, name, public)
values ('seller-photos', 'seller-photos', true)
on conflict (id) do update set public = excluded.public;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid() and active = true
  limit 1
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

alter table public.profiles enable row level security;
alter table public.sellers enable row level security;
alter table public.goals enable row level security;
alter table public.sector_goals enable row level security;
alter table public.sales_daily enable row level security;
alter table public.recognitions enable row level security;

-- Perfis: cada usuário lê o próprio perfil; administradores gerenciam todos.
drop policy if exists "profiles read self or admin" on public.profiles;
create policy "profiles read self or admin" on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "admins manage profiles" on public.profiles;
create policy "admins manage profiles" on public.profiles
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "authenticated read sector goals" on public.sector_goals;
create policy "authenticated read sector goals" on public.sector_goals
for select to authenticated using (true);
drop policy if exists "admins manage sector goals" on public.sector_goals;
create policy "admins manage sector goals" on public.sector_goals
for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Dados operacionais: leitura autenticada e escrita exclusiva de administradores.
drop policy if exists "authenticated read sellers" on public.sellers;
create policy "authenticated read sellers" on public.sellers
for select to authenticated using (true);
drop policy if exists "admins manage sellers" on public.sellers;
create policy "admins manage sellers" on public.sellers
for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read goals" on public.goals;
create policy "authenticated read goals" on public.goals
for select to authenticated using (true);
drop policy if exists "admins manage goals" on public.goals;
create policy "admins manage goals" on public.goals
for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read sales" on public.sales_daily;
create policy "authenticated read sales" on public.sales_daily
for select to authenticated using (true);
drop policy if exists "admins manage sales" on public.sales_daily;
create policy "admins manage sales" on public.sales_daily
for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated read recognitions" on public.recognitions;
create policy "authenticated read recognitions" on public.recognitions
for select to authenticated using (true);
drop policy if exists "admins manage recognitions" on public.recognitions;
create policy "admins manage recognitions" on public.recognitions
for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Fotos: leitura pública pelo bucket; gravação e remoção somente por administradores.
drop policy if exists "authenticated view seller photos" on storage.objects;
drop policy if exists "public view seller photos" on storage.objects;
create policy "public view seller photos" on storage.objects
for select to public using (bucket_id = 'seller-photos');

drop policy if exists "admins upload seller photos" on storage.objects;
create policy "admins upload seller photos" on storage.objects
for insert to authenticated
with check (bucket_id = 'seller-photos' and public.is_admin());

drop policy if exists "admins update seller photos" on storage.objects;
create policy "admins update seller photos" on storage.objects
for update to authenticated
using (bucket_id = 'seller-photos' and public.is_admin())
with check (bucket_id = 'seller-photos' and public.is_admin());

drop policy if exists "admins delete seller photos" on storage.objects;
create policy "admins delete seller photos" on storage.objects
for delete to authenticated
using (bucket_id = 'seller-photos' and public.is_admin());

-- Depois de criar o usuário em Authentication > Users, associe-o a um perfil:
-- insert into public.profiles (id, full_name, role, active)
-- select id, 'Nome do administrador', 'admin', true
-- from auth.users where email = 'admin@seudominio.com'
-- on conflict (id) do update
-- set full_name = excluded.full_name, role = excluded.role, active = true;

-- Plano de meta comercial por semana (ver migrations/20261112020000_goal_plan.sql)
-- Bonificação por nível e aumento percentual por setor, definidos por mês.
alter table public.goals add column if not exists bonus_meta numeric(14,2) not null default 70;
alter table public.goals add column if not exists bonus_super numeric(14,2) not null default 140;
alter table public.goals add column if not exists bonus_diamante numeric(14,2) not null default 250;
alter table public.goals add column if not exists growth_salao numeric(6,2);
alter table public.goals add column if not exists growth_digital numeric(6,2);
alter table public.goals add column if not exists growth_checkout numeric(6,2);

create table if not exists public.goal_weeks (
  id uuid primary key default gen_random_uuid(),
  month date not null,
  week_number int not null check (week_number between 1 and 6),
  start_date date not null,
  end_date date not null,
  -- Meta da loja e divisão por canal (R$)
  store_target numeric(14,2) not null default 0 check (store_target >= 0),
  salao_revenue_target numeric(14,2) not null default 0 check (salao_revenue_target >= 0),
  digital_revenue_target numeric(14,2) not null default 0 check (digital_revenue_target >= 0),
  -- Metas coletivas dos setores
  salao_sales_target numeric(14,2) not null default 0 check (salao_sales_target >= 0),          -- quantidade de vendas
  digital_conversions_target numeric(14,2) not null default 0 check (digital_conversions_target >= 0), -- conversões
  checkout_ticket_target numeric(14,2) not null default 0 check (checkout_ticket_target >= 0),   -- ticket médio (R$)
  -- Metas individuais por pessoa (R$): Meta, Super e Diamante
  salao_meta numeric(14,2) not null default 0,
  salao_super numeric(14,2) not null default 0,
  salao_diamante numeric(14,2) not null default 0,
  digital_meta numeric(14,2) not null default 0,
  digital_super numeric(14,2) not null default 0,
  digital_diamante numeric(14,2) not null default 0,
  checkout_meta numeric(14,2) not null default 0,
  checkout_super numeric(14,2) not null default 0,
  checkout_diamante numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  constraint goal_weeks_dates_check check (end_date >= start_date),
  constraint goal_weeks_month_week_key unique (month, week_number)
);

alter table public.goal_weeks enable row level security;

drop policy if exists "authenticated read goal weeks" on public.goal_weeks;
create policy "authenticated read goal weeks" on public.goal_weeks
for select to authenticated using (true);

drop policy if exists "admins manage goal weeks" on public.goal_weeks;
create policy "admins manage goal weeks" on public.goal_weeks
for all to authenticated using (public.is_admin()) with check (public.is_admin());

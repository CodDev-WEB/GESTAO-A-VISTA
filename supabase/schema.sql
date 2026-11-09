-- Gestão à Vista: schema inicial.
-- Execute no SQL Editor do Supabase antes de iniciar o frontend.

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
  revenue numeric(14,2) not null default 0 check (revenue >= 0),
  sales_count integer not null default 0 check (sales_count >= 0),
  source text not null default 'manual',
  import_key text,
  created_at timestamptz not null default now(),
  unique (seller_id, sale_date)
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

create index if not exists sales_daily_date_idx on public.sales_daily(sale_date);
create index if not exists sales_daily_seller_date_idx on public.sales_daily(seller_id, sale_date);
create index if not exists recognitions_date_idx on public.recognitions(recognized_at desc);

-- Foto das colaboradoras (bucket público para leitura no painel).
insert into storage.buckets (id, name, public)
values ('seller-photos', 'seller-photos', true)
on conflict (id) do nothing;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles
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
alter table public.sales_daily enable row level security;
alter table public.recognitions enable row level security;

-- Usuários autenticados ativos podem ler dados do painel.
drop policy if exists "profiles read self or admin" on public.profiles;
create policy "profiles read self or admin" on public.profiles
for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists "admins manage profiles" on public.profiles;
create policy "admins manage profiles" on public.profiles
for all to authenticated using (public.is_admin()) with check (public.is_admin());

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
drop policy if exists "admins manage recognitions" on public.recognitions
for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "authenticated view seller photos" on storage.objects;
create policy "authenticated view seller photos" on storage.objects
for select to authenticated using (bucket_id = 'seller-photos');
drop policy if exists "admins upload seller photos" on storage.objects;
create policy "admins upload seller photos" on storage.objects
for insert to authenticated with check (bucket_id = 'seller-photos' and public.is_admin());
drop policy if exists "admins update seller photos" on storage.objects;
create policy "admins update seller photos" on storage.objects
for update to authenticated using (bucket_id = 'seller-photos' and public.is_admin())
with check (bucket_id = 'seller-photos' and public.is_admin());
drop policy if exists "admins delete seller photos" on storage.objects;
create policy "admins delete seller photos" on storage.objects
for delete to authenticated using (bucket_id = 'seller-photos' and public.is_admin());

-- Cadastre manual ou via Dashboard o primeiro usuário administrador em profiles
-- após criar a conta correspondente em Authentication > Users.

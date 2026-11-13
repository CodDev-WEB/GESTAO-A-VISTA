-- Gestão à Vista: integração com o Santarém Sistemas (Meu ERP Online).
-- Migração incremental e idempotente: não apaga nem recria tabelas existentes.
-- Pode ser executada mais de uma vez.
--
-- Fluxo de dados:
--   API do ERP --(Worker, chave service_role)--> erp_sales_daily (espelho do ERP)
--                                             --> erp_unmatched_sales (funcionários sem vínculo)
--   erp_sales_daily + erp_seller_mappings --(somente com publish_enabled = true)--> sales_daily
--
-- Tokens e chaves NUNCA ficam no banco: ficam nos Secrets do Cloudflare Worker.

-- 1) Configuração e estado da integração (uma linha por fornecedor).
create table if not exists public.erp_integrations (
  id text primary key,
  provider_name text not null,
  company_id integer not null default 1 check (company_id > 0),
  -- Sincronização automática (cron) ligada/desligada.
  enabled boolean not null default false,
  -- Só grava em sales_daily (rankings) quando true. Liberar depois de comparar com o relatório oficial.
  publish_enabled boolean not null default false,
  -- A partir desta data o ERP passa a ser a fonte de sales_daily. Antes dela, as importações manuais ficam intactas.
  publish_from date,
  -- Quantos dias para trás a sincronização diária reprocessa (correções e devoluções).
  reprocess_days integer not null default 7 check (reprocess_days between 1 and 31),
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_status text,
  last_error text,
  -- Trava contra execuções simultâneas.
  lock_until timestamptz,
  lock_owner text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint erp_integrations_publish_from_check check (not publish_enabled or publish_from is not null)
);

insert into public.erp_integrations (id, provider_name, company_id)
values ('santarem', 'Santarém Sistemas (Meu ERP Online)', 1)
on conflict (id) do nothing;

-- 2) Histórico de execuções.
create table if not exists public.erp_sync_logs (
  id uuid primary key default gen_random_uuid(),
  integration_id text not null default 'santarem' references public.erp_integrations(id) on delete cascade,
  trigger text not null check (trigger in ('cron','daily','manual','initial','test','query','mapping')),
  status text not null default 'running' check (status in ('running','success','partial','error','skipped')),
  range_start date,
  range_end date,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  requests integer not null default 0,
  pages integer not null default 0,
  rows_received integer not null default 0,
  rows_staged integer not null default 0,
  rows_unmatched integer not null default 0,
  rows_published integer not null default 0,
  error text,
  details jsonb not null default '{}'::jsonb,
  requested_by uuid
);
create index if not exists erp_sync_logs_started_idx on public.erp_sync_logs(started_at desc);
create index if not exists erp_sync_logs_status_idx on public.erp_sync_logs(status, started_at desc);

-- 3) Vínculo manual: código do funcionário no ERP -> colaboradora.
-- O setor continua sendo o do cadastro da colaboradora; a sincronização nunca altera o setor.
create table if not exists public.erp_seller_mappings (
  id uuid primary key default gen_random_uuid(),
  integration_id text not null default 'santarem' references public.erp_integrations(id) on delete cascade,
  erp_employee_id text not null check (erp_employee_id ~ '^[0-9]+$'),
  erp_employee_name text,
  seller_id uuid not null references public.sellers(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint erp_seller_mappings_employee_key unique (integration_id, erp_employee_id)
);
create index if not exists erp_seller_mappings_seller_idx on public.erp_seller_mappings(seller_id);

-- 4) Dados originais do ERP, por funcionário e dia (valores financeiros preservados).
create table if not exists public.erp_sales_daily (
  id uuid primary key default gen_random_uuid(),
  integration_id text not null default 'santarem' references public.erp_integrations(id) on delete cascade,
  erp_employee_id text not null,
  erp_employee_name text,
  sale_date date not null,
  valtotalbruto numeric(14,2) not null default 0,
  valdescontoliquido numeric(14,2) not null default 0,
  valdescontocashback numeric(14,2) not null default 0,
  valacrescimo numeric(14,2) not null default 0,
  valtotalliquido numeric(14,2) not null default 0,
  valordevolucao numeric(14,2) not null default 0,
  valortotal numeric(14,2) not null default 0,
  quantidade_vendas integer not null default 0 check (quantidade_vendas >= 0),
  valor_medio_venda numeric(14,2) not null default 0,
  seller_id uuid references public.sellers(id) on delete set null,
  published_at timestamptz,
  synced_at timestamptz not null default now(),
  sync_log_id uuid references public.erp_sync_logs(id) on delete set null,
  constraint erp_sales_daily_employee_date_key unique (integration_id, erp_employee_id, sale_date)
);
create index if not exists erp_sales_daily_date_idx on public.erp_sales_daily(sale_date);
create index if not exists erp_sales_daily_seller_date_idx on public.erp_sales_daily(seller_id, sale_date);

-- 5) Registros recebidos sem vínculo (pendências do admin).
create table if not exists public.erp_unmatched_sales (
  id uuid primary key default gen_random_uuid(),
  integration_id text not null default 'santarem' references public.erp_integrations(id) on delete cascade,
  erp_employee_id text not null,
  erp_employee_name text,
  sale_date date not null,
  valortotal numeric(14,2) not null default 0,
  quantidade_vendas integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint erp_unmatched_employee_date_key unique (integration_id, erp_employee_id, sale_date)
);
create index if not exists erp_unmatched_open_idx on public.erp_unmatched_sales(erp_employee_id) where resolved_at is null;

-- 6) Origem de cada registro em sales_daily: 'manual', 'csv' ou 'erp'.
alter table public.sales_daily add column if not exists erp_synced_at timestamptz;
create index if not exists sales_daily_source_date_idx on public.sales_daily(source, sale_date);

-- 7) RLS: todas as tabelas da integração são exclusivas de administradores ativos.
-- O Worker grava com a chave service_role, que ignora RLS e nunca vai para o navegador.
alter table public.erp_integrations enable row level security;
alter table public.erp_sync_logs enable row level security;
alter table public.erp_seller_mappings enable row level security;
alter table public.erp_sales_daily enable row level security;
alter table public.erp_unmatched_sales enable row level security;

drop policy if exists "admins read erp integrations" on public.erp_integrations;
create policy "admins read erp integrations" on public.erp_integrations
for select to authenticated using (public.is_admin());

drop policy if exists "admins read erp sync logs" on public.erp_sync_logs;
create policy "admins read erp sync logs" on public.erp_sync_logs
for select to authenticated using (public.is_admin());

drop policy if exists "admins read erp mappings" on public.erp_seller_mappings;
create policy "admins read erp mappings" on public.erp_seller_mappings
for select to authenticated using (public.is_admin());

drop policy if exists "admins read erp sales" on public.erp_sales_daily;
create policy "admins read erp sales" on public.erp_sales_daily
for select to authenticated using (public.is_admin());

drop policy if exists "admins read erp unmatched" on public.erp_unmatched_sales;
create policy "admins read erp unmatched" on public.erp_unmatched_sales
for select to authenticated using (public.is_admin());

-- Escritas da integração passam pelo Worker (que valida a sessão de admin):
-- nenhuma política de insert/update/delete para usuários autenticados.

-- 8) Horário da última sincronização publicada, para o painel da TV.
-- Só devolve o horário (sem valores) e só quando a publicação está ativa.
create or replace function public.erp_last_sync()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select last_success_at from public.erp_integrations
  where id = 'santarem' and publish_enabled
$$;
revoke all on function public.erp_last_sync() from public;
grant execute on function public.erp_last_sync() to authenticated;

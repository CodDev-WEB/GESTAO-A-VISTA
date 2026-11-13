-- Gestão à Vista: últimas vendas do ERP para o rodapé da TV de valores.
-- Incremental e idempotente.

-- Lista curta (até 5) das vendas mais recentes, gravada pelo Worker a cada sincronização.
alter table public.erp_integrations add column if not exists recent_sales jsonb not null default '[]'::jsonb;
alter table public.erp_integrations add column if not exists recent_sales_at timestamptz;

-- A TV lê só essa lista (nome, valor e horário) e só com a publicação ativa.
create or replace function public.erp_recent_sales()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select recent_sales from public.erp_integrations
                   where id = 'santarem' and publish_enabled), '[]'::jsonb)
$$;
revoke all on function public.erp_recent_sales() from public;
grant execute on function public.erp_recent_sales() to authenticated;

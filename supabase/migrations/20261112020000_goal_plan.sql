-- Gestão à Vista: plano de meta comercial por semana.
-- Cada semana do plano tem datas próprias (ex.: 01 a 08), meta da loja,
-- metas de setor e metas individuais em três níveis (Meta, Super e Diamante).
-- Seguro para executar mais de uma vez em uma instalação existente.

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

-- Plano de Meta Comercial – Novembro 2026
insert into public.goals (month, monthly_target, daily_target, bonus_meta, bonus_super, bonus_diamante, growth_salao, growth_digital, growth_checkout)
values ('2026-11-01', 500000, 16666.67, 70, 140, 250, 7, 5, 25)
on conflict (month) do update set
  monthly_target = excluded.monthly_target,
  bonus_meta = excluded.bonus_meta,
  bonus_super = excluded.bonus_super,
  bonus_diamante = excluded.bonus_diamante,
  growth_salao = excluded.growth_salao,
  growth_digital = excluded.growth_digital,
  growth_checkout = excluded.growth_checkout;

insert into public.goal_weeks (
  month, week_number, start_date, end_date,
  store_target, salao_revenue_target, digital_revenue_target,
  salao_sales_target, digital_conversions_target, checkout_ticket_target,
  salao_meta, salao_super, salao_diamante,
  digital_meta, digital_super, digital_diamante,
  checkout_meta, checkout_super, checkout_diamante
) values
  ('2026-11-01', 1, '2026-11-01', '2026-11-08',  90000,  68000, 22000, 375,  90, 35, 13000, 15000, 17000, 12000, 14000, 16000, 3500, 4000, 4500),
  ('2026-11-01', 2, '2026-11-09', '2026-11-15', 105000,  79000, 26000, 455, 120, 38, 14000, 16000, 18000, 13000, 15000, 17000, 4000, 4500, 5000),
  ('2026-11-01', 3, '2026-11-16', '2026-11-22', 130000,  98000, 32000, 565, 150, 42, 17000, 19000, 21000, 16000, 18000, 20000, 4500, 5000, 5500),
  ('2026-11-01', 4, '2026-11-23', '2026-11-30', 175000, 132000, 43000, 790, 205, 45, 22000, 24000, 26000, 21000, 23000, 25000, 5000, 5500, 6000)
on conflict (month, week_number) do nothing;

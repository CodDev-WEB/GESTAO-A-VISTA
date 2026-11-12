-- Gestão à Vista: metas semanais por setor e vínculo de colaboradoras.
-- Seguro para executar em uma instalação que já possui o schema anterior.

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

alter table public.sector_goals enable row level security;

drop policy if exists "authenticated read sector goals" on public.sector_goals;
create policy "authenticated read sector goals" on public.sector_goals
for select to authenticated using (true);

drop policy if exists "admins manage sector goals" on public.sector_goals;
create policy "admins manage sector goals" on public.sector_goals
for all to authenticated using (public.is_admin()) with check (public.is_admin());

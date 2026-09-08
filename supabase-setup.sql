-- Weeknight V1 database setup
-- Run this once in Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  cuisine text default '',
  prep_minutes integer default 0,
  cook_minutes integer default 0,
  difficulty text default 'Easy',
  favorite boolean default false,
  rating text default '',
  is_new boolean default false,
  tags text[] default '{}',
  ingredients jsonb not null default '[]'::jsonb,
  steps jsonb not null default '[]'::jsonb,
  source_url text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.weekly_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  meal_date date not null,
  type text not null check (type in ('meal', 'leftover', 'eatout')),
  recipe_id uuid references public.recipes(id) on delete set null,
  label text default '',
  created_at timestamptz not null default now(),
  unique (user_id, meal_date)
);

create table if not exists public.grocery_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  name text not null,
  amount text default '',
  category text default 'Other',
  checked boolean default false,
  manual boolean default false,
  created_at timestamptz not null default now()
);

alter table public.recipes enable row level security;
alter table public.weekly_meals enable row level security;
alter table public.grocery_items enable row level security;

-- A single shared login can be used on both phones. Each signed-in account only sees its own data.
drop policy if exists "recipes_owner_all" on public.recipes;
create policy "recipes_owner_all" on public.recipes
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "meals_owner_all" on public.weekly_meals;
create policy "meals_owner_all" on public.weekly_meals
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "groceries_owner_all" on public.grocery_items;
create policy "groceries_owner_all" on public.grocery_items
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.recipes to authenticated;
grant select, insert, update, delete on public.weekly_meals to authenticated;
grant select, insert, update, delete on public.grocery_items to authenticated;

-- Optional live sync between phones. Safe to ignore duplicate-publication notices if rerun.
do $$
begin
  begin alter publication supabase_realtime add table public.recipes; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.weekly_meals; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.grocery_items; exception when duplicate_object then null; end;
end $$;

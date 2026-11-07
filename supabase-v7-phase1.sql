-- Mealz V7, Phase 1: households and separate logins
-- Run this once in Supabase > SQL Editor before deploying the Phase 1 app files.
-- Safe to run more than once.
--
-- What it does:
--   1. Creates a household and puts the existing Mealz account in it as Greg.
--   2. Invites stephanie.strecker@gmail.com. When she creates her account and
--      signs in, she joins the household automatically.
--   3. Moves every recipe, meal and grocery row to the household, so both
--      logins see and edit the same data.
--   4. Records who last changed each row (updated_by).

create extension if not exists pgcrypto;

-- 1. Tables -----------------------------------------------------------------

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Home',
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text not null default '',
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.household_invites (
  email text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

-- 2. Helper functions --------------------------------------------------------

create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id from public.household_members where user_id = auth.uid() limit 1;
$$;

create or replace function public.claim_household_invite()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
  my_email text;
  inv public.household_invites%rowtype;
begin
  if auth.uid() is null then
    return null;
  end if;

  select household_id into hid from public.household_members where user_id = auth.uid();
  if hid is not null then
    return hid;
  end if;

  select lower(email) into my_email from auth.users where id = auth.uid();
  select * into inv from public.household_invites where lower(email) = my_email;
  if not found then
    return null;
  end if;

  insert into public.household_members (household_id, user_id, display_name, email)
  values (inv.household_id, auth.uid(), inv.display_name, my_email);

  delete from public.household_invites where lower(email) = my_email;
  return inv.household_id;
end;
$$;

revoke all on function public.claim_household_invite() from public;
grant execute on function public.current_household_id() to authenticated;
grant execute on function public.claim_household_invite() to authenticated;

-- 3. Create the household from the existing account ------------------------

do $$
declare
  owner_count integer;
  owner_id uuid;
  owner_email text;
  hid uuid;
begin
  if exists (select 1 from public.household_members) then
    raise notice 'Household already set up; skipping creation.';
    return;
  end if;

  select count(distinct user_id) into owner_count from (
    select user_id from public.recipes
    union select user_id from public.weekly_meals
    union select user_id from public.grocery_items
  ) owners;

  if owner_count > 1 then
    raise exception 'Found % accounts that own Mealz data. Expected one shared login. Stopping so nothing is merged by mistake.', owner_count;
  end if;

  select user_id into owner_id from (
    select user_id from public.recipes
    union select user_id from public.weekly_meals
    union select user_id from public.grocery_items
  ) owners limit 1;

  if owner_id is null then
    -- No data yet: use the oldest account instead.
    select id into owner_id from auth.users order by created_at limit 1;
  end if;

  if owner_id is null then
    raise exception 'No Mealz account found. Sign in to Mealz once, then run this again.';
  end if;

  select email into owner_email from auth.users where id = owner_id;

  insert into public.households (name) values ('Zirkle household') returning id into hid;

  insert into public.household_members (household_id, user_id, display_name, email)
  values (hid, owner_id, 'Greg', coalesce(owner_email, ''));

  insert into public.household_invites (email, household_id, display_name)
  values ('stephanie.strecker@gmail.com', hid, 'Stephanie')
  on conflict (email) do nothing;
end $$;

-- 4. Move data to the household ----------------------------------------------

alter table public.recipes add column if not exists household_id uuid references public.households(id) on delete cascade;
alter table public.weekly_meals add column if not exists household_id uuid references public.households(id) on delete cascade;
alter table public.grocery_items add column if not exists household_id uuid references public.households(id) on delete cascade;

alter table public.recipes add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.weekly_meals add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.grocery_items add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table public.recipes add column if not exists updated_at timestamptz not null default now();
alter table public.weekly_meals add column if not exists updated_at timestamptz not null default now();
alter table public.grocery_items add column if not exists updated_at timestamptz not null default now();

update public.recipes t set household_id = m.household_id
  from public.household_members m where t.household_id is null and m.user_id = t.user_id;
update public.weekly_meals t set household_id = m.household_id
  from public.household_members m where t.household_id is null and m.user_id = t.user_id;
update public.grocery_items t set household_id = m.household_id
  from public.household_members m where t.household_id is null and m.user_id = t.user_id;

update public.recipes set updated_by = user_id where updated_by is null;
update public.weekly_meals set updated_by = user_id where updated_by is null;
update public.grocery_items set updated_by = user_id where updated_by is null;

alter table public.recipes alter column household_id set default public.current_household_id();
alter table public.weekly_meals alter column household_id set default public.current_household_id();
alter table public.grocery_items alter column household_id set default public.current_household_id();

alter table public.recipes alter column household_id set not null;
alter table public.weekly_meals alter column household_id set not null;
alter table public.grocery_items alter column household_id set not null;

alter table public.recipes alter column user_id set default auth.uid();
alter table public.weekly_meals alter column user_id set default auth.uid();
alter table public.grocery_items alter column user_id set default auth.uid();

alter table public.recipes alter column updated_by set default auth.uid();
alter table public.weekly_meals alter column updated_by set default auth.uid();
alter table public.grocery_items alter column updated_by set default auth.uid();

-- One plan per day per household, instead of per login.
alter table public.weekly_meals drop constraint if exists weekly_meals_user_id_meal_date_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'weekly_meals_household_date_key') then
    alter table public.weekly_meals add constraint weekly_meals_household_date_key unique (household_id, meal_date);
  end if;
end $$;

create index if not exists recipes_household_idx on public.recipes (household_id);
create index if not exists grocery_items_household_week_idx on public.grocery_items (household_id, week_start);

-- 5. Stamp who changed what --------------------------------------------------

create or replace function public.stamp_updated()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists recipes_stamp on public.recipes;
create trigger recipes_stamp before insert or update on public.recipes
  for each row execute function public.stamp_updated();
drop trigger if exists weekly_meals_stamp on public.weekly_meals;
create trigger weekly_meals_stamp before insert or update on public.weekly_meals
  for each row execute function public.stamp_updated();
drop trigger if exists grocery_items_stamp on public.grocery_items;
create trigger grocery_items_stamp before insert or update on public.grocery_items
  for each row execute function public.stamp_updated();

-- 6. Row level security: household members share everything ----------------

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;

drop policy if exists "households_member_read" on public.households;
create policy "households_member_read" on public.households
  for select to authenticated using (id = public.current_household_id());

drop policy if exists "members_household_read" on public.household_members;
create policy "members_household_read" on public.household_members
  for select to authenticated using (household_id = public.current_household_id());

drop policy if exists "members_update_self" on public.household_members;
create policy "members_update_self" on public.household_members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Invites are only touched by claim_household_invite(); no direct access.

drop policy if exists "recipes_owner_all" on public.recipes;
drop policy if exists "recipes_household_all" on public.recipes;
create policy "recipes_household_all" on public.recipes
  for all to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

drop policy if exists "meals_owner_all" on public.weekly_meals;
drop policy if exists "meals_household_all" on public.weekly_meals;
create policy "meals_household_all" on public.weekly_meals
  for all to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

drop policy if exists "groceries_owner_all" on public.grocery_items;
drop policy if exists "groceries_household_all" on public.grocery_items;
create policy "groceries_household_all" on public.grocery_items
  for all to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

grant select on public.households to authenticated;
grant select, update on public.household_members to authenticated;

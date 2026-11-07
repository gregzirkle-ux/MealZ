-- Mealz V7, Phase 2: structured recipes, servings and leftovers
-- Run this once in Supabase > SQL Editor before deploying the Phase 2 app files.
-- Safe to run more than once. It only adds tables and columns. Nothing is dropped,
-- and the original recipes.ingredients text stays as a backup.
--
-- What it does:
--   1. Recipes get servings (the recipe's own yield), course, and conversion tracking.
--   2. New table recipe_ingredients holds each ingredient line split into
--      amount, unit, item, prep note and category. The app fills it in.
--   3. Meals get servings (total to cook), leftover_days, and source_meal_id,
--      which links a Leftovers Night to the night it was cooked.
--   4. Grocery items get a measure column so amounts can be shown in each
--      person's preferred units.
--   5. Each household member gets a prefs column for their unit setting.
--   6. Existing data: servings are read from the "Serves: N" Recipe Keeper tag,
--      and existing Leftovers Nights are linked to the cook night before them.

-- 1. Recipes -----------------------------------------------------------------

alter table public.recipes add column if not exists servings integer;
alter table public.recipes add column if not exists servings_estimated boolean not null default false;
alter table public.recipes add column if not exists course text;
alter table public.recipes add column if not exists ingredients_hash text;
alter table public.recipes add column if not exists needs_review boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recipes_servings_check') then
    alter table public.recipes add constraint recipes_servings_check check (servings is null or servings between 1 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recipes_course_check') then
    alter table public.recipes add constraint recipes_course_check check (course is null or course in ('entree', 'side', 'app', 'dessert'));
  end if;
end $$;

-- Recipe Keeper imports carry the yield as a tag like "Serves: 4" or "Serves: 6-8".
-- Take the first number. Only fills recipes that have no servings yet.
update public.recipes r
set servings = least(200, greatest(1, s.n))
from (
  select id, (regexp_match(t, '^Serves:\s*(\d+)', 'i'))[1]::integer as n
  from public.recipes, unnest(tags) as t
  where t ~* '^Serves:\s*\d+'
) s
where r.id = s.id and r.servings is null and s.n is not null;

-- 2. Structured ingredient lines ----------------------------------------------

create table if not exists public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  household_id uuid not null default public.current_household_id() references public.households(id) on delete cascade,
  position integer not null default 0,
  raw text not null default '',
  qty numeric,
  unit text not null default '',
  item text not null default '',
  prep text not null default '',
  category text not null default 'Other',
  unsure boolean not null default false,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- One row per line. If both phones convert the same recipe at once, the second
-- save fails instead of doubling the lines.
create unique index if not exists recipe_ingredients_recipe_position_key on public.recipe_ingredients (recipe_id, position);
create index if not exists recipe_ingredients_household_idx on public.recipe_ingredients (household_id);

drop trigger if exists recipe_ingredients_stamp on public.recipe_ingredients;
create trigger recipe_ingredients_stamp before insert or update on public.recipe_ingredients
  for each row execute function public.stamp_updated();

alter table public.recipe_ingredients enable row level security;

drop policy if exists "recipe_ingredients_household_all" on public.recipe_ingredients;
create policy "recipe_ingredients_household_all" on public.recipe_ingredients
  for all to authenticated
  using (household_id = public.current_household_id())
  with check (
    household_id = public.current_household_id()
    and exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.household_id = public.current_household_id()
    )
  );

grant select, insert, update, delete on public.recipe_ingredients to authenticated;

-- 3. Meals: servings and linked Leftovers Nights --------------------------------

alter table public.weekly_meals add column if not exists servings integer;
alter table public.weekly_meals add column if not exists leftover_days integer not null default 0;
alter table public.weekly_meals add column if not exists source_meal_id uuid references public.weekly_meals(id) on delete cascade;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'weekly_meals_servings_check') then
    alter table public.weekly_meals add constraint weekly_meals_servings_check check (servings is null or servings between 1 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'weekly_meals_leftover_days_check') then
    alter table public.weekly_meals add constraint weekly_meals_leftover_days_check check (leftover_days between 0 and 3);
  end if;
end $$;

create index if not exists weekly_meals_source_idx on public.weekly_meals (source_meal_id);

-- Link each existing Leftovers Night to the closest cook night of the same
-- recipe within the 3 days before it. Unlinked rows are left alone.
update public.weekly_meals l
set source_meal_id = (
  select m.id from public.weekly_meals m
  where m.household_id = l.household_id
    and m.type = 'meal'
    and m.recipe_id = l.recipe_id
    and m.meal_date < l.meal_date
    and m.meal_date >= l.meal_date - 3
  order by m.meal_date desc
  limit 1
)
where l.type = 'leftover' and l.source_meal_id is null and l.recipe_id is not null;

update public.weekly_meals m
set leftover_days = least(3, c.n)
from (
  select source_meal_id, count(*)::integer as n
  from public.weekly_meals
  where source_meal_id is not null
  group by source_meal_id
) c
where m.id = c.source_meal_id and m.leftover_days <> least(3, c.n);

-- 4. Grocery items: structured amount -----------------------------------------

alter table public.grocery_items add column if not exists measure jsonb;

-- 5. Unit setting for each person ---------------------------------------------

alter table public.household_members add column if not exists prefs jsonb not null default '{}'::jsonb;

-- 6. Live sync between phones ---------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.recipe_ingredients; exception when duplicate_object then null; end;
  end if;
end $$;

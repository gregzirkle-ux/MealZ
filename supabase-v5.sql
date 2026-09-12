-- Mealz V5 database update
-- Run this once in Supabase > SQL Editor before deploying V5.
-- It is safe to run more than once.

alter table public.weekly_meals
  add column if not exists notes text default '';

-- Existing rows get an empty note rather than a null value.
update public.weekly_meals set notes = '' where notes is null;

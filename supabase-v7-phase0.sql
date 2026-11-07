-- Mealz V7, Phase 0: keep alive table
-- Run this once in Supabase > SQL Editor before deploying.
-- Safe to run more than once.

create table if not exists public.keep_alive (
  id integer primary key,
  label text not null default 'mealz',
  created_at timestamptz not null default now()
);

insert into public.keep_alive (id, label)
values (1, 'mealz')
on conflict (id) do nothing;

alter table public.keep_alive enable row level security;

-- The daily ping reads this one row with the public key. It holds no household data.
drop policy if exists "keep_alive_read" on public.keep_alive;
create policy "keep_alive_read" on public.keep_alive
  for select to anon, authenticated
  using (true);

grant select on public.keep_alive to anon, authenticated;

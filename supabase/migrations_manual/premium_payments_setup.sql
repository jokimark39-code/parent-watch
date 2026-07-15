-- Run this in your external Supabase SQL editor.
-- Adds Premium gating for Telegram Alerts (demo flow).

-- 1. profiles: ensure premium columns exist
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  notifications_enabled boolean default true,
  is_premium boolean default false,
  premium_plan text default 'free',
  premium_activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists is_premium boolean default false;
alter table public.profiles add column if not exists premium_plan text default 'free';
alter table public.profiles add column if not exists premium_activated_at timestamptz;

alter table public.profiles enable row level security;

drop policy if exists "profiles self select" on public.profiles;
create policy "profiles self select" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "profiles self insert" on public.profiles;
create policy "profiles self insert" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- 2. premium_payments table
create table if not exists public.premium_payments (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references auth.users(id) on delete cascade,
  email text,
  payment_method text,
  screenshot_url text,
  status text default 'approved',
  amount integer default 0,
  created_at timestamptz not null default now()
);

alter table public.premium_payments enable row level security;

drop policy if exists "pp self select" on public.premium_payments;
create policy "pp self select" on public.premium_payments
  for select to authenticated using (auth.uid() = parent_id);

drop policy if exists "pp self insert" on public.premium_payments;
create policy "pp self insert" on public.premium_payments
  for insert to authenticated with check (auth.uid() = parent_id);

-- 3. Storage bucket for payment screenshots
insert into storage.buckets (id, name, public)
values ('payment-screenshots', 'payment-screenshots', true)
on conflict (id) do nothing;

drop policy if exists "pp screenshots read" on storage.objects;
create policy "pp screenshots read" on storage.objects
  for select using (bucket_id = 'payment-screenshots');

drop policy if exists "pp screenshots upload" on storage.objects;
create policy "pp screenshots upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

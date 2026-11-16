create extension if not exists pgcrypto;

create table if not exists public.market_view_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  model text,
  source text not null default 'live',
  title text not null default 'Market View Snapshot',
  subtitle text not null default now()::text,
  report text not null,
  normalized jsonb,
  local_run_snapshot_id text
);

create index if not exists market_view_snapshots_created_at_idx
  on public.market_view_snapshots (created_at desc);

create table if not exists public.market_view_positions (
  id bigint generated always as identity primary key,
  snapshot_id uuid not null references public.market_view_snapshots(id) on delete cascade,
  trader text not null,
  source text not null,
  symbol text not null,
  side text not null,
  size_text text,
  size_numeric numeric,
  position_value_usd numeric,
  entry_text text,
  unrealized_pnl_text text,
  leverage text,
  category text,
  created_at timestamptz not null default now()
);

create index if not exists market_view_positions_snapshot_id_idx
  on public.market_view_positions (snapshot_id);

create index if not exists market_view_positions_lookup_idx
  on public.market_view_positions (trader, source, symbol, side);

alter table public.market_view_snapshots enable row level security;
alter table public.market_view_positions enable row level security;

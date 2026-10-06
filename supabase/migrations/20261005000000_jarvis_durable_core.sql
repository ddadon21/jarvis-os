-- JARVIS durable core: trading lifecycle, learning data, events, device command queue.
-- Apply in Supabase SQL editor (or `supabase db push`). Safe to re-run.
-- Assumes existing tables: jarvis_workspaces(id uuid), jarvis_workspace_members(workspace_id, user_id),
-- and the hardened jarvis_private.is_workspace_member(uuid) helper from the persistence foundation.

-- ---------------------------------------------------------------------------
-- Runtime events (replaces the 100-item cache list as the system of record)
-- ---------------------------------------------------------------------------
create table if not exists public.jarvis_runtime_events (
  id text primary key,
  workspace_id uuid not null references public.jarvis_workspaces(id) on delete cascade,
  type text not null,
  domain text not null,
  source text not null,
  importance text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  summary text not null,
  created_at timestamptz not null default now()
);
create index if not exists jarvis_runtime_events_ws_time on public.jarvis_runtime_events (workspace_id, occurred_at desc);
create index if not exists jarvis_runtime_events_ws_type on public.jarvis_runtime_events (workspace_id, type, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Trading: one row per observed trade, append-only lifecycle events
-- ---------------------------------------------------------------------------
create table if not exists public.trading_trades (
  id text primary key,
  workspace_id uuid not null references public.jarvis_workspaces(id) on delete cascade,
  symbol text not null,
  side text not null check (side in ('LONG','SHORT')),
  quantity numeric not null default 0,
  max_quantity numeric,
  status text not null check (status in ('OPEN','CLOSED')),
  entry_price numeric,
  exit_price numeric,
  initial_stop numeric,
  initial_target numeric,
  stop_price numeric,
  target_price numeric,
  opened_at timestamptz not null,
  closed_at timestamptz,
  session_day date not null,
  realized_pnl numeric,
  pnl_source text,               -- 'BROKER' | 'ESTIMATED' | null
  mfe_price numeric,             -- best price reached while open
  mae_price numeric,             -- worst price reached while open
  prepared_at timestamptz,       -- first time the order was seen being prepared
  source text not null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists trading_trades_ws_opened on public.trading_trades (workspace_id, opened_at desc);
create index if not exists trading_trades_ws_day on public.trading_trades (workspace_id, session_day);

create table if not exists public.trading_trade_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.jarvis_workspaces(id) on delete cascade,
  trade_id text,
  type text not null,            -- PREPARING | ORDER_WORKING | ORDER_CANCELLED | ENTRY | STOP_MOVED | TARGET_MOVED | SIZE_CHANGED | EXIT
  at timestamptz not null,
  symbol text,
  side text,
  quantity numeric,
  price numeric,
  stop_price numeric,
  target_price numeric,
  open_pnl numeric,
  confidence numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists trading_trade_events_ws_time on public.trading_trade_events (workspace_id, at desc);
create index if not exists trading_trade_events_trade on public.trading_trade_events (trade_id, at);

-- Read by /api/trading/indicator-learning; now actually written by the observer pipeline.
create table if not exists public.trading_observer_snapshots (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.jarvis_workspaces(id) on delete cascade,
  observed_at timestamptz not null,
  connection text,
  status text,
  intent_state text,
  symbol text,
  side text,
  quantity numeric,
  order_type text,
  entry_price numeric,
  current_price numeric,
  stop_price numeric,
  target_price numeric,
  open_pnl numeric,
  confidence numeric,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Learning data: market bars (TradingView webhook feed), model versions, shadow signals
-- ---------------------------------------------------------------------------
create table if not exists public.trading_bars (
  workspace_id uuid not null references public.jarvis_workspaces(id) on delete cascade,
  symbol text not null,
  timeframe text not null,       -- '1', '5', '60', '240', 'D'
  ts timestamptz not null,       -- bar open time (UTC)
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric,
  source text not null default 'tradingview-webhook',
  primary key (workspace_id, symbol, timeframe, ts)
);

create table if not exists public.trading_model_versions (
  id text primary key,
  workspace_id uuid not null references public.jarvis_workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'CANDIDATE' check (status in ('CANDIDATE','SHADOW','PROMOTED','REJECTED')),
  base_version text,
  metrics jsonb not null default '{}'::jsonb,
  rules jsonb not null default '{}'::jsonb,
  pine text,
  notes text
);

create table if not exists public.trading_signals (
  id text primary key,
  workspace_id uuid not null references public.jarvis_workspaces(id) on delete cascade,
  model_version text not null,
  symbol text not null,
  side text not null check (side in ('LONG','SHORT')),
  ts timestamptz not null,
  price numeric,
  stop_price numeric,
  target_price numeric,
  source text not null,          -- 'tradingview-alert' | 'jarvis-replay'
  status text not null default 'SHADOW' check (status in ('SHADOW','MATCHED','UNMATCHED')),
  matched_trade_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists trading_signals_ws_time on public.trading_signals (workspace_id, ts desc);

-- ---------------------------------------------------------------------------
-- Local Agent: durable pairing + command queue (fixes dropped / double-run commands)
-- ---------------------------------------------------------------------------
create table if not exists public.jarvis_devices (
  device_id text primary key,
  workspace_id uuid not null references public.jarvis_workspaces(id) on delete cascade,
  device_name text not null,
  device_token_hash text not null,
  controller_token_hash text,
  paired_at timestamptz not null default now(),
  last_heartbeat_at timestamptz,
  last_frame_at timestamptz,
  command text not null default 'PAUSE',
  observer_version text,
  capabilities jsonb not null default '[]'::jsonb,
  revoked_at timestamptz
);

create table if not exists public.jarvis_device_commands (
  id text primary key,
  workspace_id uuid not null references public.jarvis_workspaces(id) on delete cascade,
  device_id text not null references public.jarvis_devices(device_id) on delete cascade,
  kind text not null check (kind in ('DESKTOP','OBSIDIAN')),
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  authorization_level text not null default 'READ_ONLY',
  approval_id text,
  status text not null default 'PENDING' check (status in ('PENDING','CLAIMED','DONE','FAILED','EXPIRED')),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  result jsonb
);
create index if not exists jarvis_device_commands_queue on public.jarvis_device_commands (device_id, kind, status, created_at);

-- Approvals recorded by the server (not self-asserted by a request body).
create table if not exists public.jarvis_approvals (
  id text primary key,
  workspace_id uuid not null references public.jarvis_workspaces(id) on delete cascade,
  subject_type text not null,    -- 'WORKFORCE_TASK' | 'DESKTOP_ACTION'
  subject_id text not null,
  decision text not null check (decision in ('APPROVED','DENIED')),
  decided_by text not null,
  reason text,
  decided_at timestamptz not null default now()
);
create index if not exists jarvis_approvals_subject on public.jarvis_approvals (subject_type, subject_id);

-- ---------------------------------------------------------------------------
-- Server-side long-term memory for Jarvis chat
-- ---------------------------------------------------------------------------
create table if not exists public.jarvis_memory_facts (
  id text primary key,
  workspace_id uuid not null references public.jarvis_workspaces(id) on delete cascade,
  domain text not null,
  fact text not null,
  source text not null default 'chat',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  archived boolean not null default false
);
create index if not exists jarvis_memory_facts_ws on public.jarvis_memory_facts (workspace_id, archived, created_at desc);
create index if not exists jarvis_memory_facts_fts on public.jarvis_memory_facts using gin (to_tsvector('english', fact));

-- Obsidian vault index uploaded by the Local Agent (folders Dwight allows).
create table if not exists public.jarvis_vault_notes (
  workspace_id uuid not null references public.jarvis_workspaces(id) on delete cascade,
  path text not null,
  title text not null,
  content text not null,
  modified_at timestamptz,
  indexed_at timestamptz not null default now(),
  primary key (workspace_id, path)
);
create index if not exists jarvis_vault_notes_fts on public.jarvis_vault_notes using gin (to_tsvector('english', title || ' ' || content));

-- ---------------------------------------------------------------------------
-- Row level security: members can read their workspace; the server writes with the service role.
-- Explicit statements are used here so the migration is portable through hosted migration runners.
-- ---------------------------------------------------------------------------
alter table public.jarvis_runtime_events enable row level security;
drop policy if exists jarvis_runtime_events_member_read on public.jarvis_runtime_events;
create policy jarvis_runtime_events_member_read on public.jarvis_runtime_events for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

alter table public.trading_trades enable row level security;
drop policy if exists trading_trades_member_read on public.trading_trades;
create policy trading_trades_member_read on public.trading_trades for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

alter table public.trading_trade_events enable row level security;
drop policy if exists trading_trade_events_member_read on public.trading_trade_events;
create policy trading_trade_events_member_read on public.trading_trade_events for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

alter table public.trading_bars enable row level security;
drop policy if exists trading_bars_member_read on public.trading_bars;
create policy trading_bars_member_read on public.trading_bars for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

alter table public.trading_model_versions enable row level security;
drop policy if exists trading_model_versions_member_read on public.trading_model_versions;
create policy trading_model_versions_member_read on public.trading_model_versions for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

alter table public.trading_signals enable row level security;
drop policy if exists trading_signals_member_read on public.trading_signals;
create policy trading_signals_member_read on public.trading_signals for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

alter table public.jarvis_devices enable row level security;
drop policy if exists jarvis_devices_member_read on public.jarvis_devices;
create policy jarvis_devices_member_read on public.jarvis_devices for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

alter table public.jarvis_device_commands enable row level security;
drop policy if exists jarvis_device_commands_member_read on public.jarvis_device_commands;
create policy jarvis_device_commands_member_read on public.jarvis_device_commands for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

alter table public.jarvis_approvals enable row level security;
drop policy if exists jarvis_approvals_member_read on public.jarvis_approvals;
create policy jarvis_approvals_member_read on public.jarvis_approvals for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

alter table public.jarvis_memory_facts enable row level security;
drop policy if exists jarvis_memory_facts_member_read on public.jarvis_memory_facts;
create policy jarvis_memory_facts_member_read on public.jarvis_memory_facts for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

alter table public.jarvis_vault_notes enable row level security;
drop policy if exists jarvis_vault_notes_member_read on public.jarvis_vault_notes;
create policy jarvis_vault_notes_member_read on public.jarvis_vault_notes for select to authenticated using (jarvis_private.is_workspace_member(workspace_id));

-- Explicit Data API privileges. RLS still controls authenticated rows; the
-- service role is used only by trusted server-side JARVIS code.
grant select on table
  public.jarvis_runtime_events,
  public.trading_trades,
  public.trading_trade_events,
  public.trading_observer_snapshots,
  public.trading_bars,
  public.trading_model_versions,
  public.trading_signals,
  public.jarvis_devices,
  public.jarvis_device_commands,
  public.jarvis_approvals,
  public.jarvis_memory_facts,
  public.jarvis_vault_notes
to authenticated;

grant all privileges on table
  public.jarvis_runtime_events,
  public.trading_trades,
  public.trading_trade_events,
  public.trading_observer_snapshots,
  public.trading_bars,
  public.trading_model_versions,
  public.trading_signals,
  public.jarvis_devices,
  public.jarvis_device_commands,
  public.jarvis_approvals,
  public.jarvis_memory_facts,
  public.jarvis_vault_notes
to service_role;

grant usage, select on sequence public.trading_trade_events_id_seq to service_role;

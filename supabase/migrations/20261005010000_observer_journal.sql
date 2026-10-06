-- Observer local journal sync: idempotent client event ids and trade source tracking.
alter table public.trading_trade_events add column if not exists client_event_id text;
create unique index if not exists trading_trade_events_client_event on public.trading_trade_events (client_event_id) where client_event_id is not null;
alter table public.trading_trades add column if not exists frame_count integer not null default 0;

-- Key frames uploaded by the Observer for each trade (stored in the jarvis-attachments bucket).
create table if not exists public.trading_trade_frames (
  workspace_id uuid not null references public.jarvis_workspaces(id) on delete cascade,
  trade_id text not null,
  captured_at timestamptz not null,
  object_path text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, trade_id, captured_at)
);
alter table public.trading_trade_frames enable row level security;
drop policy if exists trading_trade_frames_member_read on public.trading_trade_frames;
create policy trading_trade_frames_member_read on public.trading_trade_frames for select using (jarvis_private.is_workspace_member(workspace_id));

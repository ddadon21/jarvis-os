-- =============================================================================
-- JARVIS CORE v0.1 — core schema
--
-- Scope: Jarvis Core only. Trading, Finance and SentryOps domain tables are
-- specified in docs/DATABASE.md and are deliberately NOT created here. Those
-- schemas should be written against a real data feed, not guessed at before
-- one exists — a trades table designed in the abstract will be wrong in ways
-- that are expensive to discover after a year of rows.
--
-- Conventions used throughout:
--   * every user-owned table has `user_id uuid not null references auth.users`
--   * timestamps are `timestamptz`, always UTC
--   * money is `bigint` in minor units (cents), never numeric/float dollars
--   * enums are Postgres types so the database rejects nonsense, not just the app
-- =============================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- Enumerations. These mirror src/core/types.ts; the two must be changed together.
-- --------------------------------------------------------------------------
create type jarvis_domain as enum ('trading', 'finance', 'sentryops', 'life', 'core');
create type jarvis_importance as enum ('trivial', 'low', 'normal', 'high', 'critical');
create type jarvis_readiness as enum ('red', 'yellow', 'green');
create type jarvis_horizon as enum ('now', 'next', 'today', 'this_week', 'longer_term');
create type jarvis_action_level as enum ('observe', 'recommend', 'prepare', 'execute');
create type jarvis_evidence_kind as enum (
  'public_verified', 'user_observation', 'inferred', 'unverified_report'
);

create type jarvis_goal_status as enum ('active', 'achieved', 'paused', 'abandoned');
create type jarvis_criterion_unit as enum ('currency', 'percent', 'count', 'months', 'ratio', 'boolean');
create type jarvis_criterion_direction as enum ('at_least', 'at_most');

create type jarvis_task_status as enum ('open', 'in_progress', 'blocked', 'done', 'cancelled');
create type jarvis_processing_status as enum ('pending', 'processing', 'processed', 'failed', 'ignored');
create type jarvis_approval_status as enum (
  'pending', 'approved', 'denied', 'expired', 'executed', 'failed'
);
create type jarvis_memory_class as enum ('working', 'domain', 'episodic', 'document');
create type jarvis_notification_urgency as enum (
  'background', 'normal', 'important', 'time_sensitive', 'critical'
);
create type jarvis_notification_channel as enum ('in_app', 'push', 'email', 'sms', 'voice');
create type jarvis_notification_status as enum ('pending', 'sent', 'read', 'dismissed', 'failed');
create type jarvis_actor_type as enum ('user', 'agent', 'system', 'integration');
create type jarvis_audit_outcome as enum ('allowed', 'denied', 'succeeded', 'failed');
create type jarvis_agent_run_status as enum ('idle', 'running', 'succeeded', 'failed', 'disabled');

-- --------------------------------------------------------------------------
-- updated_at maintenance
-- --------------------------------------------------------------------------
create or replace function jarvis_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- profiles — one row per auth user
-- --------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  timezone text not null default 'UTC',
  -- Free-form preferences. Anything that needs querying or validating earns a
  -- column; this is for genuinely open-ended settings only.
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on profiles
  for each row execute function jarvis_set_updated_at();

-- --------------------------------------------------------------------------
-- goals / goal_criteria / goal_criterion_readings
--
-- Readiness is NOT stored. It is computed from criteria on read
-- (src/core/goals/readiness.ts) because criterion values move for reasons no
-- single write path controls, and a cached verdict would be stale more often
-- than it was right.
-- --------------------------------------------------------------------------
create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain jarvis_domain not null,
  slug text not null,
  title text not null,
  description text,
  status jarvis_goal_status not null default 'active',
  target_date date,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_slug_per_user unique (user_id, slug),
  constraint goals_slug_format check (slug ~ '^[a-z0-9_]{2,64}$')
);

create index goals_user_status_idx on goals (user_id, status, display_order);

create trigger goals_updated_at
  before update on goals
  for each row execute function jarvis_set_updated_at();

create table goal_criteria (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null references goals (id) on delete cascade,
  key text not null,
  label text not null,
  description text,
  unit jarvis_criterion_unit not null,
  direction jarvis_criterion_direction not null,
  green_threshold double precision not null,
  yellow_threshold double precision not null,
  -- Starting point for at_most criteria whose target is 0 (debt payoff).
  -- Without it, "how far along am I?" has no defined answer.
  baseline_value double precision,
  current_value double precision not null default 0,
  -- A blocking criterion vetoes the goal: red here means the goal is red.
  blocking boolean not null default false,
  weight double precision not null default 1,
  last_measured_at timestamptz,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_criteria_key_per_goal unique (goal_id, key),
  constraint goal_criteria_weight_positive check (weight >= 0),
  -- The yellow threshold must sit between red and green in the direction of
  -- improvement, or the three-state rollup is meaningless.
  constraint goal_criteria_threshold_order check (
    (direction = 'at_least' and yellow_threshold <= green_threshold)
    or (direction = 'at_most' and yellow_threshold >= green_threshold)
  )
);

create index goal_criteria_goal_idx on goal_criteria (goal_id);

create trigger goal_criteria_updated_at
  before update on goal_criteria
  for each row execute function jarvis_set_updated_at();

-- Append-only measurement history. The series behind every readiness meter.
create table goal_criterion_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  criterion_id uuid not null references goal_criteria (id) on delete cascade,
  value double precision not null,
  recorded_at timestamptz not null default now(),
  source text not null default 'manual',
  note text
);

create index goal_criterion_readings_criterion_idx
  on goal_criterion_readings (criterion_id, recorded_at desc);

-- --------------------------------------------------------------------------
-- tasks
--
-- Note the absence of a `priority` column. Ranking is the Next Move Engine's
-- job and is computed from many factors; a hand-set priority field would
-- compete with it and always win, because it is easier to set.
-- --------------------------------------------------------------------------
create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain jarvis_domain not null,
  title text not null,
  detail text,
  status jarvis_task_status not null default 'open',
  goal_id uuid references goals (id) on delete set null,
  due_at timestamptz,
  estimated_minutes integer,
  -- Scoring inputs supplied by the owning domain. Shape: MoveFactors.
  move_factors jsonb not null default '{}'::jsonb,
  depends_on uuid[] not null default '{}',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_user_status_idx on tasks (user_id, status, due_at);

create trigger tasks_updated_at
  before update on tasks
  for each row execute function jarvis_set_updated_at();

-- --------------------------------------------------------------------------
-- events — the append-only ledger that makes Jarvis proactive
--
-- Rows are never edited except to advance processing_status. A fact that turns
-- out to be wrong is corrected by appending, not by rewriting history.
-- --------------------------------------------------------------------------
create table events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null,
  domain jarvis_domain not null,
  source text not null,
  importance jarvis_importance not null default 'normal',
  payload jsonb not null default '{}'::jsonb,
  processing_status jarvis_processing_status not null default 'pending',
  correlation_id uuid,
  caused_by_event_id uuid references events (id) on delete set null,
  -- When it happened, as distinct from when it was written. Backfilled data
  -- has an occurred_at far older than its recorded_at, and analysis must use
  -- the former.
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  processed_at timestamptz
);

create index events_user_occurred_idx on events (user_id, occurred_at desc);
create index events_pending_idx on events (user_id, processing_status, importance)
  where processing_status = 'pending';
create index events_correlation_idx on events (correlation_id) where correlation_id is not null;
create index events_type_idx on events (user_id, event_type, occurred_at desc);

-- --------------------------------------------------------------------------
-- world_state_snapshots — point-in-time structured state
-- --------------------------------------------------------------------------
create table world_state_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  captured_at timestamptz not null default now(),
  reason text not null,
  -- Structured slices, one per domain. Explicitly not a prose summary:
  -- narrative is generated from this, never stored in place of it.
  state jsonb not null
);

create index world_state_snapshots_user_idx on world_state_snapshots (user_id, captured_at desc);

-- --------------------------------------------------------------------------
-- agent_states — durable per-agent runtime state
-- --------------------------------------------------------------------------
create table agent_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  agent_id text not null,
  status jarvis_agent_run_status not null default 'idle',
  last_run_at timestamptz,
  last_result_summary text,
  last_error text,
  -- Where the agent left off, so an observer resumes rather than reprocesses.
  cursor text,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint agent_states_unique_per_user unique (user_id, agent_id)
);

create trigger agent_states_updated_at
  before update on agent_states
  for each row execute function jarvis_set_updated_at();

-- --------------------------------------------------------------------------
-- memories
--
-- Only the classes that genuinely do not fit a relational table. Trades,
-- transactions and balances are facts with columns and belong in domain
-- tables — putting them here would be the mistake this architecture exists to
-- avoid.
-- --------------------------------------------------------------------------
create table memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  memory_class jarvis_memory_class not null,
  domain jarvis_domain not null,
  title text not null,
  content text not null,
  summary text,
  importance jarvis_importance not null default 'normal',
  tags text[] not null default '{}',
  evidence_kind jarvis_evidence_kind not null default 'user_observation',
  confidence double precision not null default 0.8,
  source text not null,
  source_table text,
  source_id uuid,
  -- Beliefs are valid over an interval and are superseded, never overwritten.
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  superseded_by_id uuid references memories (id) on delete set null,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  access_count integer not null default 0,
  constraint memories_confidence_range check (confidence >= 0 and confidence <= 1)
);

-- Scoped recall is the common query: agents read one domain and a few classes.
create index memories_scope_idx on memories (user_id, domain, memory_class, valid_from desc)
  where superseded_by_id is null;
create index memories_tags_idx on memories using gin (tags);

-- --------------------------------------------------------------------------
-- notifications
-- --------------------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain jarvis_domain not null,
  urgency jarvis_notification_urgency not null default 'normal',
  channel jarvis_notification_channel not null default 'in_app',
  title text not null,
  body text not null,
  deep_link text,
  status jarvis_notification_status not null default 'pending',
  correlation_id uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz
);

create index notifications_user_idx on notifications (user_id, status, created_at desc);

-- --------------------------------------------------------------------------
-- approval_requests — how PREPARE becomes EXECUTE
-- --------------------------------------------------------------------------
create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain jarvis_domain not null,
  capability text not null,
  risk_class text not null,
  requested_by text not null,
  title text not null,
  summary text not null,
  -- The concrete action. Re-validated at execution time: an approval granted
  -- six hours ago is consent, not proof the payload is still correct.
  proposed_action jsonb not null,
  expected_outcome text,
  status jarvis_approval_status not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  decision_note text,
  correlation_id uuid
);

create index approval_requests_pending_idx on approval_requests (user_id, status, expires_at)
  where status = 'pending';

-- --------------------------------------------------------------------------
-- permission_grants — per-capability autonomy
--
-- The level stored here is an upper bound *request*, not the final word. Every
-- capability also carries a hard ceiling declared in
-- src/core/permissions/capabilities.ts, and the effective level is the lower of
-- the two. A row in this table can never raise a critical capability past what
-- the code allows.
-- --------------------------------------------------------------------------
create table permission_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  capability text not null,
  level jarvis_action_level not null default 'observe',
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  note text,
  constraint permission_grants_unique unique (user_id, capability)
);

-- --------------------------------------------------------------------------
-- audit_log — append-only
--
-- No update or delete policy is granted on this table, to anyone, ever.
-- --------------------------------------------------------------------------
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  actor_type jarvis_actor_type not null,
  actor_id text not null,
  action text not null,
  domain jarvis_domain not null,
  capability text,
  target_type text,
  target_id text,
  outcome jarvis_audit_outcome not null,
  reason text,
  -- Must never contain credentials, tokens or full account numbers.
  metadata jsonb not null default '{}'::jsonb,
  correlation_id uuid,
  occurred_at timestamptz not null default now()
);

create index audit_log_user_idx on audit_log (user_id, occurred_at desc);
create index audit_log_correlation_idx on audit_log (correlation_id) where correlation_id is not null;

-- --------------------------------------------------------------------------
-- New auth users get a profile automatically.
-- --------------------------------------------------------------------------
create or replace function jarvis_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function jarvis_handle_new_user();
